#!/usr/bin/env python3
"""
LLM-assisted bytecode recovery using coding agents.

Supports coding agents:
- claude (Claude Code) - primary, uses claude-sonnet-4-20250514
- opencode - fallback
"""

import ast
import logging
import re
import shutil
import subprocess
import textwrap
from concurrent.futures import CancelledError, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass

from bytecode_utils import (
    extract_class_bytecode,
    find_warning_end_index,
    get_class_methods_from_bytecode,
    is_truly_empty_class,
    is_truly_empty_function,
    validate_syntax,
)

logger = logging.getLogger(__name__)

__all__ = [
    "IncompleteFunction",
    "IncompleteClass",
    "find_coding_agent",
    "recover_incomplete_file",
    "find_incomplete_functions",
    "find_incomplete_classes",
]

# --- Prompts ---

RECOVERY_PROMPT = """Reconstruct this incomplete Python function from its bytecode.

## Incomplete Source (from pycdc):
```python
{incomplete_source}
```

## Bytecode Disassembly (from pycdas):
```
{bytecode}
```

## Context (imports and class):
```python
{context}
```

Rules:
- Output ONLY the complete Python function/method
- Preserve the exact signature and indentation level
- Use bytecode constants and names to infer implementation
- No explanations, just code in a Python code block

Output the complete Python code:"""

CLASS_RECOVERY_PROMPT = """Reconstruct this incomplete Python class from its bytecode.

## Incomplete Source (shows class with just 'pass'):
```python
{incomplete_source}
```

## Class Bytecode (from pycdas):
```
{bytecode}
```

## Methods this class should have (from bytecode):
{methods}

## Context (imports):
```python
{context}
```

Rules:
- Output ONLY the complete Python class
- Include all methods listed above with FULL implementations
- NEVER use 'pass' as a method body - always infer the real implementation from bytecode
- Look at [Constants], [Names], [Disassembly] sections to understand what each method does
- Preserve the class name and base class
- No explanations, just code in a Python code block

Output the complete Python class:"""

SYNTAX_FIX_PROMPT = """Fix the syntax errors in this Python code from a decompiler.

## Source with syntax errors:
```python
{source}
```

## Syntax error:
{error}

## Bytecode for reference (from pycdas):
```
{bytecode}
```

Rules:
- Fix ONLY the syntax errors, preserve everything else
- Use bytecode to understand what the code should do
- Keep all function/class signatures intact
- Output the complete fixed Python code in a code block
- No explanations, just the fixed code

Output the fixed Python code:"""

FULL_RECOVERY_PROMPT = """The decompiler produced invalid Python code. Reconstruct valid Python from bytecode.

## Invalid Source (from pycdc - has syntax errors):
```python
{source}
```

## Bytecode Disassembly (from pycdas):
```
{bytecode}
```

Rules:
- Output ONLY valid Python code
- Preserve the structure (imports, classes, functions)
- Use bytecode to infer correct implementation
- No explanations, just code in a Python code block

Output the complete valid Python code:"""


# --- Data classes ---


@dataclass
class IncompleteFunction:
    """An incomplete function found via AST analysis."""

    name: str
    signature: str
    lineno: int
    end_lineno: int
    indent: int
    is_method: bool
    class_name: str | None


@dataclass
class IncompleteClass:
    """An incomplete class found via AST/regex analysis."""

    name: str
    base_class: str
    lineno: int
    end_lineno: int
    indent: int
    methods: list[str]


# --- Agent interface ---


def find_coding_agent() -> str | None:
    """Find available coding agent."""
    for agent in ["claude", "opencode"]:
        if shutil.which(agent):
            return agent
    return None


def call_claude(prompt: str, timeout: int = 60) -> str | None:
    """Call Claude Code agent."""
    try:
        result = subprocess.run(
            [
                "claude",
                "-p",
                prompt,
                "--model",
                "claude-sonnet-4-20250514",
                "--permission-mode",
                "bypassPermissions",
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout if result.returncode == 0 else None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def call_opencode(prompt: str, timeout: int = 120) -> str | None:
    """Call opencode agent."""
    try:
        result = subprocess.run(
            ["opencode", "ask", "--model", "gpt-5", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout if result.returncode == 0 else None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def call_both_agents(prompt: str) -> str | None:
    """Call both agents in parallel, return best result."""
    with ThreadPoolExecutor(max_workers=2) as executor:
        claude_future = executor.submit(call_claude, prompt)
        opencode_future = executor.submit(call_opencode, prompt)

        results = {}
        for name, future in [("claude", claude_future), ("opencode", opencode_future)]:
            try:
                results[name] = future.result(timeout=130)
            except (FuturesTimeoutError, CancelledError, subprocess.SubprocessError, OSError):
                results[name] = None

    codes = {}
    for tool, response in results.items():
        if response:
            code = extract_code_from_response(response)
            if code:
                codes[tool] = code

    if not codes:
        return None

    def score_code(code: str) -> int:
        lines = [ln for ln in code.split("\n") if ln.strip() and not ln.strip().startswith("#")]
        score = len(lines) * 10 + code.count("return ") * 5 + code.count("self.") * 2
        if "pass" in code and len(lines) <= 2:
            score -= 50
        return score

    return max(codes.values(), key=score_code)


def extract_code_from_response(response: str) -> str | None:
    """Extract Python code from LLM response."""
    # Try code blocks first
    for pattern in [r"```python\n(.*?)```", r"```\n(.*?)```"]:
        match = re.search(pattern, response, re.DOTALL)
        if match:
            code = match.group(1).strip()
            break
    else:
        # Look for def/class statements
        lines = response.strip().split("\n")
        code_lines = []
        in_code = False
        for line in lines:
            if line.strip().startswith(("def ", "class ", "async def ", "@")):
                in_code = True
            if in_code:
                code_lines.append(line)
        code = "\n".join(code_lines) if code_lines else None

    if not code:
        return None

    valid, _ = validate_syntax(code)
    if not valid:
        code = textwrap.dedent(code)
        valid, _ = validate_syntax(code)
        if not valid:
            return None

    return code


def indent_code(code: str, spaces: int) -> str:
    """Indent code by specified number of spaces."""
    indent = " " * spaces
    return "\n".join(indent + line if line.strip() else line for line in code.split("\n"))


# --- AST analysis ---


def find_incomplete_functions(
    source: str, bytecode: str | None = None
) -> tuple[list[IncompleteFunction], bool]:
    """Find incomplete functions using AST analysis."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return [], True

    lines = source.split("\n")
    incomplete = []

    def get_indent(lineno: int) -> int:
        if lineno <= 0 or lineno > len(lines):
            return 0
        line = lines[lineno - 1]
        return len(line) - len(line.lstrip())

    def check_function(node: ast.FunctionDef | ast.AsyncFunctionDef, class_name: str | None = None):
        if not (len(node.body) == 1 and isinstance(node.body[0], ast.Pass)):
            return

        end_line = node.end_lineno or node.lineno

        # Check for WARNING comment or bytecode showing non-empty
        has_warning = end_line < len(lines) and "WARNING: Decompyle incomplete" in "\n".join(
            lines[end_line : end_line + 3]
        )
        is_empty = not bytecode or is_truly_empty_function(bytecode, node.name)

        if has_warning or not is_empty:
            args = [arg.arg for arg in node.args.args]
            if node.args.vararg:
                args.append(f"*{node.args.vararg.arg}")
            if node.args.kwarg:
                args.append(f"**{node.args.kwarg.arg}")

            prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
            incomplete.append(
                IncompleteFunction(
                    name=node.name,
                    signature=f"{prefix} {node.name}({', '.join(args)}):",
                    lineno=node.lineno,
                    end_lineno=end_line,
                    indent=get_indent(node.lineno),
                    is_method=class_name is not None,
                    class_name=class_name,
                )
            )

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    check_function(item, node.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Check if top-level (not a method)
            is_method = any(
                isinstance(parent, ast.ClassDef) and node in parent.body
                for parent in ast.walk(tree)
            )
            if not is_method:
                check_function(node, None)

    return incomplete, False


def find_incomplete_classes(source: str, bytecode: str) -> list[IncompleteClass]:
    """Find incomplete classes using AST analysis."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    lines = source.split("\n")
    incomplete = []

    def get_indent(lineno: int) -> int:
        if lineno <= 0 or lineno > len(lines):
            return 0
        line = lines[lineno - 1]
        return len(line) - len(line.lstrip())

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        is_pass_only = len(node.body) == 1 and isinstance(node.body[0], ast.Pass)
        if is_pass_only and not is_truly_empty_class(bytecode, node.name):
            base = "object"
            if node.bases and hasattr(ast, "unparse"):
                base = ast.unparse(node.bases[0])

            incomplete.append(
                IncompleteClass(
                    name=node.name,
                    base_class=base,
                    lineno=node.lineno,
                    end_lineno=node.end_lineno or node.lineno,
                    indent=get_indent(node.lineno),
                    methods=get_class_methods_from_bytecode(bytecode, node.name),
                )
            )

    return incomplete


def extract_bytecode_for_function(bytecode: str, func_name: str) -> str | None:
    """Extract bytecode section for a function."""
    pattern = rf"Object Name: {re.escape(func_name)}.*?(?=\n\s*\[Code\]\n\s*File Name:|\Z)"
    match = re.search(pattern, bytecode, re.DOTALL)
    return match.group(0) if match else None


# --- Recovery functions ---


def fix_syntax_errors(source: str, bytecode: str, use_both: bool = True) -> str | None:
    """Fix syntax errors using LLM."""
    valid, error = validate_syntax(source)
    if valid:
        return source

    prompt = SYNTAX_FIX_PROMPT.format(source=source, error=error, bytecode=bytecode)
    code = (
        call_both_agents(prompt)
        if use_both
        else extract_code_from_response(call_claude(prompt) or "")
    )

    if code:
        valid, _ = validate_syntax(code)
        if valid:
            return code
    return None


def recover_full_file(source: str, bytecode: str, use_both: bool = True) -> str | None:
    """Recover entire file using LLM."""
    prompt = FULL_RECOVERY_PROMPT.format(source=source, bytecode=bytecode)
    return (
        call_both_agents(prompt)
        if use_both
        else extract_code_from_response(call_claude(prompt) or "")
    )


def recover_function(
    func: IncompleteFunction, bytecode: str, context: str, use_both: bool = True
) -> str | None:
    """Recover a single function using LLM."""
    prompt = RECOVERY_PROMPT.format(
        incomplete_source=f"{func.signature}\n    pass",
        bytecode=bytecode,
        context=context,
    )

    code = (
        call_both_agents(prompt)
        if use_both
        else extract_code_from_response(call_claude(prompt) or "")
    )
    if not code:
        return None

    code = textwrap.dedent(code)
    if func.indent > 0:
        code = indent_code(code, func.indent)

    valid, _ = validate_syntax(code)
    return code if valid else None


def recover_class(
    cls: IncompleteClass, bytecode: str, context: str, use_both: bool = True
) -> str | None:
    """Recover a single class using LLM."""
    class_bytecode = extract_class_bytecode(bytecode, cls.name, cls.methods)
    prompt = CLASS_RECOVERY_PROMPT.format(
        incomplete_source=f"class {cls.name}({cls.base_class}):\n    pass",
        bytecode=class_bytecode,
        methods=", ".join(cls.methods) if cls.methods else "unknown",
        context=context,
    )

    code = (
        call_both_agents(prompt)
        if use_both
        else extract_code_from_response(call_claude(prompt) or "")
    )
    if not code:
        return None

    code = textwrap.dedent(code)
    if cls.indent > 0:
        code = indent_code(code, cls.indent)

    valid, _ = validate_syntax(code)
    return code if valid else None


def strip_leftover_warnings(source: str, bytecode: str) -> str:
    """Strip WARNING comments if all code is complete."""
    if "# WARNING: Decompyle incomplete" not in source:
        return source

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source

    # Check for remaining incomplete items
    def is_incomplete(node: ast.stmt) -> bool:
        has_pass = len(node.body) == 1 and isinstance(node.body[0], ast.Pass)
        if not has_pass:
            return False
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return not is_truly_empty_function(bytecode, node.name)
        if isinstance(node, ast.ClassDef):
            return not is_truly_empty_class(bytecode, node.name)
        return False

    for node in ast.walk(tree):
        if isinstance(
            node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ) and is_incomplete(node):
            return source

    # All complete - strip warnings
    lines = [ln for ln in source.split("\n") if "# WARNING: Decompyle incomplete" not in ln]
    while lines and lines[-1].strip().startswith("Unsupported opcode:"):
        lines.pop()
    return "\n".join(lines)


# --- Main entry point ---


def recover_incomplete_file(source: str, bytecode: str, use_both: bool = True) -> tuple[str, int]:
    """Recover all incomplete functions and classes using LLM.

    Returns: (recovered source, number of items recovered)
    """
    working_source = source
    recovered_count = 0

    # Fix syntax errors first
    valid, _ = validate_syntax(working_source)
    if not valid:
        fixed = fix_syntax_errors(working_source, bytecode, use_both)
        if fixed:
            working_source = fixed
            recovered_count += 1
        else:
            recovered = recover_full_file(working_source, bytecode, use_both)
            if recovered:
                valid, _ = validate_syntax(recovered)
                if valid:
                    return recovered, 1
            return source, 0

    # Find incomplete items
    incomplete_funcs, _ = find_incomplete_functions(working_source, bytecode)
    incomplete_classes = find_incomplete_classes(working_source, bytecode)

    # Handle module-level incomplete code
    has_warning = "# WARNING: Decompyle incomplete" in working_source
    if not incomplete_funcs and not incomplete_classes and has_warning:
        recovered = recover_full_file(working_source, bytecode, use_both)
        if recovered:
            valid, _ = validate_syntax(recovered)
            if valid and "# WARNING:" not in recovered:
                return recovered, recovered_count + 1
        return working_source, recovered_count

    if not incomplete_funcs and not incomplete_classes:
        return working_source, recovered_count

    # Extract context
    lines = working_source.split("\n")
    import_lines = [ln for ln in lines if ln.strip().startswith(("import ", "from "))]
    context = "\n".join(import_lines[:20])

    result_lines = lines.copy()

    # Recover classes (bottom-up to preserve line numbers)
    for cls in sorted(incomplete_classes, key=lambda c: -c.lineno):
        recovered = recover_class(cls, bytecode, context, use_both)
        if recovered:
            start_idx = cls.lineno - 1
            end_idx = find_warning_end_index(result_lines, cls.end_lineno)
            result_lines[start_idx:end_idx] = recovered.split("\n")
            recovered_count += 1

    # Recover functions (bottom-up)
    for func in sorted(incomplete_funcs, key=lambda f: -f.lineno):
        func_bytecode = extract_bytecode_for_function(bytecode, func.name)
        if not func_bytecode:
            continue

        func_context = context
        if func.class_name:
            func_context += f"\n\nclass {func.class_name}:\n    # method context"

        recovered = recover_function(func, func_bytecode, func_context, use_both)
        if recovered:
            start_idx = func.lineno - 1
            end_idx = find_warning_end_index(result_lines, func.end_lineno)
            result_lines[start_idx:end_idx] = recovered.split("\n")
            recovered_count += 1

    result = "\n".join(result_lines)
    result = strip_leftover_warnings(result, bytecode)

    valid, _ = validate_syntax(result)
    if not valid:
        return source, 0

    return result, recovered_count


if __name__ == "__main__":
    print("LLM-Assisted Bytecode Recovery")
    print("=" * 40)

    claude_available = shutil.which("claude") is not None
    opencode_available = shutil.which("opencode") is not None

    print(f"Claude Code CLI: {'+ available' if claude_available else 'x not found'}")
    print(f"OpenCode CLI: {'+ available' if opencode_available else 'x not found'}")

    if not claude_available and not opencode_available:
        print("\nNo LLM CLI tools found. Install claude or opencode.")
    else:
        print("\nReady for LLM-assisted recovery.")

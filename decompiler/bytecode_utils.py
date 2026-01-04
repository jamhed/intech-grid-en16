"""
Shared bytecode analysis utilities.

Provides functions for analyzing pycdas bytecode disassembly output.
"""

import ast
import re

__all__ = [
    "validate_syntax",
    "extract_bytecode_section",
    "is_truly_empty_function",
    "is_truly_empty_class",
    "get_class_methods_from_bytecode",
    "extract_class_bytecode",
    "find_warning_end_index",
]


def validate_syntax(source: str) -> tuple[bool, str | None]:
    """Check if Python source has valid syntax.

    Returns: (is_valid, error_message)
    """
    try:
        ast.parse(source)
        return True, None
    except SyntaxError as e:
        return False, f"Line {e.lineno}: {e.msg}"


def extract_bytecode_section(
    bytecode: str, object_name: str, qualified_name: str | None = None
) -> str | None:
    """Extract bytecode section for a code object.

    Args:
        bytecode: Full pycdas output
        object_name: The Object Name to find
        qualified_name: Optional Qualified Name to match (for disambiguation)

    Returns:
        The bytecode section or None if not found
    """
    if qualified_name:
        pattern = rf"Object Name: {re.escape(object_name)}\s*\n\s*Qualified Name: {re.escape(qualified_name)}\s*\n.*?(?=\n\s*\[Code\]\n\s*File Name:|\Z)"
    else:
        pattern = (
            rf"Object Name: {re.escape(object_name)}\s*\n.*?(?=\n\s*\[Code\]\n\s*File Name:|\Z)"
        )
    match = re.search(pattern, bytecode, re.DOTALL)
    return match.group(0) if match else None


def is_truly_empty_function(bytecode: str, func_name: str) -> bool:
    """Check if a function with 'pass' body is truly empty in bytecode.

    A truly empty function only has: RESUME, LOAD_CONST None, RETURN_VALUE
    If it has more opcodes or nested code objects, the decompiler failed.
    """
    func_bytecode = extract_bytecode_section(bytecode, func_name)
    if not func_bytecode:
        return True  # Can't verify, assume correct

    # Check for nested code objects (nested functions/lambdas)
    if "[Code]" in func_bytecode:
        return False

    # Check stack size - empty function has stack size 1
    stack_match = re.search(r"Stack Size: (\d+)", func_bytecode)
    if stack_match and int(stack_match.group(1)) > 1:
        return False

    # Check for names used - empty functions have no names
    names_match = re.search(r"\[Names\](.*?)\[Locals", func_bytecode, re.DOTALL)
    if names_match and names_match.group(1).strip():
        return False

    # Extract disassembly section
    disasm_match = re.search(r"\[Disassembly\](.*?)(?:\[Exception|\Z)", func_bytecode, re.DOTALL)
    if not disasm_match:
        return True

    disasm = disasm_match.group(1).strip()
    lines = [ln.strip() for ln in disasm.split("\n") if ln.strip()]

    # Empty function has exactly: RESUME, LOAD_CONST, RETURN_VALUE
    if len(lines) > 3:
        return False

    return "LOAD_CONST" in disasm and "RETURN_VALUE" in disasm and "None" in disasm


def is_truly_empty_class(bytecode: str, class_name: str) -> bool:
    """Check if a class with 'pass' body is truly empty in bytecode."""
    class_bytecode = extract_bytecode_section(bytecode, class_name, qualified_name=class_name)
    if not class_bytecode:
        return True  # Can't verify, assume correct

    # Check for method definitions in [Names] section
    names_match = re.search(r"\[Names\](.*?)\[", class_bytecode, re.DOTALL)
    if names_match:
        names = names_match.group(1).strip().split("\n")
        standard_names = {"__name__", "__module__", "__qualname__", "__doc__"}
        method_names = [
            n.strip().strip("'") for n in names if n.strip().strip("'") not in standard_names
        ]
        if method_names:
            return False

    return True


def get_class_methods_from_bytecode(bytecode: str, class_name: str) -> list[str]:
    """Get list of method names for a class from bytecode."""
    class_bytecode = extract_bytecode_section(bytecode, class_name, qualified_name=class_name)
    if not class_bytecode:
        return []

    names_match = re.search(r"\[Names\](.*?)\[", class_bytecode, re.DOTALL)
    if not names_match:
        return []

    names = names_match.group(1).strip().split("\n")
    standard_names = {"__name__", "__module__", "__qualname__", "__doc__", "object", "type"}
    methods = []
    for n in names:
        name = n.strip().strip("'")
        if not name or name in standard_names:
            continue
        # Include dunder methods that are commonly implemented
        if not name.startswith("__") or name in ("__init__", "__str__", "__repr__"):
            methods.append(name)
    return methods


def extract_class_bytecode(bytecode: str, class_name: str, methods: list[str]) -> str:
    """Extract bytecode for a class including all its methods."""
    parts = []

    # Extract class-level bytecode
    class_bytecode = extract_bytecode_section(bytecode, class_name, qualified_name=class_name)
    if class_bytecode:
        parts.append(f"=== Class {class_name} ===\n{class_bytecode}")

    # Extract each method's bytecode
    for method in methods:
        method_bytecode = extract_bytecode_section(
            bytecode, method, qualified_name=f"{class_name}.{method}"
        )
        if method_bytecode:
            parts.append(f"\n=== Method {class_name}.{method} ===\n{method_bytecode}")

    return "\n".join(parts)


def find_warning_end_index(lines: list[str], start_idx: int) -> int:
    """Find the end index including any WARNING comment after a code block.

    Scans forward from start_idx until finding a WARNING comment or non-comment content.
    Returns the index after the WARNING comment if found, or the first non-empty line.
    """
    end_idx = start_idx
    while end_idx < len(lines):
        line = lines[end_idx].strip()
        if "WARNING: Decompyle incomplete" in line:
            return end_idx + 1
        if line and not line.startswith("#"):
            break
        end_idx += 1
    return end_idx

"""
Shared bytecode analysis utilities.

Provides functions for analyzing Python bytecode using xdis.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import CodeType

__all__ = [
    # Syntax validation
    "validate_syntax",
    # Bytecode container
    "BytecodeInfo",
    "load_bytecode",
    # Code object utilities
    "is_empty_code_object",
    "get_function_signature",
    "get_class_methods",
    # Compatibility wrappers (for existing code)
    "is_truly_empty_function",
    "is_truly_empty_class",
    "get_class_methods_from_bytecode",
    # Module constant recovery
    "find_missing_module_constants",
    "extract_module_constants",
    "format_constant",
    # Text utilities
    "get_disassembly_text",
    "get_code_disassembly",
    "find_warning_end_index",
    "get_indent",
]


@dataclass
class BytecodeInfo:
    """Container for loaded bytecode information."""

    path: Path
    version: tuple[int, int]
    code: CodeType
    code_objects: dict[str, CodeType] = field(default_factory=dict)
    _disassembly_cache: str | None = field(default=None, repr=False)

    def __post_init__(self):
        """Build code objects index after initialization."""
        if not self.code_objects:
            self.code_objects = _get_code_objects(self.code)

    def get_code(self, name: str) -> CodeType | None:
        """Get code object by name (e.g., 'MyClass.my_method')."""
        # Try exact match first
        if name in self.code_objects:
            return self.code_objects[name]
        # Try with module prefix
        for key, code in self.code_objects.items():
            if key.endswith(f".{name}") or key == name:
                return code
        return None

    def get_disassembly(self) -> str:
        """Get full disassembly text (cached)."""
        if self._disassembly_cache is None:
            self._disassembly_cache = get_disassembly_text(self.path)
        return self._disassembly_cache


def load_bytecode(pyc_path: Path) -> BytecodeInfo:
    """Load a .pyc file and return BytecodeInfo container.

    Args:
        pyc_path: Path to .pyc file

    Returns:
        BytecodeInfo with version, code object, and indexed code objects
    """
    from xdis import load

    version, _timestamp, _magic, code, _is_pypy, _source_size, _sip_hash = load.load_module(
        str(pyc_path)
    )
    return BytecodeInfo(path=pyc_path, version=version, code=code)


def _get_code_objects(code: CodeType, prefix: str = "") -> dict[str, CodeType]:
    """Recursively extract all code objects from a code object."""
    result = {}
    name = f"{prefix}.{code.co_name}" if prefix else code.co_name
    result[name] = code

    for const in code.co_consts:
        if hasattr(const, "co_code"):
            result.update(_get_code_objects(const, name))

    return result


# --- Code object analysis ---


def is_empty_code_object(code: CodeType) -> bool:
    """Check if a code object represents an empty function (just 'pass' or 'return None').

    An empty function has:
    - Stack size of 1
    - No names used
    - No nested code objects
    - Short bytecode (RESUME + LOAD_CONST + RETURN_VALUE)
    """
    # Check for nested code objects (lambdas, comprehensions, nested functions)
    if any(hasattr(c, "co_code") for c in code.co_consts):
        return False

    # Check stack size - empty function has stack size 1
    if code.co_stacksize > 1:
        return False

    # Check for names used - empty functions have no names
    if code.co_names:
        return False

    # Check bytecode length - empty function is very short
    # RESUME (2 bytes) + LOAD_CONST (2 bytes) + RETURN_VALUE (2 bytes) = 6 bytes for 3.11+
    return len(code.co_code) <= 10


def get_function_signature(code: CodeType) -> str:
    """Build function signature string from code object."""
    args = list(code.co_varnames[: code.co_argcount])

    # Add *args if present
    has_varargs = bool(code.co_flags & 0x04)
    has_kwargs = bool(code.co_flags & 0x08)

    if has_varargs:
        args.append(f"*{code.co_varnames[code.co_argcount]}")
    if has_kwargs:
        idx = code.co_argcount + (1 if has_varargs else 0)
        if idx < len(code.co_varnames):
            args.append(f"**{code.co_varnames[idx]}")

    return f"def {code.co_name}({', '.join(args)})"


def get_class_methods(bc_info: BytecodeInfo, class_name: str) -> list[str]:
    """Get list of method names for a class from bytecode.

    Args:
        bc_info: BytecodeInfo container
        class_name: Name of the class

    Returns:
        List of method names defined in the class
    """
    methods = []
    prefix = f".{class_name}."

    for qualified_name in bc_info.code_objects:
        if prefix in qualified_name:
            # Extract method name from qualified name like "<module>.MyClass.my_method"
            parts = qualified_name.split(".")
            try:
                class_idx = parts.index(class_name)
                if class_idx + 1 < len(parts):
                    method_name = parts[class_idx + 1]
                    if method_name not in methods:
                        methods.append(method_name)
            except ValueError:
                continue

    return methods


# --- Compatibility wrappers for existing code ---


def is_truly_empty_function(bc_info: BytecodeInfo, func_name: str) -> bool:
    """Check if a function with 'pass' body is truly empty in bytecode.

    Args:
        bc_info: BytecodeInfo container
        func_name: Name of the function to check

    Returns:
        True if the function body is empty
    """
    code = bc_info.get_code(func_name)
    if code is None:
        return True  # Can't verify, assume correct

    return is_empty_code_object(code)


def is_truly_empty_class(bc_info: BytecodeInfo, class_name: str) -> bool:
    """Check if a class with 'pass' body is truly empty in bytecode.

    Args:
        bc_info: BytecodeInfo container
        class_name: Name of the class to check

    Returns:
        True if the class has no methods
    """
    methods = get_class_methods(bc_info, class_name)

    # Filter out standard class attributes
    standard = {"__module__", "__qualname__", "__doc__"}
    real_methods = [m for m in methods if m not in standard]

    return len(real_methods) == 0


def get_class_methods_from_bytecode(bc_info: BytecodeInfo, class_name: str) -> list[str]:
    """Get list of method names for a class from bytecode.

    Args:
        bc_info: BytecodeInfo container
        class_name: Name of the class

    Returns:
        List of method names (excluding standard dunder methods)
    """
    methods = get_class_methods(bc_info, class_name)

    # Filter standard names but keep common dunder methods
    standard = {"__module__", "__qualname__", "__doc__"}
    return [m for m in methods if m not in standard]


# --- Disassembly text utilities ---


def get_disassembly_text(pyc_path: Path) -> str:
    """Get full disassembly of a .pyc file using xdis.

    Args:
        pyc_path: Path to .pyc file

    Returns:
        Disassembly output as string
    """
    import sys

    from xdis import disasm, load

    version, timestamp, _magic, code, _is_pypy, _source_size, _sip_hash = load.load_module(
        str(pyc_path)
    )

    # Capture disassembly output
    old_stdout = sys.stdout
    sys.stdout = buffer = StringIO()
    try:
        disasm.disco(version, code, timestamp)
    finally:
        sys.stdout = old_stdout

    return buffer.getvalue()


def get_code_disassembly(bc_info: BytecodeInfo, name: str) -> str | None:
    """Get disassembly text for a specific code object.

    Args:
        bc_info: BytecodeInfo container
        name: Name of the code object (e.g., 'my_func' or 'MyClass.my_method')

    Returns:
        Disassembly text for the code object, or None if not found
    """
    import sys

    from xdis import disasm

    code = bc_info.get_code(name)
    if code is None:
        return None

    old_stdout = sys.stdout
    sys.stdout = buffer = StringIO()
    try:
        disasm.disco(bc_info.version, code, None)
    finally:
        sys.stdout = old_stdout

    return buffer.getvalue()


# --- Module constant recovery ---


def find_missing_module_constants(source: str, bc_info: BytecodeInfo) -> list[str]:
    """Find module-level names defined in bytecode but missing from decompiled source.

    Args:
        source: Decompiled Python source code
        bc_info: BytecodeInfo container

    Returns:
        List of missing constant names (e.g., ['LIVE_COLORS_TO_MIDI_VALUES', 'RGB_COLOR_TABLE'])
    """
    module_code = bc_info.code

    # Parse source to find what's actually defined
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    defined_names = set()
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            defined_names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    defined_names.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            defined_names.add(node.target.id)

    # Also check for imports
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                defined_names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                defined_names.add(alias.asname or alias.name)

    # Find names that are STORE_NAME targets but not defined in source
    # We need to analyze bytecode to find actual STORE_NAME instructions
    missing = []
    co_names = module_code.co_names
    bytecode = module_code.co_code

    # Skip patterns: dunder, private, module paths, base classes
    skip_names = {"annotations", "object", "type", "Exception", "BaseException"}

    # Find STORE_NAME targets by analyzing bytecode
    # In Python 3.11+, STORE_NAME is opcode 90
    stored_names = set()
    i = 0
    while i < len(bytecode):
        op = bytecode[i]
        if op == 90:  # STORE_NAME
            arg = bytecode[i + 1]
            if arg < len(co_names):
                stored_names.add(co_names[arg])
        i += 2  # Python 3.11+ uses 2-byte instructions

    for name in stored_names:
        if name in defined_names:
            continue
        if name in skip_names:
            continue
        if name.startswith(("__", "_")):
            continue
        # Skip dotted names (module paths)
        if "." in name:
            continue
        missing.append(name)

    return sorted(missing)


def extract_module_constants(bc_info: BytecodeInfo, names: list[str]) -> dict[str, object]:
    """Extract values of module-level constants from bytecode.

    Analyzes bytecode to find STORE_NAME instructions and traces back
    to find the values being stored.

    Args:
        bc_info: BytecodeInfo container
        names: List of constant names to extract

    Returns:
        Dict mapping names to their values
    """
    module_code = bc_info.code
    constants = module_code.co_consts
    co_names = module_code.co_names
    bytecode = module_code.co_code

    result = {}

    # Python 3.11+ opcode
    STORE_NAME = 90

    # Parse bytecode to find what's assigned to each name
    # Build instruction list: [(offset, opcode, arg), ...]
    instructions = []
    i = 0
    while i < len(bytecode):
        op = bytecode[i]
        arg = bytecode[i + 1] if i + 1 < len(bytecode) else 0
        instructions.append((i, op, arg))
        i += 2

    # Find STORE_NAME instructions for requested names
    for name in names:
        if name not in co_names:
            continue

        name_idx = co_names.index(name)

        # Find the STORE_NAME instruction for this name
        for idx, (_offset, op, arg) in enumerate(instructions):
            if op == STORE_NAME and arg == name_idx:
                # Trace back to find what's being stored
                value = _trace_stack_value(instructions, idx, constants, co_names)
                if value is not None:
                    result[name] = value
                break

    return result


def _trace_stack_value(
    instructions: list[tuple[int, int, int]],
    store_idx: int,
    constants: tuple,
    co_names: tuple,
) -> object | None:
    """Trace back from STORE_NAME to find the value being stored.

    Handles:
    - Simple LOAD_CONST -> STORE_NAME (tuples, simple values)
    - BUILD_MAP + MAP_ADD + DICT_UPDATE sequences (complex dicts)
    """
    LOAD_CONST = 100
    BUILD_MAP = 105
    MAP_ADD = 147
    BUILD_CONST_KEY_MAP = 156

    if store_idx == 0:
        return None

    # Check for simple LOAD_CONST pattern
    prev_op, prev_arg = instructions[store_idx - 1][1:3]
    if prev_op == LOAD_CONST:
        return constants[prev_arg]

    # Check for dict construction pattern
    # Complex dicts are built as: BUILD_MAP + MAP_ADDs + DICT_UPDATE (repeated)
    # We need to find the first BUILD_MAP and collect ALL key-value pairs
    dict_data = {}

    # Find the first BUILD_MAP by scanning backwards
    first_build_map = -1
    for i in range(store_idx - 1, -1, -1):
        if instructions[i][1] == BUILD_MAP:
            # Check if this is followed by MAP_ADD (part of our dict)
            if i + 1 < len(instructions):
                next_op = instructions[i + 1][1]
                # If next is LOAD_CONST or MAP_ADD, this is likely our dict start
                if next_op in (LOAD_CONST, MAP_ADD):
                    first_build_map = i
                    # Keep looking for earlier BUILD_MAP in same dict construction
                    continue
            first_build_map = i
            break

    if first_build_map < 0:
        return None

    # Now scan forward from first BUILD_MAP to store_idx, collecting all key-value pairs
    i = first_build_map
    while i < store_idx:
        op = instructions[i][1]

        if op == MAP_ADD:
            # Preceding two instructions should be LOAD_CONST for key and value
            if i >= 2:
                key_instr = instructions[i - 2]
                val_instr = instructions[i - 1]
                if key_instr[1] == LOAD_CONST and val_instr[1] == LOAD_CONST:
                    key = constants[key_instr[2]]
                    val = constants[val_instr[2]]
                    dict_data[key] = val

        elif op == BUILD_CONST_KEY_MAP:
            # Handle {key1: val1, key2: val2} with keys in tuple
            num_items = instructions[i][2]
            # Keys tuple is right before this instruction
            if i >= 1 and instructions[i - 1][1] == LOAD_CONST:
                keys_tuple = constants[instructions[i - 1][2]]
                if isinstance(keys_tuple, tuple) and len(keys_tuple) == num_items:
                    # Values are before the keys tuple
                    values = []
                    for j in range(num_items):
                        val_idx = i - 2 - j
                        if val_idx >= 0 and instructions[val_idx][1] == LOAD_CONST:
                            values.insert(0, constants[instructions[val_idx][2]])
                    if len(values) == num_items:
                        for k, v in zip(keys_tuple, values, strict=True):
                            dict_data[k] = v

        i += 1

    if dict_data:
        return dict_data

    return None


def format_constant(name: str, value: object, indent: int = 0) -> str:
    """Format a constant value as Python source code.

    Args:
        name: Name of the constant
        value: Value to format
        indent: Number of spaces to indent

    Returns:
        Python source code defining the constant
    """
    prefix = " " * indent

    if isinstance(value, dict):
        if not value:
            return f"{prefix}{name} = {{}}"

        lines = [f"{prefix}{name} = {{"]
        for k, v in sorted(value.items()):
            lines.append(f"{prefix}    {k!r}: {v!r},")
        lines.append(f"{prefix}}}")
        return "\n".join(lines)

    elif isinstance(value, tuple):
        if not value:
            return f"{prefix}{name} = ()"

        # Check if it's a tuple of tuples (like RGB_COLOR_TABLE)
        if value and isinstance(value[0], tuple):
            lines = [f"{prefix}{name} = ("]
            for item in value:
                lines.append(f"{prefix}    {item!r},")
            lines.append(f"{prefix})")
            return "\n".join(lines)
        else:
            # Simple tuple
            return f"{prefix}{name} = {value!r}"

    elif isinstance(value, list):
        if not value:
            return f"{prefix}{name} = []"

        lines = [f"{prefix}{name} = ["]
        for item in value:
            lines.append(f"{prefix}    {item!r},")
        lines.append(f"{prefix}]")
        return "\n".join(lines)

    else:
        return f"{prefix}{name} = {value!r}"


# --- General utilities ---


def get_indent(lines: list[str], lineno: int) -> int:
    """Get indentation level at a line number (1-indexed)."""
    if lineno <= 0 or lineno > len(lines):
        return 0
    line = lines[lineno - 1]
    return len(line) - len(line.lstrip())


def validate_syntax(
    source: str, return_tree: bool = False
) -> tuple[bool, str | None] | tuple[bool, str | None, ast.AST | None]:
    """Check if Python source has valid syntax.

    Args:
        source: Python source code
        return_tree: If True, return the AST tree on success

    Returns:
        (is_valid, error_message) or (is_valid, error_message, tree) if return_tree=True
    """
    try:
        tree = ast.parse(source)
        if return_tree:
            return True, None, tree
        return True, None
    except SyntaxError as e:
        if return_tree:
            return False, f"Line {e.lineno}: {e.msg}", None
        return False, f"Line {e.lineno}: {e.msg}"


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

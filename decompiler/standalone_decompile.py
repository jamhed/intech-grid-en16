#!/usr/bin/env python3
"""
Standalone multi-tool decompiler for Python 3.11 bytecode.

Strategy:
1. Try decompyle3 first (complete output when it works)
2. Fall back to pycdc (handles more Python 3.11 patterns)
3. Use bytecode analysis to reconstruct incomplete sections
4. Optionally use LLM-assisted recovery for remaining gaps
"""

import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from bytecode_utils import (
    BytecodeInfo,
    extract_module_constants,
    find_missing_module_constants,
    format_constant,
    get_class_methods,
    get_function_signature,
    is_truly_empty_class,
    is_truly_empty_function,
    load_bytecode,
    validate_syntax,
)

# Configure logging
logger = logging.getLogger(__name__)

try:
    from llm_recovery import (
        find_coding_agent,
        recover_incomplete_file,
    )
    from llm_recovery import (
        is_available as llm_is_available,
    )

    HAS_LLM_RECOVERY = True
except ImportError:
    HAS_LLM_RECOVERY = False
    llm_is_available = lambda: False  # type: ignore[assignment]  # noqa: E731


__all__ = [
    "DecompileResult",
    "decompile_file",
    "decompile_directory",
]

# Paths
SCRIPT_DIR = Path(__file__).parent
PYCDC = SCRIPT_DIR / "pycdc" / "pycdc"
OUTPUT_DIR = SCRIPT_DIR / "output_standalone"


def _find_default_source() -> Path:
    """Find Ableton MIDI Remote Scripts directory."""
    # Check environment variable first
    if env_path := os.environ.get("ABLETON_MIDI_SCRIPTS"):
        return Path(env_path)

    # Common macOS paths (prefer Beta, then stable)
    candidates = [
        "/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/MIDI Remote Scripts",
        "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/MIDI Remote Scripts",
        "/Applications/Ableton Live 12.app/Contents/App-Resources/MIDI Remote Scripts",
        "/Applications/Ableton Live 11 Suite.app/Contents/App-Resources/MIDI Remote Scripts",
    ]
    for path in candidates:
        if Path(path).exists():
            return Path(path)

    # Fallback to first candidate (will error later if not found)
    return Path(candidates[0])


DEFAULT_SOURCE = _find_default_source()

MAX_INCOMPLETE = 999


@dataclass
class DecompileResult:
    """Result from a decompilation attempt."""

    source: str
    tool: str
    incomplete_count: int
    error: str | None = None

    @property
    def is_complete(self) -> bool:
        return self.incomplete_count == 0 and self.error is None


def run_command(cmd: list[str], timeout: int = 60) -> tuple[str, str, int]:
    """Run a command and return stdout, stderr, returncode."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, cwd=SCRIPT_DIR
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", "Timeout", -1
    except FileNotFoundError as e:
        return "", str(e), -1


# --- Decompiler backends ---


def decompile_with_decompyle3(pyc_path: Path) -> DecompileResult:
    """Try decompyle3 - produces complete output when it works."""
    stdout, stderr, code = run_command(["uv", "run", "decompyle3", str(pyc_path)])

    if "Unsupported Python version" in stdout + stderr:
        return DecompileResult("", "decompyle3", MAX_INCOMPLETE, "Unsupported Python version")

    if code != 0 or not stdout.strip():
        return DecompileResult(
            "", "decompyle3", MAX_INCOMPLETE, stderr[:200] if stderr else "Empty output"
        )

    # Check for actual code (not just comments)
    has_code = any(ln.strip() and not ln.startswith("#") for ln in stdout.split("\n"))
    if not has_code:
        return DecompileResult("", "decompyle3", MAX_INCOMPLETE, "Only comments in output")

    return DecompileResult(stdout, "decompyle3", 0)


def decompile_with_pycdc(pyc_path: Path) -> DecompileResult:
    """Try pycdc - handles Python 3.11 but may be incomplete."""
    if not PYCDC.exists():
        return DecompileResult("", "pycdc", MAX_INCOMPLETE, "pycdc not built")

    stdout, stderr, _ = run_command([str(PYCDC), str(pyc_path)])

    if not stdout.strip():
        return DecompileResult(
            "", "pycdc", MAX_INCOMPLETE, stderr[:200] if stderr else "Empty output"
        )

    incomplete_count = stdout.count("# WARNING: Decompyle incomplete")
    valid, _ = validate_syntax(stdout)
    if not valid:
        incomplete_count = max(incomplete_count, 1)

    return DecompileResult(stdout, "pycdc", incomplete_count)


# --- Bytecode analysis helpers ---


def count_false_passes(source: str, bc_info: BytecodeInfo) -> int:
    """Count functions/classes with 'pass' that aren't truly empty per bytecode."""
    count = 0

    # Functions with pass body
    for match in re.finditer(r"def\s+(\w+)\s*\([^)]*\)\s*:\s*\n\s+pass\s*(?:\n|$)", source):
        func_name = match.group(1)
        func_end = match.end()
        next_lines = source[func_end : func_end + 200]
        if "# WARNING: Decompyle incomplete" in next_lines.split("\n")[0]:
            continue
        if not is_truly_empty_function(bc_info, func_name):
            count += 1

    # Classes with pass body that have methods in bytecode
    for match in re.finditer(r"class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*\n\s+pass\s*(?:\n|$)", source):
        class_name = match.group(1)
        class_end = match.end()
        next_lines = source[class_end : class_end + 200]
        if "# WARNING: Decompyle incomplete" in next_lines.split("\n")[0]:
            continue
        if not is_truly_empty_class(bc_info, class_name):
            count += 1

    return count


def fill_incomplete_sections(source: str, bc_info: BytecodeInfo) -> str:
    """Fill incomplete sections using bytecode-based reconstruction."""
    if "# WARNING: Decompyle incomplete" not in source:
        return source

    lines = source.split("\n")
    result_lines = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Look ahead for WARNING pattern
        has_incomplete = any(
            i + j < len(lines) and "# WARNING: Decompyle incomplete" in lines[i + j]
            for j in range(1, 4)
        )

        if has_incomplete:
            match = re.match(r"\s*(def|class)\s+(\w+)", line)
            if match:
                kind, name = match.groups()
                indent = len(line) - len(line.lstrip())

                reconstructed = None
                if kind == "def":
                    reconstructed = _extract_function_stub(bc_info, name)
                elif kind == "class":
                    reconstructed = _extract_class_stub(bc_info, name)

                if reconstructed:
                    reconstructed = "\n".join(
                        " " * indent + ln if ln.strip() else ln for ln in reconstructed.split("\n")
                    )
                    result_lines.append(reconstructed)
                    while i < len(lines) and "# WARNING: Decompyle incomplete" not in lines[i]:
                        i += 1
                    i += 1
                    continue

        result_lines.append(line)
        i += 1

    return "\n".join(result_lines)


def _extract_function_stub(bc_info: BytecodeInfo, func_name: str) -> str | None:
    """Extract function stub from bytecode using xdis."""
    code = bc_info.get_code(func_name)
    if code is None:
        return None

    signature = get_function_signature(code)
    return f"{signature}:\n        pass  # TODO: Reconstruct"


def _extract_class_stub(bc_info: BytecodeInfo, class_name: str) -> str | None:
    """Extract class stub from bytecode using xdis."""
    code = bc_info.get_code(class_name)
    if code is None:
        return None

    # Try to find base class from names
    base_class = "object"
    for name in code.co_names:
        if name.endswith("Base") or name.endswith("Component") or name == "ControlSurface":
            base_class = name
            break

    methods = get_class_methods(bc_info, class_name)
    method_stubs = []
    for method_name in methods:
        method_code = bc_info.get_code(f"{class_name}.{method_name}")
        if method_code:
            if method_name == "__init__":
                method_stubs.append(
                    "    def __init__(self, *a, **k):\n        super().__init__(*a, **k)"
                )
            else:
                # Build proper method signature
                args = ["self"] + list(method_code.co_varnames[1 : method_code.co_argcount])
                method_stubs.append(
                    f"    def {method_name}({', '.join(args)}):\n        pass  # TODO"
                )
        else:
            method_stubs.append(f"    def {method_name}(self):\n        pass  # TODO")

    if not method_stubs:
        method_stubs = ["    pass"]

    return f"class {class_name}({base_class}):\n" + "\n\n".join(method_stubs)


def _recover_missing_constants(source: str, bc_info: BytecodeInfo) -> str:
    """Recover missing module-level constants from bytecode.

    Detects constants defined in bytecode but missing from decompiled source,
    extracts their values, and appends them to the source.
    """
    missing = find_missing_module_constants(source, bc_info)
    if not missing:
        return source

    constants = extract_module_constants(bc_info, missing)
    if not constants:
        return source

    # Format and append constants
    lines = [format_constant(name, value) for name, value in constants.items()]
    return source.rstrip() + "\n\n" + "\n\n".join(lines) + "\n"


# --- Main decompilation pipeline ---


def _count_incomplete(result: DecompileResult, bc_info: BytecodeInfo | None) -> int:
    """Count actual incomplete items including false passes."""
    if not result.source:
        return MAX_INCOMPLETE
    count = result.incomplete_count
    if bc_info:
        count += count_false_passes(result.source, bc_info)
    valid, _ = validate_syntax(result.source)
    if not valid:
        count = max(count, 1)
    return count


def _try_improve_with_bytecode(result: DecompileResult, bc_info: BytecodeInfo) -> DecompileResult:
    """Try to improve result using bytecode analysis."""
    if not result.source:
        return result

    improved = result.source

    # Fill incomplete sections (functions/classes with pass stubs)
    improved = fill_incomplete_sections(improved, bc_info)

    # Recover missing module-level constants
    improved = _recover_missing_constants(improved, bc_info)

    new_count = _count_incomplete(DecompileResult(improved, result.tool + "+bytecode", 0), bc_info)
    if new_count < _count_incomplete(result, bc_info) or improved != result.source:
        return DecompileResult(improved, result.tool + "+bytecode", new_count)
    return result


def _try_llm_recovery(
    result: DecompileResult, bc_info: BytecodeInfo, use_llm: bool
) -> DecompileResult:
    """Try LLM-assisted recovery."""
    if not use_llm or not HAS_LLM_RECOVERY or not result.source:
        return result

    # Pass BytecodeInfo for analysis and disassembly
    recovered, count = recover_incomplete_file(result.source, bc_info, use_both=False)
    if count > 0:
        new_count = _count_incomplete(DecompileResult(recovered, "", 0), bc_info)
        return DecompileResult(recovered, result.tool + "+llm", new_count)
    return result


def decompile_file(pyc_path: Path, use_llm: bool = False) -> DecompileResult:
    """Decompile a single file using available tools in priority order."""
    bc_info: BytecodeInfo | None = None

    def get_bc_info() -> BytecodeInfo:
        nonlocal bc_info
        if bc_info is None:
            bc_info = load_bytecode(pyc_path)
        return bc_info

    best_result = DecompileResult("", "none", MAX_INCOMPLETE, "No decompiler succeeded")

    # Try decompyle3 first
    result = decompile_with_decompyle3(pyc_path)
    if result.is_complete:
        return result

    # Try pycdc with bytecode improvement
    result = decompile_with_pycdc(pyc_path)
    if result.is_complete:
        return result

    if result.source:
        bc = get_bc_info()
        result = _try_improve_with_bytecode(result, bc)
        if result.is_complete:
            return result

        result = _try_llm_recovery(result, bc, use_llm)
        if result.is_complete:
            return result

        if _count_incomplete(result, bc) < _count_incomplete(best_result, bc):
            best_result = result

    if best_result.source:
        return best_result

    return DecompileResult(
        f"# Decompilation failed for {pyc_path.name}\n",
        "none",
        MAX_INCOMPLETE,
        "All tools failed",
    )


# --- Directory processing ---


def decompile_directory(
    source_dir: Path,
    output_dir: Path,
    use_llm: bool = False,
    verbose: bool = False,
    workers: int = 10,
) -> dict:
    """Decompile all .pyc files in a directory using parallel workers."""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    stats = {"total": 0, "complete": 0, "incomplete": 0, "failed": 0, "by_tool": {}}
    stats_lock = threading.Lock()
    print_lock = threading.Lock()

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    pyc_files = list(source_dir.rglob("*.pyc"))
    total = len(pyc_files)

    def format_with_ruff(file_path: Path) -> None:
        """Format file with ruff."""
        try:
            subprocess.run(
                ["uv", "run", "ruff", "check", "--fix", "--select=I,F401,UP", str(file_path)],
                capture_output=True,
                timeout=30,
            )
            subprocess.run(
                ["uv", "run", "ruff", "format", str(file_path)],
                capture_output=True,
                timeout=30,
            )
        except (subprocess.SubprocessError, OSError):
            pass

    def process_file(pyc_path: Path) -> tuple[Path, DecompileResult]:
        """Process a single file."""
        rel_path = pyc_path.relative_to(source_dir)
        output_path = output_dir / rel_path.with_suffix(".py")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        result = decompile_file(pyc_path, use_llm=use_llm)

        valid, _ = validate_syntax(result.source) if result.source else (False, None)
        if result.source and not valid:
            result = DecompileResult(
                f"# SYNTAX ERROR - Decompilation produced invalid Python\n{result.source}",
                result.tool,
                max(result.incomplete_count, 1),
                "Syntax error in output",
            )

        output_path.write_text(result.source)
        if valid:
            format_with_ruff(output_path)

        return rel_path, result

    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(process_file, p): p for p in pyc_files}

        for future in as_completed(futures):
            rel_path, result = future.result()
            completed += 1

            with stats_lock:
                stats["total"] += 1
                stats["by_tool"][result.tool] = stats["by_tool"].get(result.tool, 0) + 1

                if result.is_complete:
                    stats["complete"] += 1
                    status = "+"
                elif result.error:
                    stats["failed"] += 1
                    status = "x"
                else:
                    stats["incomplete"] += 1
                    status = "~"

            with print_lock:
                if verbose:
                    file_path = str(rel_path.with_suffix(".py"))
                    gaps = (
                        f" ({result.incomplete_count} gaps)" if result.incomplete_count > 0 else ""
                    )
                    logger.debug("%s %s [%s]%s", status, file_path, result.tool, gaps)
                elif completed % 50 == 0 or completed == total:
                    logger.info(
                        "Progress: %d/%d (%d complete, %d incomplete)",
                        completed,
                        total,
                        stats["complete"],
                        stats["incomplete"],
                    )

    return stats


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Multi-tool Python decompiler")
    parser.add_argument(
        "source", nargs="?", default=str(DEFAULT_SOURCE), help="Source directory with .pyc files"
    )
    parser.add_argument("-o", "--output", default=str(OUTPUT_DIR), help="Output directory")
    parser.add_argument("--no-llm", action="store_true", help="Disable LLM-assisted recovery")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("-q", "--quiet", action="store_true", help="Quiet mode (errors only)")
    args = parser.parse_args()

    # Configure logging based on verbosity
    if args.quiet:
        logging.basicConfig(level=logging.ERROR, format="%(levelname)s: %(message)s")
    elif args.verbose:
        logging.basicConfig(level=logging.DEBUG, format="%(levelname)s: %(message)s")
    else:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    source_dir = Path(args.source)
    output_dir = Path(args.output)

    if not source_dir.exists():
        logger.error("Source directory not found: %s", source_dir)
        sys.exit(1)

    if not PYCDC.exists():
        logger.error("pycdc not found at %s", PYCDC)
        logger.error("Build it: cd pycdc && cmake . && make")
        sys.exit(1)

    use_llm = not args.no_llm and HAS_LLM_RECOVERY and llm_is_available()
    if not args.no_llm and not use_llm:
        if not HAS_LLM_RECOVERY:
            logger.warning("llm_recovery module not available")
        else:
            logger.warning("No coding agent found (claude/opencode)")
    elif use_llm:
        logger.info("LLM recovery enabled: %s", find_coding_agent())

    print("Multi-Tool Decompiler")
    print("=" * 50)
    print(f"Source: {source_dir}")
    print(f"Output: {output_dir}")
    tools = ["decompyle3", "pycdc"]
    if use_llm:
        tools.append("llm")
    print(f"Tools: {', '.join(tools)}")
    print()

    print("Decompiling...")
    stats = decompile_directory(source_dir, output_dir, use_llm=use_llm)

    print()
    print("Results:")
    print(f"  Total: {stats['total']}")
    print(f"  Complete: {stats['complete']}")
    print(f"  Incomplete: {stats['incomplete']}")
    print(f"  Failed: {stats['failed']}")
    print()
    print("By tool:")
    for tool, count in sorted(stats["by_tool"].items(), key=lambda x: -x[1]):
        print(f"  {tool}: {count}")


if __name__ == "__main__":
    main()

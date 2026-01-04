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
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from bytecode_utils import is_truly_empty_function, validate_syntax

# Configure logging
logging.getLogger("transformers").setLevel(logging.ERROR)
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

try:
    from pylingual import decompile as pylingual_decompile

    HAS_PYLINGUAL = True
except ImportError:
    HAS_PYLINGUAL = False

__all__ = [
    "DecompileResult",
    "decompile_file",
    "decompile_directory",
    "get_bytecode_disassembly",
]

# Paths
SCRIPT_DIR = Path(__file__).parent
PYCDC = SCRIPT_DIR / "pycdc" / "pycdc"
PYCDAS = SCRIPT_DIR / "pycdc" / "pycdas"
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


def get_bytecode_disassembly(pyc_path: Path) -> str:
    """Get bytecode disassembly using pycdas."""
    if not PYCDAS.exists():
        return ""
    stdout, _, _ = run_command([str(PYCDAS), str(pyc_path)])
    return stdout


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


def decompile_with_pylingual(pyc_path: Path) -> DecompileResult:
    """Try pylingual - ML-based decompiler library."""
    if not HAS_PYLINGUAL:
        return DecompileResult("", "pylingual", MAX_INCOMPLETE, "pylingual not installed")

    try:
        result = pylingual_decompile(pyc_path)
        # pylingual API varies between versions
        source = getattr(result, "decompiled_source", None) or getattr(result, "source", None)
        if not source or not source.strip():
            return DecompileResult("", "pylingual", MAX_INCOMPLETE, "Empty output")

        incomplete_count = source.count("# WARNING:") + source.count("# TODO:")
        return DecompileResult(source, "pylingual", incomplete_count)
    except Exception as e:
        # pylingual can fail in various ways (model loading, inference, etc.)
        return DecompileResult("", "pylingual", MAX_INCOMPLETE, str(e)[:200])


# --- Bytecode analysis helpers ---


def count_false_passes(source: str, bytecode: str) -> int:
    """Count functions/classes with 'pass' that aren't truly empty per bytecode."""
    count = 0

    # Functions with pass body
    for match in re.finditer(r"def\s+(\w+)\s*\([^)]*\)\s*:\s*\n\s+pass\s*(?:\n|$)", source):
        func_name = match.group(1)
        func_end = match.end()
        next_lines = source[func_end : func_end + 200]
        if "# WARNING: Decompyle incomplete" in next_lines.split("\n")[0]:
            continue
        if not is_truly_empty_function(bytecode, func_name):
            count += 1

    # Classes with pass body that have methods in bytecode
    for match in re.finditer(r"class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*\n\s+pass\s*(?:\n|$)", source):
        class_name = match.group(1)
        class_end = match.end()
        next_lines = source[class_end : class_end + 200]
        if "# WARNING: Decompyle incomplete" in next_lines.split("\n")[0]:
            continue
        if re.search(rf"Qualified Name: {re.escape(class_name)}\.\w+", bytecode):
            count += 1

    return count


def fill_incomplete_sections(source: str, bytecode: str) -> str:
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
                    reconstructed = _extract_function_stub(bytecode, name)
                elif kind == "class":
                    reconstructed = _extract_class_stub(bytecode, name)

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


def _extract_function_stub(bytecode: str, func_name: str) -> str | None:
    """Extract function stub from bytecode."""
    pattern = rf"Object Name: {re.escape(func_name)}.*?(?=\n\s*\[Code\]|\Z)"
    match = re.search(pattern, bytecode, re.DOTALL)
    if not match:
        return None

    func_bc = match.group(0)

    args_match = re.search(r"Arg Count: (\d+)", func_bc)
    arg_count = int(args_match.group(1)) if args_match else 0

    locals_match = re.search(r"\[Locals\+Names\](.*?)\[Constants\]", func_bc, re.DOTALL)
    local_names = []
    if locals_match:
        for line in locals_match.group(1).strip().split("\n"):
            name = line.strip().strip("'")
            if name and name != "None":
                local_names.append(name)

    args = local_names[:arg_count] if local_names else [f"arg{i}" for i in range(arg_count)]
    if "CO_VARARGS" in func_bc:
        args.append("*args")
    if "CO_VARKEYWORDS" in func_bc:
        args.append("**kwargs")

    return f"def {func_name}({', '.join(args)}):\n        pass  # TODO: Reconstruct"


def _extract_class_stub(bytecode: str, class_name: str) -> str | None:
    """Extract class stub from bytecode."""
    pattern = rf"Object Name: {re.escape(class_name)}.*?(?=\n\[Code\]\n\s*File Name:|\Z)"
    match = re.search(pattern, bytecode, re.DOTALL)
    if not match:
        return None

    class_bc = match.group(0)

    names_match = re.search(r"\[Names\](.*?)\[Locals", class_bc, re.DOTALL)
    base_class = "object"
    if names_match:
        for name in names_match.group(1).strip().split("\n"):
            name = name.strip().strip("'")
            if name.endswith("Base") or name.endswith("Component") or name == "ControlSurface":
                base_class = name
                break

    methods = re.findall(
        rf"Object Name: (\w+).*?Qualified Name: {re.escape(class_name)}\.(\w+)", class_bc
    )
    method_stubs = []
    for _, method_name in methods:
        if method_name == "__init__":
            method_stubs.append(
                "    def __init__(self, *a, **k):\n        super().__init__(*a, **k)"
            )
        else:
            method_stubs.append(f"    def {method_name}(self):\n        pass  # TODO")

    if not method_stubs:
        method_stubs = ["    pass"]

    return f"class {class_name}({base_class}):\n" + "\n\n".join(method_stubs)


# --- Main decompilation pipeline ---


def _count_incomplete(result: DecompileResult, bytecode: str) -> int:
    """Count actual incomplete items including false passes."""
    if not result.source:
        return MAX_INCOMPLETE
    count = result.incomplete_count
    if bytecode:
        count += count_false_passes(result.source, bytecode)
    valid, _ = validate_syntax(result.source)
    if not valid:
        count = max(count, 1)
    return count


def _try_improve_with_bytecode(result: DecompileResult, bytecode: str) -> DecompileResult:
    """Try to improve result using bytecode analysis."""
    if not bytecode or not result.source:
        return result

    filled = fill_incomplete_sections(result.source, bytecode)
    new_count = _count_incomplete(DecompileResult(filled, result.tool + "+bytecode", 0), bytecode)
    if new_count < _count_incomplete(result, bytecode):
        return DecompileResult(filled, result.tool + "+bytecode", new_count)
    return result


def _try_llm_recovery(result: DecompileResult, bytecode: str, use_llm: bool) -> DecompileResult:
    """Try LLM-assisted recovery."""
    if not use_llm or not HAS_LLM_RECOVERY or not result.source or not bytecode:
        return result

    recovered, count = recover_incomplete_file(result.source, bytecode, use_both=False)
    if count > 0:
        new_count = _count_incomplete(DecompileResult(recovered, "", 0), bytecode)
        return DecompileResult(recovered, result.tool + "+llm", new_count)
    return result


def decompile_file(pyc_path: Path, use_llm: bool = False) -> DecompileResult:
    """Decompile a single file using available tools in priority order."""
    bytecode = ""

    def get_bytecode() -> str:
        nonlocal bytecode
        if not bytecode:
            bytecode = get_bytecode_disassembly(pyc_path)
        return bytecode

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
        bc = get_bytecode()
        result = _try_improve_with_bytecode(result, bc)
        if result.is_complete:
            return result

        result = _try_llm_recovery(result, bc, use_llm)
        if result.is_complete:
            return result

        if _count_incomplete(result, bc) < _count_incomplete(best_result, bc):
            best_result = result

    # Try pylingual as fallback
    pylingual_result = decompile_with_pylingual(pyc_path)
    if pylingual_result.is_complete:
        return pylingual_result

    bc = get_bytecode()
    if pylingual_result.source and _count_incomplete(pylingual_result, bc) < _count_incomplete(
        best_result, bc
    ):
        best_result = pylingual_result

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
    tools = ["decompyle3", "pycdc", "pylingual"]
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

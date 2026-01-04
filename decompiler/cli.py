#!/usr/bin/env python3
# ruff: noqa: E402
"""
Decompiler CLI - Multi-tool Python bytecode decompiler.

Usage:
    uv run python cli.py <file.pyc>           # Decompile single file
    uv run python cli.py <directory>          # Decompile directory
    uv run python cli.py <file.pyc> --no-llm  # Disable LLM-assisted recovery
"""

from __future__ import annotations

import os
import sys

# Force unbuffered output
os.environ["PYTHONUNBUFFERED"] = "1"
sys.stdout.reconfigure(line_buffering=True)  # type: ignore[union-attr]
sys.stderr.reconfigure(line_buffering=True)  # type: ignore[union-attr]

import argparse
from pathlib import Path
from typing import TYPE_CHECKING

from standalone_decompile import PYCDC, decompile_directory, decompile_file

if TYPE_CHECKING:
    from standalone_decompile import DecompileResult

try:
    from llm_recovery import find_coding_agent
    from llm_recovery import is_available as llm_is_available

    HAS_LLM = True
except ImportError:
    HAS_LLM = False
    find_coding_agent = None  # type: ignore[assignment]
    llm_is_available = lambda: False  # type: ignore[assignment]  # noqa: E731


def decompile_single_file(
    pyc_path: Path,
    output_path: Path | None = None,
    *,
    use_llm: bool = False,
    verbose: bool = False,
) -> DecompileResult:
    """Decompile a single .pyc file."""
    result = decompile_file(pyc_path, use_llm=use_llm)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(result.source)
        if verbose:
            print(f"Written to: {output_path}")
    else:
        print(result.source)

    return result


def main() -> int:
    """CLI entry point. Returns exit code."""
    parser = argparse.ArgumentParser(
        description="Multi-tool Python bytecode decompiler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s script.pyc                    # Print decompiled source
  %(prog)s script.pyc -o script.py       # Write to file
  %(prog)s ./pyc_dir -o ./output         # Decompile directory
  %(prog)s script.pyc --no-llm           # Disable LLM-assisted recovery
""",
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input .pyc file or directory",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output file or directory",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Disable LLM-assisted recovery",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Quiet output (less verbose)",
    )
    args = parser.parse_args()

    # Validate input
    if not args.input.exists():
        print(f"Error: Input not found: {args.input}", file=sys.stderr)
        return 1

    if not PYCDC.exists():
        print(f"Error: pycdc not found at {PYCDC}", file=sys.stderr)
        print("Build it: cd pycdc && cmake . && make", file=sys.stderr)
        return 1

    # Check LLM availability (enabled by default)
    use_llm = not args.no_llm and HAS_LLM and llm_is_available()
    if not args.no_llm and not use_llm:
        if not HAS_LLM:
            print("Warning: llm_recovery module not available", file=sys.stderr)
        else:
            print("Warning: No coding agent found (claude/opencode)", file=sys.stderr)
    elif use_llm and not args.quiet:
        print(f"LLM recovery enabled: {find_coding_agent()}")

    # Process input
    if args.input.is_file():
        # Single file
        if args.input.suffix != ".pyc":
            print(f"Warning: Expected .pyc file, got {args.input.suffix}", file=sys.stderr)

        result = decompile_single_file(
            args.input,
            output_path=args.output,
            use_llm=use_llm,
            verbose=not args.quiet,
        )

        if not args.quiet:
            print(f"Tool: {result.tool}", file=sys.stderr)
            if result.incomplete_count > 0:
                print(f"Incomplete sections: {result.incomplete_count}", file=sys.stderr)

    elif args.input.is_dir():
        # Directory
        output_dir = args.output or Path("output")

        if not args.quiet:
            print(f"Source: {args.input}")
            print(f"Output: {output_dir}")
            tools = "decompyle3, pycdc"
            if use_llm:
                tools += ", llm"
            print(f"Tools: {tools}")
            print()

        stats = decompile_directory(
            args.input,
            output_dir,
            use_llm=use_llm,
            verbose=not args.quiet,
        )

        print(f"Total: {stats['total']}")
        print(f"Complete: {stats['complete']}")
        print(f"Incomplete: {stats['incomplete']}")
        print(f"Failed: {stats['failed']}")

        if not args.quiet:
            print("\nBy tool:")
            for tool, count in sorted(stats["by_tool"].items(), key=lambda x: -x[1]):
                print(f"  {tool}: {count}")

    else:
        print(f"Error: Invalid input: {args.input}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

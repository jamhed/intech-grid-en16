# Decompiler Project

Multi-tool Python bytecode decompiler for Ableton Live MIDI Remote Scripts (Python 3.11+).

## Tools

Uses `uv` for all Python operations:
- `uv sync` - Install dependencies
- `uv run python -m cli` - Run CLI
- `uv run ruff check .` - Lint
- `uv run ruff format .` - Format

## Architecture

```
cli.py                 - CLI entry point (argparse)
standalone_decompile.py - Core decompilation logic
llm_recovery.py        - LLM-assisted recovery (claude-sonnet-4-20250514)
pycdc/                 - pycdc/pycdas binaries (build with cmake)
```

## Decompilation Pipeline

1. **decompyle3** - Best quality, fails on Python 3.11+
2. **pycdc** - Handles 3.11+ but often incomplete
3. **LLM recovery** - Fill gaps using bytecode + claude-sonnet
4. **pylingual** - ML-based decompiler library (fallback)
5. **pychaos** - Web API last resort

Parallel processing: 10 workers by default.
Ruff formatting: Auto-applies after each file.

## Key Patterns

- Use AST for all Python code parsing (no regex for code analysis)
- Bytecode is source of truth for verifying `pass` bodies
- Detect false-pass functions: `is_truly_empty_function()` via Stack Size, [Names], nested [Code]
- Detect false-pass classes: `count_false_pass_classes()` checks for methods in bytecode
- Strip leftover WARNING comments when all code is recovered
- Fix syntax errors with LLM before AST analysis

## Default Source

```
/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/MIDI Remote Scripts
```

## CLI Flags

- `--no-llm` - Disable LLM recovery
- `-q/--quiet` - Less verbose output
- `-o/--output` - Output directory

## Examples

```bash
uv run python -m cli script.pyc                    # Print decompiled source
uv run python -m cli script.pyc -o script.py       # Write to file
uv run python -m cli ./pyc_dir -o ./output         # Decompile directory
uv run python -m cli script.pyc --no-llm           # Disable LLM recovery
```

# Python Bytecode Decompiler

Multi-tool Python 3.11+ bytecode decompiler with LLM-assisted recovery.

## Features

- **Multi-tool strategy**: Tries decompyle3 first, falls back to pycdc
- **Bytecode analysis**: Reconstructs incomplete functions from disassembly
- **LLM recovery**: Uses Claude Code (Opus 4.5) and OpenCode (GPT-5) for complex cases
- **AST validation**: All output validated with Python's AST parser

## Installation

```bash
# Install dependencies
uv sync

# Build pycdc (required)
cd pycdc && cmake . && make && cd ..
```

### Optional: LLM Recovery

For LLM-assisted recovery, install one or both:

- [Claude Code](https://github.com/anthropics/claude-code) - `npm install -g @anthropic-ai/claude-code`
- [OpenCode](https://github.com/openai/opencode) - follow installation instructions

## Usage

### CLI

```bash
# Decompile single file (prints to stdout)
uv run python cli.py script.pyc

# Decompile to file
uv run python cli.py script.pyc -o script.py

# Decompile directory
uv run python cli.py ./pyc_dir -o ./output

# Enable LLM-assisted recovery
uv run python cli.py script.pyc --llm

# Verbose output
uv run python cli.py script.pyc -v
```

### Python API

```python
from standalone_decompile import decompile_file
from pathlib import Path

result = decompile_file(Path("script.pyc"), use_llm=True)

print(f"Tool: {result.tool}")           # e.g., "pycdc+llm"
print(f"Complete: {result.is_complete}")
print(result.source)
```

## How It Works

### Decompilation Pipeline

1. **decompyle3** - Complete output when it works (best quality)
2. **pycdc** - Handles Python 3.11+ patterns (may be incomplete)
3. **Bytecode analysis** - Reconstructs functions from pycdas disassembly
4. **LLM recovery** - For syntax errors or remaining incomplete sections

### LLM Recovery Strategy

When `--llm` is enabled:

- **Syntax errors detected** → Full file recovery with LLM
- **Incomplete functions** → Targeted function recovery
- **Parallel execution** → Calls both Claude and OpenCode simultaneously
- **Quality scoring** → Picks the best valid result

All LLM output is validated with Python's AST parser before acceptance.

## Project Structure

```
decompiler/
├── cli.py                 # CLI entry point
├── standalone_decompile.py # Core decompilation logic
├── llm_recovery.py        # LLM-assisted recovery
├── ast_validator.py       # AST utilities
├── pycdc/                 # pycdc/pycdas binaries (build required)
├── pyproject.toml
└── README.md
```

## Requirements

- Python 3.12+
- pycdc (built from source)
- decompyle3, xdis (via uv)

## License

MIT

# Decompiling Ableton MIDI Remote Scripts

Guide to decompiling Ableton Live's MIDI Remote Scripts for reference and analysis.

## Overview

Ableton Live's control surface scripts are distributed as compiled Python bytecode (`.pyc` files). Decompiling them allows studying the framework implementation and understanding how official controllers work.

**Important:** Decompiled scripts are for reference only. They cannot be run directly and may have incomplete sections depending on the decompiler used.

**Python 3.11 limitation:** Live 12.2+ uses Python 3.11, which is difficult to decompile reliably. No current tool produces complete output—expect incomplete methods and missing code. For complete decompilations, use gluon's Live 12.0 scripts (Python 3.7).

## Available Decompiled Scripts

| Source | Live Version | Python | Location |
|--------|--------------|--------|----------|
| [gluon/AbletonLive9](https://github.com/gluon/AbletonLive9_RemoteScripts) | 9.x | 2.x | `__ext__/AbletonLive9_MIDIRemoteScripts/` |
| [gluon/AbletonLive10.1](https://github.com/gluon/AbletonLive10.1_MIDIRemoteScripts) | 10.1.19 | 2.x | `__ext__/AbletonLive10_MIDIRemoteScripts/` |
| [gluon/AbletonLive11](https://github.com/gluon/AbletonLive11_MIDIRemoteScripts) | 11.x | 3.x | `__ext__/AbletonLive11_MIDIRemoteScripts/` |
| [gluon/AbletonLive12](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) | 12.0 | 3.7 | `__ext__/AbletonLive12_MIDIRemoteScripts/` |
| Local decompilation | 12.2 beta | 3.11 | `decompiler/output/` |

## Decompilation Tools

### For Python 3.7 and earlier (Live 12.0)

**uncompyle6** / **decompyle3** - produces complete, readable output:

```bash
pip install decompyle3
decompyle3 /path/to/script.pyc -o output.py
```

### For Python 3.11+ (Live 12.2 beta)

**pycdc** (Decompyle++) - C++ decompiler, handles newer bytecode:

```bash
git clone https://github.com/zrax/pycdc.git
cd pycdc && cmake . && make
./pycdc /path/to/script.pyc
```

**pylingual** - ML-based decompiler (experimental):

```bash
pip install pylingual
# Has issues with some control flow patterns
```

## Local Decompilation Setup

The `decompiler/` project provides a ready-to-use setup:

```bash
cd decompiler

# Install dependencies (uses uv)
uv sync

# Build pycdc
cd pycdc && cmake . && make && cd ..

# Run decompilation
uv run python decompile.py
```

### Configuration

Edit `decompile.py` to change paths:

```python
PYCDC = Path(__file__).parent / "pycdc" / "pycdc"
BETA_SCRIPTS = Path("/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/MIDI Remote Scripts")
OUTPUT_DIR = Path(__file__).parent / "output"
```

### Script Locations

| Platform | Path |
|----------|------|
| macOS | `/Applications/Ableton Live*.app/Contents/App-Resources/MIDI Remote Scripts/` |
| Windows | `C:\ProgramData\Ableton\Live*\Resources\MIDI Remote Scripts\` |

## Decompiler Comparison

### uncompyle6 (gluon's scripts)

**Pros:**
- Complete decompilation for Python ≤3.8
- Preserves relative imports correctly
- Full method implementations

**Output example:**
```python
# uncompyle6 version 3.9.1
# Python bytecode version base 3.7.0 (3394)
from __future__ import absolute_import, print_function, unicode_literals
from builtins import object

class ButtonValue(object):
    midi_value = 0

    def __init__(self, midi_value=None, *a, **k):
        (super(ButtonValue, self).__init__)(*a, **k)
        if midi_value is not None:
            self.midi_value = midi_value

    def __eq__(self, other):
        try:
            return id(self) == id(other) or self.midi_value == other
        except NotImplementedError:
            return False
```

### pycdc (our scripts)

**Pros:**
- Supports Python 3.11+ bytecode
- Fast C++ implementation
- Actively maintained

**Cons:**
- Some methods show `# WARNING: Decompyle incomplete`
- Uses absolute imports instead of relative
- Complex closures may fail

**Output example:**
```python
# Source Generated with Decompyle++
# File: ButtonElement.pyc (Python 3.11)

from InputControlElement import MIDI_CC_TYPE, InputControlElement

class ButtonValue(object):
    pass
# WARNING: Decompyle incomplete
```

## Python Version Changes

### Live 12.0 (Python 3.7)

```python
# Python 2/3 compatibility layer
from __future__ import absolute_import, print_function, unicode_literals
from builtins import filter, map, range, str
from future.utils import string_types
```

### Live 12.2 Beta (Python 3.11)

```python
# Pure Python 3.11 - no compatibility imports
import logging
from functools import partial
from itertools import chain
```

Key changes:
- Removed `__future__` imports
- Removed `builtins` and `future.utils` dependencies
- Native Python 3 syntax throughout

## Live 12.2 Beta Findings

### New Controllers (7)

All use `ableton.v3` framework:

| Controller | Files | Notes |
|------------|-------|-------|
| **Move** | 45 | Ableton's standalone hardware |
| **Launchkey_MK4** | 26 | Novation Launchkey Mark 4 |
| **Launchkey_Mini_MK4** | 5 | Launchkey Mini Mark 4 |
| **Launch_Control_XL_3** | 15 | Launch Control XL Mark 3 |
| **KeyLab_mk3** | 12 | Arturia KeyLab Mark 3 |
| **MPK_mini_IV** | 12 | Akai MPK mini Mark 4 |
| **MPK_mini_Plus** | 5 | Akai MPK mini Plus |

### Move Controller Structure

Ableton's new standalone hardware has the most comprehensive v3 implementation:

```
Move/
├── __init__.py          # ControlSurfaceSpecification
├── auto_arm.py
├── clip_actions.py
├── colors.py
├── device.py
├── device_navigation.py
├── dialog.py
├── display.py
├── drum_group.py
├── elements.py
├── firmware.py
├── instrument.py
├── loop_length.py
├── loop_selector.py
├── mappings.py
├── menu.py
├── menu_cursor.py
├── menu_modes.py
├── midi.py
├── note_editor.py
├── note_repeat.py
├── note_settings.py
├── quantization.py
├── recording.py
├── session.py
├── skin.py
├── step_sequence.py
├── transport.py
└── ... (45 files total)
```

### Framework Statistics

| Version | Controllers | Framework |
|---------|-------------|-----------|
| Live 12.0 | 136 | Mixed (_Framework, v2, v3) |
| Live 12.2 beta | 143 | +7 new v3 controllers |

## Bytecode Version Detection

Check Python version from `.pyc` magic number:

```python
import struct

with open('script.pyc', 'rb') as f:
    magic = struct.unpack('<H', f.read(2))[0]

# Magic numbers:
# 3394 = Python 3.7
# 3413 = Python 3.8
# 3425 = Python 3.9
# 3439 = Python 3.10
# 3495 = Python 3.11
# 3531 = Python 3.12
```

## Handling Incomplete Decompilation

When pycdc outputs `# WARNING: Decompyle incomplete`, several strategies can recover the missing code:

### 1. Use Bytecode Disassembly

**pycdas** (included with pycdc) shows raw bytecode instructions:

```bash
cd decompiler/pycdc
./pycdas /path/to/script.pyc
```

**xdis** provides detailed Python bytecode analysis:

```bash
pip install xdis
pydisasm /path/to/script.pyc
```

The disassembly shows actual opcodes that can be manually translated to Python.

### 2. Reference Complete Decompilations

Use gluon's Live 12.0 scripts (Python 3.7, fully decompiled) as reference:

```bash
# Find similar code in complete decompilation
diff decompiler/output/Launchkey_MK4/__init__.py \
     __ext__/AbletonLive12_MIDIRemoteScripts/Launchkey_MK3/__init__.py
```

Most framework code is unchanged between versions - only API additions differ.

### 3. Multi-Tool Strategy

Combine multiple decompilers for better coverage:

| Tool | Best For |
|------|----------|
| pycdc | Python 3.11+ initial decompilation |
| pycdas | Bytecode when decompilation fails |
| xdis | Detailed opcode analysis |
| pydumpck | Combines pycdc + uncompyle6 output |

### 4. LLM-Assisted Recovery

For small incomplete functions:
1. Get bytecode disassembly with pycdas/xdis
2. Provide context from surrounding code
3. Use LLM to reconstruct Python from bytecode

### 5. Known pycdc Limitations

Common patterns that fail in Python 3.11:
- Complex closures and nested functions
- Generator expressions with multiple conditions
- Match statements (Python 3.10+)
- Exception groups (Python 3.11)

**Workaround:** Check pycdc issues for patches:
- [Issue #452](https://github.com/zrax/pycdc/issues/452) - Python 3.11 support tracking

### 6. Alternative Decompilers

| Tool | Status | Notes |
|------|--------|-------|
| py311-decompiler | WIP | Dedicated Python 3.11 support |
| pydumpck | Active | Multi-tool combination |
| pylingual | Experimental | ML-based, unreliable |

## Recommendations

### For Reference Reading

Use **gluon's repositories** - they have complete decompilation:

```bash
# Clone for reference
git clone https://github.com/gluon/AbletonLive12_MIDIRemoteScripts.git
```

### For Latest Controllers

Use **local decompilation** with pycdc:

```bash
cd decompiler
uv run python decompile.py
```

Then check `output/` for new controllers not in gluon's repo.

### For Framework Study

Compare across versions to understand evolution:

```bash
# Compare _Framework across versions
diff -r __ext__/AbletonLive11_MIDIRemoteScripts/_Framework \
        __ext__/AbletonLive12_MIDIRemoteScripts/_Framework
```

## See Also

- [Framework Versions](ableton-framework-versions.md) - Framework history
- [Framework Evolution](framework-evolution.md) - Code comparison
- [Control Surface Architecture](control-surface.md) - _Framework documentation
- [oslo1989/ableton-control-surface-toolkit](https://github.com/oslo1989/ableton-control-surface-toolkit) - Decompilation toolkit

## Tools Reference

| Tool | URL | Python Support | Use Case |
|------|-----|----------------|----------|
| uncompyle6 | [PyPI](https://pypi.org/project/uncompyle6/) | 2.x - 3.8 | Complete decompilation |
| decompyle3 | [PyPI](https://pypi.org/project/decompyle3/) | 3.7 - 3.8 | Complete decompilation |
| pycdc | [GitHub](https://github.com/zrax/pycdc) | 1.0 - 3.12 | Initial decompilation |
| pycdas | Included with pycdc | 1.0 - 3.12 | Bytecode disassembly |
| xdis | [PyPI](https://pypi.org/project/xdis/) | 2.4 - 3.12 | Detailed bytecode analysis |
| pylingual | [GitHub](https://github.com/syssec-utd/pylingual) | 3.9 - 3.11 | ML-based (experimental) |
| pydumpck | [GitHub](https://github.com/svencc/pydumpck) | 3.x | Multi-tool combination |

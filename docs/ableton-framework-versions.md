# Ableton MIDI Remote Scripts Framework Versions

Reference for the three framework generations used in Ableton Live MIDI Remote Scripts.

**Source:** Decompiled scripts in `__ext__/` from [gluon's repositories](https://github.com/gluon)

## Overview

Ableton's MIDI Remote Scripts have evolved through three major framework versions:

| Framework | Introduced | Controllers (Live 12) | Base Class | Key Pattern |
|-----------|------------|----------------------|------------|-------------|
| `_Framework` | Live 4+ | 45 | `OptimizedControlSurface` | Direct component setup |
| `ableton.v2` | Live 9 | 29 | `ControlSurface` | Capabilities system |
| `ableton.v3` | Live 11 | 11 | `ControlSurface` + `Specification` | Declarative configuration |

## Ableton Live Version History

| Version | Release | Python | Controllers | Notes |
|---------|---------|--------|-------------|-------|
| Live 9 | Mar 2013 | 2.x | 97 | Push 1, `ableton.v2` introduced |
| Live 10 | Feb 2018 | 2.x | 116 | Logging, Subject events, MessageScheduler |
| Live 11 | Feb 2021 | 3.x | 133 | Python 3, **`ableton.v3` introduced** |
| Live 12 | Feb 2024 | 3.7 | 136 | v3 enhanced with `live/` subdir |
| Live 12.2 beta | 2025 | 3.11 | 143 | +7 new v3 controllers, Python upgraded |

All third-party scripts must use Python 3 for Live 11+.

## Live 12.2 Beta: New Controllers

Seven new controllers added, all using `ableton.v3`:

| Controller | Files | Notes |
|------------|-------|-------|
| Move | 45 | Ableton's standalone hardware |
| Launchkey_MK4 | 26 | Novation Launchkey Mark 4 |
| Launchkey_Mini_MK4 | 5 | Launchkey Mini Mark 4 |
| Launch_Control_XL_3 | 15 | Launch Control XL Mark 3 |
| KeyLab_mk3 | 12 | Arturia KeyLab Mark 3 |
| MPK_mini_IV | 12 | Akai MPK mini Mark 4 |
| MPK_mini_Plus | 5 | Akai MPK mini Plus |

## Python 2 → 3 Migration (Live 10 → 11)

Key syntax changes visible in decompiled scripts:

```python
# Live 10 (Python 2 with future imports)
from __future__ import absolute_import, print_function, unicode_literals
from itertools import ifilter, imap
model_name=u'Controller'

# Live 11+ (Python 3)
from builtins import filter, map, range, str
from future.utils import string_types
model_name='Controller'
```

- `ifilter`, `imap` removed (use native `filter`, `map`)
- Unicode literals `u'...'` no longer needed
- `publish_self` parameter removed from ControlSurface

## \_Framework (Legacy)

The original framework, still used by the majority of controllers.

### Detection Pattern

```python
from _Framework.ControlSurface import ControlSurface
from _Framework.ControlSurfaceComponent import ControlSurfaceComponent
from _Framework.ButtonElement import ButtonElement
```

### Structure

```
_Framework/
├── ControlSurface.py          # Main entry point
├── ControlSurfaceComponent.py # Component base
├── ButtonElement.py           # Button controls
├── EncoderElement.py          # Encoder controls
├── SliderElement.py           # Fader controls
├── MixerComponent.py          # Track mixing
├── SessionComponent.py        # Clip grid
├── TransportComponent.py      # Playback controls
├── DeviceComponent.py         # Device parameters
├── Layer.py                   # Control mapping
├── ModesComponent.py          # Mode switching
└── ... (57 modules total)
```

### Example

```python
from _Framework.ControlSurface import ControlSurface
from _Framework.TransportComponent import TransportComponent
from _Framework.ButtonElement import ButtonElement
from _Framework.InputControlElement import MIDI_CC_TYPE

class MyController(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        with self.component_guard():
            transport = TransportComponent()
            play = ButtonElement(True, MIDI_CC_TYPE, 0, 64)
            transport.set_play_button(play)

def create_instance(c_instance):
    return MyController(c_instance)
```

### Controllers Using \_Framework

AIRA_MX_1, Alesis_V, Alesis_VI, Alesis_VX, APC_Key_25, APC_mini, APC20, APC40, APC40_MkII, Axiom_25_Classic, Axiom_AIR_25_49_61, Axiom_AIR_Mini32, Axiom_DirectLink, AxiomPro, BCR2000, KeyFadr, KeyPad, Launch_Control, Launch_Control_XL, Launchkey, Launchkey_Mini, Launchpad, Launchpad_MK2, Launchpad_Pro, LPD8, MackieControl, microKONTROL, MPD24, MPD32, MPK_mini_mkI, MPK_mini_mkII, MPK_mini_mkIII, MPK225, MPK249, MPK25, MPK261, MPK49, Novation_Impulse, Oxygen8, Ozone, padKONTROL, RemoteSL, RemoteSL_Classic, Roland_A_PRO, UC33e

## ableton.v2 (Intermediate)

Introduced better abstractions and standardized capabilities system.

### Detection Pattern

```python
from ableton.v2.control_surface import ControlSurface
from ableton.v2.control_surface.capabilities import (
    CONTROLLER_ID_KEY, PORTS_KEY, NOTES_CC, SCRIPT, REMOTE,
    controller_id, inport, outport
)
```

### Structure

```
ableton/
└── v2/
    ├── base/                  # Core utilities
    │   ├── dependency.py
    │   ├── event.py
    │   ├── signal.py
    │   └── task.py
    └── control_surface/
        ├── __init__.py        # ControlSurface, SimpleControlSurface
        ├── capabilities.py    # Controller metadata
        ├── component.py       # Component base
        ├── control_element.py # Control base
        ├── layer.py           # Layer system
        └── mode.py            # Mode system
```

### Key Features

- **Capabilities System**: Standardized controller metadata
- **Enhanced Ports**: `NOTES_CC`, `SCRIPT`, `REMOTE` port properties
- **Firmware Detection**: `FIRMWARE_KEY`, `AUTO_LOAD_KEY` support
- **Simplified Base**: `SimpleControlSurface` for basic controllers

### Example

```python
from ableton.v2.control_surface import ControlSurface
from ableton.v2.control_surface.capabilities import (
    CONTROLLER_ID_KEY, PORTS_KEY, NOTES_CC, SCRIPT, REMOTE,
    controller_id, inport, outport
)

class MyController(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        with self.component_guard():
            self._setup_components()

def get_capabilities():
    return {
        CONTROLLER_ID_KEY: controller_id(
            vendor_id=0x1234,
            product_ids=[0x5678],
            model_name=['My Controller']
        ),
        PORTS_KEY: [
            inport(props=[NOTES_CC, SCRIPT, REMOTE]),
            outport(props=[SCRIPT, REMOTE])
        ]
    }

def create_instance(c_instance):
    return MyController(c_instance)
```

### Controllers Using ableton.v2

\_MxDCore, Akai_Force_MPC, Blackstar_Live_Logic, BLOCKS, Code_Series, CTRL49, Faderport, Faderport_16, Faderport_16_XT, Faderport_8, Hammer_88_Pro, iRig_Keys_IO, KeyLab_Essential, KeyLab_mkII, Komplete_Kontrol_A, Komplete_Kontrol_S_Mk2, Launchkey_Mini_MK3, Launchkey_MK3, Launchpad_Mini_MK3, Launchpad_Pro_MK3, Launchpad_X, MaxForLive, Oxygen_5th_Gen, Oxygen_Pro, Oxygen_Pro_Mini, Push, Push2, Roland_FA, SL_MkIII

## ableton.v3 (Latest)

The newest framework with declarative specification-based configuration.

### Detection Pattern

```python
from ableton.v3.control_surface import ControlSurface, ControlSurfaceSpecification
from ableton.v3.control_surface import create_skin
from ableton.v3.base import listens, task
```

### Structure

```
ableton/
└── v3/
    ├── base/
    │   ├── __init__.py        # listens, task decorators
    │   └── util.py
    └── control_surface/
        ├── __init__.py        # ControlSurface, ControlSurfaceSpecification
        ├── elements.py        # Element definitions
        ├── skin.py            # create_skin()
        └── component_map.py   # Component mapping
```

### Key Features

- **Specification Pattern**: Declarative controller configuration
- **Component Map**: Explicit component wiring
- **Skin System**: `create_skin()` for color management
- **Modern Decorators**: `@listens`, `@task` for event handling

### Example

```python
from ableton.v3.control_surface import ControlSurface, ControlSurfaceSpecification
from ableton.v3.control_surface import create_skin

class Skin:
    class Session:
        ClipEmpty = (0, 0, 0)
        ClipStopped = (255, 127, 0)
        ClipPlaying = (0, 255, 0)

class Elements:
    # Element definitions
    pass

def create_mappings(control_surface):
    mappings = {}
    # Define control-to-component mappings
    return mappings

class Specification(ControlSurfaceSpecification):
    elements_type = Elements
    control_surface_skin = create_skin(skin=Skin)
    num_tracks = 8
    num_scenes = 8
    create_mappings_function = create_mappings
    component_map = {
        'Session': SessionComponent,
        'Mixer': MixerComponent,
    }

class MyController(ControlSurface):
    def __init__(self, *a, **k):
        super().__init__(Specification, *a, **k)

def create_instance(c_instance):
    return MyController(c_instance=c_instance)
```

### Controllers Using ableton.v3

\_UserScript, APC_Key_25_mk2, APC_mini_mk2, APC64, ATOM, ATOMSQ, FANTOM, KeyLab_Essential_mk3, Keystage, Komplete_Kontrol_S_Mk3, MiniLab_3

## Vendor-Specific Base Modules

Shared components for hardware families:

| Directory | Purpose | Used By |
|-----------|---------|---------|
| `_APC/` | APC-specific components | APC20, APC40, APC40_MkII |
| `_Arturia/` | Arturia integrations | KeyLab series |
| `_Axiom/` | Axiom components | Axiom series |
| `_Komplete_Kontrol/` | NI Komplete | Komplete Kontrol series |
| `_Generic/` | Generic framework | BCR2000, generic scripts |
| `novation/` | Novation base | Launchpad, Launchkey, SL |
| `pushbase/` | Push shared code | Push, Push2 |

## Version Detection

Quick patterns to identify which framework a controller uses:

```python
# Check for v3 (most specific)
if 'ControlSurfaceSpecification' in source:
    return 'ableton.v3'

# Check for v2
if 'from ableton.v2' in source:
    return 'ableton.v2'

# Check for legacy
if 'from _Framework' in source:
    return '_Framework'
```

## Migration Path

When creating new control surfaces:

1. **For simple controllers**: Use `_Framework` - well documented, widely used
2. **For modern controllers**: Consider `ableton.v3` - cleaner architecture
3. **For Novation/Push-style**: Check existing vendor modules in `novation/` or `pushbase/`

The `_Framework` remains fully supported and is the most documented option. The v3 framework is recommended for new complex controllers that benefit from declarative configuration.

## Reference Implementations

| Framework | Recommended Reference | Notes |
|-----------|----------------------|-------|
| `_Framework` | APC40, APC40_MkII | Comprehensive examples |
| `ableton.v2` | Push2, Launchkey_MK3 | Modern features |
| `ableton.v3` | APC64, APC_mini_mk2 | Latest patterns |

## See Also

- [Framework Evolution](framework-evolution.md) - Detailed code comparison across generations
- [Control Surface Architecture](control-surface.md) - Detailed `_Framework` documentation
- [EN16 Configuration](en16-config.md) - Project-specific implementation

## Reference Repositories

Decompiled MIDI Remote Scripts by [Julien Bayle (gluon)](https://github.com/gluon):

| Repository | Live Version | Python | Available in |
|------------|--------------|--------|--------------|
| [AbletonLive9_RemoteScripts](https://github.com/gluon/AbletonLive9_RemoteScripts) | 9.x | 2.x | `__ext__/AbletonLive9_MIDIRemoteScripts/` |
| [AbletonLive10.1_MIDIRemoteScripts](https://github.com/gluon/AbletonLive10.1_MIDIRemoteScripts) | 10.1.19 | 2.x | `__ext__/AbletonLive10_MIDIRemoteScripts/` |
| [AbletonLive11_MIDIRemoteScripts](https://github.com/gluon/AbletonLive11_MIDIRemoteScripts) | 11.x | 3.x | `__ext__/AbletonLive11_MIDIRemoteScripts/` |
| [AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) | 12.x | 3.x | `__ext__/AbletonLive12_MIDIRemoteScripts/` |

## Sources

- [Ableton Live - Wikipedia](https://en.wikipedia.org/wiki/Ableton_Live) - Release history
- [Live 11 Release Notes](https://www.ableton.com/en/release-notes/live-11/) - Python 3, controller support
- [Live 12 Release Notes](https://www.ableton.com/en/release-notes/live-12/) - Current version
- [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts) - Python 3 requirement
- [How to make a control surface for Ableton](https://gabrielyshay.medium.com/how-to-make-a-control-surface-for-ableton-56360a0e7a2f) - v3 framework guide

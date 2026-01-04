# Control Surface

Ableton Live MIDI Remote Script for Intech EN16 Grid controller using `_Framework`.

## Framework

This project uses the **legacy `_Framework`** (not `ableton.v2` or `ableton.v3`).

- [Framework Versions Reference](../docs/ableton-framework-versions.md)
- [Control Surface Architecture](../docs/control-surface.md)
- Reference implementations: `__ext__/AbletonLive12_MIDIRemoteScripts/APC40_MkII/`

## Architecture

```
Grid (ControlSurface)
├── DeviceComponent      # Encoders 0-7 → selected device parameters
├── MixerComponent       # Track/return selection and arm
│   ├── ChannelStrip[8]  # Buttons 0-7 select, long-press arms
│   └── ReturnStrip[4]   # Buttons 8-11 select returns
└── SessionComponent     # Buttons 12-15 → clip launch (single track)
```

## MIDI Layout

| Control | Type | Channel | IDs | Purpose |
|---------|------|---------|-----|---------|
| Encoders | CC | 0 | 32-47 | Device params (0-7), track params (12-15) |
| Buttons | Note | 0 | 32-47 | Track select (0-7), return select (8-11), clips (12-15) |
| Long buttons | Note | 0 | 48-63 | Track arm (0-7) |
| Control | Note | 0 | 64 | Refresh surface state |

## Key Patterns

### Control creation
```python
encoder = EncoderElement(MIDI_CC_TYPE, CHANNEL, cc, map_mode=Live.MidiMap.MapMode.absolute, name=name)
button = ButtonElement(True, MIDI_NOTE_TYPE, CHANNEL, note, name=name)
```

### Component guard
All setup must happen inside `component_guard()`:
```python
with self.component_guard():
    self._setup_components()
```

### Parameter mapping
```python
encoder.connect_to(parameter)  # Direct parameter control
encoder.release_parameter()    # Disconnect
```

## Development

```bash
ruff check control_surface/   # Lint
ruff format control_surface/  # Format
```

Ableton uses Python 3.11. Type stubs in `typings/Live/`.

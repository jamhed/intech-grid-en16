# Intech EN16 Ableton Control Surface

Control Ableton Live with the Intech EN16 grid controller.

## Features

| Control | Function |
|---------|----------|
| Buttons 1-8 | Select track (long press to arm) |
| Buttons 9-12 | Select return track |
| Buttons 13-16 | Launch/stop clips 1-4 on selected track |
| Encoders 1-8 | Device parameters |
| Encoders 9-12 | (available for custom mapping) |
| Encoder 13 | Send C (selected track) |
| Encoder 14 | Send B (selected track) |
| Encoder 15 | Send A (selected track) |
| Encoder 16 | Volume (selected track) |
| Control Button | Refresh surface |

## Installation

1. Copy this folder to Ableton's Remote Scripts location:
   ```
   ~/Music/Ableton/User Library/Remote Scripts/Intech
   ```

2. In Ableton Live, go to **Preferences → Link, Tempo & MIDI**

3. Set Control Surface to **Intech**, Input/Output to your EN16 MIDI ports

4. Restart Ableton Live

## Project Structure

```
Intech/
├── __init__.py              # Entry point
├── Grid.py                  # Control surface implementation
├── grid/
│   └── EN16-Control.json    # Grid controller configuration
├── tools/
│   ├── grid-cli.ts          # Upload/download Grid configs
│   └── README.md            # CLI documentation
├── docs/
│   └── GRID_LUA.md          # Grid Lua API reference
└── __ext__/
    └── AbletonLive12_MIDIRemoteScripts/  # Type hints (git submodule)
```

## Development

### Prerequisites

- Ableton Live 11+ (uses `_Framework`)
- Python 3.x (bundled with Live)

### Enable Script Reloading

Add to `Options.txt` (requires Ableton Beta):
```
-_ToolsMenuRemoteScripts
```

Location:
- macOS: `/Users/[username]/Library/Preferences/Ableton/Live x.x.x/Options.txt`
- Windows: `%APPDATA%\Ableton\Live x.x.x\Preferences\Options.txt`

### View Logs

```bash
# macOS
tail -f ~/Library/Preferences/Ableton/Live\ */Log.txt | grep -i intech

# Windows
Get-Content "$env:APPDATA\Ableton\Live *\Preferences\Log.txt" -Wait | Select-String "intech"
```

### Clear Cache Before Reload

After editing Python files, clear the bytecode cache:
```bash
rm -rf __pycache__
```

Then reload via Preferences (toggle Control Surface) or Tools → Reload MIDI Remote Scripts.

### Type Checking

This project includes `AbletonLive12_MIDIRemoteScripts` as a git submodule for type hints:

```bash
git submodule update --init
```

### References

- [AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) - Decompiled scripts
- [ableton-control-surface-toolkit](https://github.com/oslo1989/ableton-control-surface-toolkit) - Live object documentation

---

# Grid CLI Tool

A command-line tool for uploading/downloading Grid controller configurations without Grid Editor.

## Quick Start

```bash
cd tools
npm install

# Upload config to device
npx tsx grid-cli.ts upload ../grid/EN16-Control.json

# Download config from device
npx tsx grid-cli.ts download ./backup.json -t EN16
```

See [tools/README.md](tools/README.md) for full documentation.

---

# EN16 Configuration

The controller requires a custom profile configured via [Grid Editor](https://docs.intech.studio/guides/introduction) or the [Grid CLI tool](#grid-cli-tool).

## MIDI Layout

| Control | Type | Channel | Identifiers |
|---------|------|---------|-------------|
| Encoders | CC | 0 | 32-47 |
| Buttons | Note | 0 | 32-47 |
| Long Buttons | Note | 0 | 48-63 |
| Control Button | Note | 0 | 64 |

## System Element (Element 16)

Handles MIDI feedback from Ableton and periodic sync requests.

### Setup Event

```lua
MIDI_NOTE, MIDI_CC, CH = 144, 176, page_current()
function self.midirx_cb(self, event, header)
    if header[1] ~= 13 then
        return
    end
    local cmd, el, val = event[2], event[3] - 32, event[4]
    local on = val == 127
    if cmd == MIDI_NOTE and el >= 16 then
        element[el - 16]:led_color(1, {on and {255, 0, 0, 1} or {0, 0, 255, 1}})
    elseif cmd == MIDI_NOTE then
        element[el]:led_value(1, on and 100 or 0)
    elseif cmd == MIDI_CC and el < 16 then
        element[el]:encoder_value(val)
    end
end
self:timer_start(1000)
```

### Timer Event

```lua
midi_send(CH, MIDI_NOTE, 64, 127)
```

## Track/Device Encoders (0-7)

### Setup
```lua
self:led_color(1, {{0, 0, 255, 1}})
```

### Button
```lua
local note, val = 32 + self:element_index(), self:button_value()
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
    end
end
midi_send(CH, MIDI_NOTE, note, val)
```

### Encoder
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Return Track Encoders (8-11)

### Setup
```lua
self:led_color(1, {{87, 255, 165, 1}})
```

### Button
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

### Encoder
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Clip/Volume Encoders (12-15)

### Setup
```lua
self:led_color(1, {{255, 255, 0, 1}})
```

### Button
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

### Encoder
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Lua Snippets

### Long Press Detection

```lua
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        print("long press")
    else
        print("short press")
    end
end
```

See [Grid Lua API Reference](docs/GRID_LUA.md) for full documentation.

---

## Known Issues

**Initial sync delay**: On startup, Ableton sends parameter values before EN16's MIDI callback is ready. The timer event sends a sync request (note 64) to trigger a refresh after 1 second.

## License

MIT

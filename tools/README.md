# Grid CLI

Command-line tool for uploading and downloading Grid controller configurations.

Supports both JSON and Lua config formats.

## Installation

```bash
cd tools
npm install
```

## Usage

### Upload Configuration

Upload a config file to a connected Grid device:

```bash
# Upload Lua config (recommended)
npx tsx grid-cli.ts upload ../grid/EN16-Control.lua

# Upload JSON config
npx tsx grid-cli.ts upload ../grid/EN16-Control.json
```

Options:
| Flag | Description |
|------|-------------|
| `-p, --port <path>` | Serial port path (auto-detects if not specified) |
| `--page <n>` | Upload to specific page only (0-3, default: all) |
| `-v, --verbose` | Show detailed progress |
| `-d, --dry-run` | Validate config without uploading |

### Download Configuration

Download the current configuration from a Grid device:

```bash
# Download as Lua (readable)
npx tsx grid-cli.ts download ./backup.lua

# Download as JSON
npx tsx grid-cli.ts download ./backup.json
```

Options:
| Flag | Description |
|------|-------------|
| `-p, --port <path>` | Serial port path (auto-detects if not specified) |
| `-t, --type <type>` | Device type (default: EN16) |
| `--page <n>` | Download from specific page (0-3, default: 0) |
| `-f, --format <fmt>` | Output format: json or lua (auto-detect from extension) |
| `-v, --verbose` | Show detailed progress |

Supported device types: `EN16`, `PO16`, `BU16`, `EF44`, `PBF4`, `TEK2`, `PB44`

### Convert Between Formats

Convert config files between JSON and Lua formats:

```bash
# JSON to Lua
npx tsx grid-cli.ts convert config.json config.lua

# Lua to JSON
npx tsx grid-cli.ts convert config.lua config.json
```

## Lua Config Format

Event handlers are real Lua functions. Template parameters are automatically inlined.

```lua
local grid = require("grid")

-- Colors
local BLUE = {0, 0, 255, 1}
local GREEN = {87, 255, 165, 1}

-- Template with parameters (color, long_press are inlined at compile time)
local function encoder(color, long_press)
  return {
    init = function(self)
      self:glc(1, {color})
    end,

    encoder = function(self)
      local cc, val = 32 + self:ind(), self:eva()
      gms(CH, MIDI_CC, cc, val)
    end,

    button = function(self)
      local note, val = 32 + self:ind(), self:bva()
      if long_press and self:bst() == 0 and self:bel() > 1000 then
        note = note + 16
        val = 127
      end
      gms(CH, MIDI_NOTE, note, val)
    end,
  }
end

return grid.config {
  name = "EN16 Control",
  type = "EN16",
  version = {1, 0, 0},

  [0] = encoder(BLUE, true),
  [1] = encoder(BLUE, true),
  [8] = encoder(GREEN, false),

  [255] = {
    init = function(self)
      MIDI_NOTE, MIDI_CC, CH = 144, 176, gpc()
      self:gtt(1000)
    end,

    timer = function(self)
      gms(CH, MIDI_NOTE, 64, 127)
    end,
  },
}
```

### How It Works

1. Template function `encoder(color, long_press)` returns element config
2. Inner functions close over `color` and `long_press` variables
3. Runtime extracts function bodies and inlines upvalues:
   - `{color}` → `{0, 0, 255, 1}`
   - `long_press` → `true`
4. Result is minified and uploaded

### Grid Library

| Function | Description |
|----------|-------------|
| `grid.config(tbl)` | Config wrapper (returns table as-is) |
| `grid.spread(from, to, fn)` | Generate elements for a range |
| `grid.merge(...)` | Merge multiple tables |

### Benefits

- **Real Lua code**: Full syntax highlighting and tooling
- **Parameterized templates**: `encoder(BLUE, true)` generates element with inlined values
- **Auto-minification**: Function bodies extracted and minified

## Event Types

| ID | Name | Description |
|----|------|-------------|
| 0 | init | Element initialization |
| 1 | potmeter | Potentiometer change (PO16, PBF4) |
| 2 | encoder | Encoder rotation |
| 3 | button | Button press/release |
| 4 | utility | System utility event |
| 5 | midirx | MIDI receive callback |
| 6 | timer | Timer tick |
| 7 | endless | Endless encoder (EF44) |
| 8 | draw | Display draw event |

### Element 255 (System)

The system element handles global functionality:
- **init**: Global setup, MIDI callback registration
- **utility**: Page change handler
- **midirx**: MIDI input routing
- **timer**: Periodic sync/heartbeat

## Script Limits

Maximum script length: **909 characters** (after minification)

The CLI validates script length before upload:
```
Validation failed: Script too long for element 0, event 0: 934/909 characters.
Reduce by 25 characters.
```

## Technical Details

- Baud rate: 2,000,000
- Protocol: Grid binary protocol via USB serial
- Lua runtime: wasmoon (Lua 5.4 via WASM)
- Minification: luamin

### Supported USB Devices

| VID | PID | Architecture |
|-----|-----|--------------|
| 0x03eb | 0xecac | D51 |
| 0x03eb | 0xecad | D51 (alt) |
| 0x303a | 0x8123 | ESP32 |

## Troubleshooting

### "No Grid device found"

1. Ensure the device is connected via USB
2. Close Grid Editor (it holds the serial port exclusively)
3. Specify port manually: `--port /dev/tty.usbmodem1234561`

### "Timeout waiting for ACK"

1. Check USB connection
2. Verify device type matches: `-t EN16`
3. Try again (transient communication errors)

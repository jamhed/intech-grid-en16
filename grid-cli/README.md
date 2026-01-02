# Grid CLI

Command-line tool for uploading and downloading Grid controller configurations.

## Installation

```bash
cd grid-cli
npm install
```

## Usage

### Upload Configuration

Upload a JSON config file to a connected Grid device:

```bash
npx tsx grid-cli.ts upload ../configs/EN16-Control.json
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
npx tsx grid-cli.ts download ./backup.json
```

Options:
| Flag | Description |
|------|-------------|
| `-p, --port <path>` | Serial port path (auto-detects if not specified) |
| `-t, --type <type>` | Device type (default: EN16) |
| `--page <n>` | Download from specific page (0-3, default: 0) |
| `-v, --verbose` | Show detailed progress |

Supported device types: `EN16`, `PO16`, `BU16`, `EF44`, `PBF4`, `TEK2`, `PB44`

## Config File Formats

The CLI supports two configuration formats: JSON and Lua.

### JSON Format

Standard format exported by Grid Editor:

```json
{
  "name": "My Config",
  "type": "EN16",
  "version": { "major": "1", "minor": "0", "patch": "0" },
  "configs": [
    {
      "controlElementNumber": 0,
      "events": [
        { "event": 0, "config": "self:led_color(1,{{0,0,255,1}})" },
        { "event": 2, "config": "local cc,val=32+self:ind(),self:eva() midi_send(0,176,cc,val)" },
        { "event": 3, "config": "local note,val=32+self:ind(),self:bva() midi_send(0,144,note,val)" }
      ]
    },
    {
      "controlElementNumber": 255,
      "events": [
        { "event": 0, "config": "-- system element init" },
        { "event": 4, "config": "-- utility event" },
        { "event": 6, "config": "midi_send(0,144,64,127)" }
      ]
    }
  ]
}
```

### Lua Format

Human-readable format using the grid library. Easier to edit than JSON:

```lua
local grid = require("grid")

local BLUE = {0, 0, 255, 1}

return grid.config {
  name = "EN16 Control",
  type = "EN16",
  version = {1, 0, 0},

  [0] = {
    init = function(self)
      self:glc(1, {BLUE})
    end,
    encoder = function(self)
      local cc, val = 32 + self:ind(), self:eva()
      gms(CH, MIDI_CC, cc, val)
    end,
    button = function(self)
      local note, val = 32 + self:ind(), self:bva()
      gms(CH, MIDI_NOTE, note, val)
    end,
  },

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

The CLI automatically detects the format by file extension (`.json` or `.lua`).

For a complete example, see [EN16-Control.lua](../configs/EN16-Control.lua) and [EN16 Configuration Guide](../docs/EN16_CONFIG.md).

### Event Types

| ID  | Name     | Description                       |
| --- | -------- | --------------------------------- |
| 0   | init     | Element initialization            |
| 1   | potmeter | Potentiometer change (PO16, PBF4) |
| 2   | encoder  | Encoder rotation                  |
| 3   | button   | Button press/release              |
| 4   | utility  | System utility event              |
| 5   | midirx   | MIDI receive callback             |
| 6   | timer    | Timer tick                        |
| 7   | endless  | Endless encoder (EF44)            |
| 8   | draw     | Display draw event                |

### Element 255 (System)

The system element handles global functionality:

- **Event 0 (init)**: Global setup, MIDI callback registration
- **Event 4 (utility)**: Page change handler
- **Event 5 (midirx)**: MIDI input routing
- **Event 6 (timer)**: Periodic sync/heartbeat

## Script Limits

Maximum script length: **909 characters** (including `<?lua ?>` wrapper)

The CLI validates script length before upload and fails with an error if exceeded:

```
Validation failed: Script too long for element 0, event 0: 934/909 characters.
Reduce by 25 characters.
```

## Technical Details

- Baud rate: 2,000,000
- Protocol: Grid binary protocol via USB serial
- Uses [@intechstudio/grid-protocol](https://www.npmjs.com/package/@intechstudio/grid-protocol) for packet encoding/decoding

### Supported USB Devices

| VID    | PID    | Architecture |
| ------ | ------ | ------------ |
| 0x03eb | 0xecac | D51          |
| 0x03eb | 0xecad | D51 (alt)    |
| 0x303a | 0x8123 | ESP32        |

## Troubleshooting

### "No Grid device found"

1. Ensure the device is connected via USB
2. Close Grid Editor (it holds the serial port exclusively)
3. Specify port manually: `--port /dev/tty.usbmodem1234561`

### "Timeout waiting for ACK"

1. Check USB connection
2. Verify device type matches: `-t EN16`
3. Try again (transient communication errors)

### Script validation fails

Minify your Lua scripts:

- Use short function names: `self:eva()` instead of `self:encoder_value()`
- Remove comments and whitespace
- Combine statements: `local a,b=1,2`

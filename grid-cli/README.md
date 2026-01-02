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

| Flag                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `-p, --port <path>` | Serial port path (auto-detects if not specified) |
| `--page <n>`        | Upload to specific page only (0-3, default: all) |
| `-v, --verbose`     | Show detailed progress                           |
| `-d, --dry-run`     | Validate config without uploading                |

### Download Configuration

Download the current configuration from a Grid device:

```bash
npx tsx grid-cli.ts download ./backup.json
```

Options:

| Flag                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `-p, --port <path>` | Serial port path (auto-detects if not specified) |
| `-t, --type <type>` | Device type (default: EN16)                      |
| `--page <n>`        | Download from specific page (0-3, default: 0)    |
| `-v, --verbose`     | Show detailed progress                           |

Supported device types: `EN16`, `PO16`, `BU16`, `EF44`, `PBF4`, `TEK2`, `PB44`

### Convert Lua to JSON

Convert a Lua config file to JSON format (minified by default):

```bash
npx tsx grid-cli.ts convert ../configs/EN16-Control.lua
npx tsx grid-cli.ts convert ../configs/EN16-Control.lua -o output.json
npx tsx grid-cli.ts convert ../configs/EN16-Control.lua -r        # with identifier renaming
npx tsx grid-cli.ts convert ../configs/EN16-Control.lua --no-minify
```

Options:

| Flag                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `-o, --output <path>` | Output file path (prints to stdout if not specified)   |
| `-r, --rename`        | Rename user variables/functions to short names         |
| `--no-minify`         | Skip minification (keep human-readable function names) |

#### Minification

Minification uses `@intechstudio/grid-protocol` to:

- Convert long function names to short aliases (`encoder_value` → `eva`)
- Remove unnecessary whitespace

#### Identifier Renaming (`-r`)

The `-r` flag enables additional minification by renaming user-defined variables and functions to short names (`a`, `b`, `c`, etc.):

```lua
-- Before
MIDI_NOTE, MIDI_CC, CH = 144, 176, page_current()
local note, val = 32 + self:element_index(), self:button_value()

-- After (-r)
a, b, c = 144, 176, page_current()
local d, e = 32 + self:element_index(), self:button_value()
```

**What gets renamed:**

- User-defined global variables (`MIDI_NOTE`, `CH`, etc.)
- User-defined helper functions
- Local variables and function parameters (`event`, `header`, `cmd`, etc.)

**What is preserved:**

- Single-letter identifiers (already minimal)
- `self` (Grid implicit parameter)
- Callback function names (`midirx_cb`, `sysex_cb`) - firmware expects these
- Grid builtins (`midi_send`, `led_color`, `element`, `page_current`, etc.)
- Lua keywords

**Collision avoidance:** Existing short names are preserved. If your code has `local a = 1`, another variable won't be renamed to `a`.

**Size savings:** ~8% additional reduction (e.g., 725 bytes on EN16-Control.lua)

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

-- Local variables (inlined as upvalues)
local BLUE = {0, 0, 255, 1}

-- System init: globals and callbacks
MIDI_NOTE, MIDI_CC = 144, 176
CH = page_current()

function midirx_cb(self, event, header)
  -- handle MIDI feedback
end

return grid.config {
  name = "EN16 Control",
  type = "EN16",
  version = {1, 0, 0},

  -- System event handlers
  utility = function(self)
    page_load(page_next())
  end,

  timer = function(self)
    midi_send(CH, MIDI_NOTE, 64, 127)
  end,

  -- Element handlers
  [0] = {
    init = function(self)
      self:led_color(1, {BLUE})
    end,
    encoder = function(self)
      local cc, val = 32 + self:element_index(), self:encoder_value()
      midi_send(CH, MIDI_CC, cc, val)
    end,
    button = function(self)
      local note, val = 32 + self:element_index(), self:button_value()
      midi_send(CH, MIDI_NOTE, note, val)
    end,
  },
}
```

#### Script Structure

| Section                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `local` variables       | Inlined into function bodies as upvalues  |
| Global assignments      | Become system init (element 255, event 0) |
| `midirx_cb`, `sysex_cb` | Callbacks included in system init         |
| `utility`, `timer`      | Top-level system event handlers           |
| `[0]`, `[1]`, ...       | Element-specific handlers                 |

The CLI automatically detects the format by file extension (`.json` or `.lua`).

For a complete example, see [EN16-Control.lua](../configs/EN16-Control.lua) and [EN16 Configuration Guide](../docs/en16-config.md).

For detailed Lua config authoring, see the [Lua Config Guide](../docs/lua-config-guide.md).

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

- **Root globals**: `MIDI_NOTE=144` etc. (become init event)
- **Root callbacks**: `midirx_cb`, `sysex_cb` (included in init)
- **utility**: Page change handler (top-level in config)
- **timer**: Periodic sync/heartbeat (top-level in config)

## Script Limits

Maximum script length: **909 characters** (including `<?lua ?>` wrapper)

The CLI validates script length before upload and fails with an error if exceeded:

```text
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

- Use `-r` flag: `npx tsx grid-cli.ts convert config.lua -r` (renames variables/functions)
- Use short function names: `self:eva()` instead of `self:encoder_value()`
- Remove comments and whitespace
- Combine statements: `local a,b=1,2`

# Authoring Grid Configs in Lua

This guide describes the Lua-based configuration format for Grid controllers, an alternative to the JSON format used by [Grid Editor](https://docs.intech.studio/guides/introduction).

## Why Lua?

Grid controllers run Lua scripts internally. The traditional workflow involves:

1. Editing scripts in Grid Editor's visual interface
2. Exporting to JSON
3. Uploading to the device

The Lua config format lets you write configs directly in Lua:

- **Human-readable**: Real Lua syntax with comments and formatting
- **Reusable**: Define functions and constants once, use everywhere
- **Version control friendly**: Clean diffs, easy merging
- **IDE support**: Syntax highlighting, linting, autocomplete

## Quick Start

```lua
local grid = require("grid")

return grid.config {
  name = "My Controller",
  type = "EN16",
  version = {1, 0, 0},

  [0] = {
    init = function(self)
      self:led_color(1, {{0, 0, 255, 1}})
    end,
    encoder = function(self)
      local cc = 32 + self:element_index()
      midi_send(0, 176, cc, self:encoder_value())
    end,
    button = function(self)
      local note = 32 + self:element_index()
      midi_send(0, 144, note, self:button_value())
    end,
  },
}
```

Upload with:

```bash
npx tsx grid-cli.ts upload config.lua
```

## File Structure

A Lua config file has four main sections:

```lua
-- 1. Import the grid library
local grid = require("grid")

-- 2. Local constants (inlined into functions as upvalues)
local BLUE = {0, 0, 255, 1}
local MIDI_CC = 176

-- 3. Root globals and callbacks (become system init)
CH = page_current()
function midirx_cb(self, event, header)
  -- handle MIDI feedback
end

-- 4. Config definition
return grid.config {
  name = "...",
  type = "...",
  version = {1, 0, 0},

  -- System event handlers
  utility = function(self) end,
  timer = function(self) end,

  -- Element handlers (0-15 for EN16)
  [0] = { init = ..., encoder = ..., button = ... },
  [1] = { init = ..., encoder = ..., button = ... },
}
```

## Local Variables vs Globals

Understanding the difference is important:

### Local Variables (Upvalues)

Declared with `local` at file scope. They are **inlined** into each function body:

```lua
local BLUE = {0, 0, 255, 1}
local CHANNEL = 0

return grid.config {
  [0] = {
    init = function(self)
      self:led_color(1, {BLUE})  -- BLUE is replaced with {0,0,255,1}
    end,
    encoder = function(self)
      midi_send(CHANNEL, 176, 32, self:encoder_value())  -- CHANNEL becomes 0
    end,
  },
}
```

Compiled output for `init`:

```lua
self:led_color(1, {{0,0,255,1}})
```

Local variables are ideal for:

- Color constants
- Fixed values (channel, base note, CC offset)
- Lookup tables with primitive values

### Global Variables (Root Globals)

Declared without `local`. They become **shared state** stored in the system init event:

```lua
-- These become system init (element 255, event 0)
MIDI_NOTE, MIDI_CC = 144, 176
CH = page_current()
counter = 0
```

Use globals for:

- Values computed at runtime (`page_current()`)
- State shared between elements
- Callbacks (`midirx_cb`, `sysex_cb`)

## System Element (255)

Element 255 is special—it handles system-wide functionality. Configure it via:

### Root Globals → System Init (Event 0)

```lua
-- Becomes: MIDI_NOTE,MIDI_CC=144,176 CH=gpc() midirx_cb=function(...) end
MIDI_NOTE, MIDI_CC = 144, 176
CH = page_current()

function midirx_cb(self, event, header)
  if header[1] ~= 13 then return end
  local cmd, el, val = event[2], event[3] - 32, event[4]
  if cmd == MIDI_CC then
    element[el]:encoder_value(val)
  end
end
```

### Top-Level Utility Handler (Event 4)

```lua
return grid.config {
  utility = function(self)
    page_load(page_next())
  end,
  -- ...
}
```

### Top-Level Timer Handler (Event 6)

```lua
return grid.config {
  timer = function(self)
    midi_send(CH, MIDI_NOTE, 64, 127)
  end,
  -- ...
}
```

## Element Handlers

Each physical element (encoder, button, potentiometer) has a numeric index. Define handlers for each event type:

| Event | Handler Name | Description |
|-------|-------------|-------------|
| 0 | `init` | Runs once on page load |
| 1 | `potmeter` | Potentiometer value change |
| 2 | `encoder` | Encoder rotation |
| 3 | `button` | Button press/release |
| 6 | `timer` | Timer tick (per-element) |
| 7 | `endless` | Endless encoder rotation |
| 8 | `draw` | LCD display refresh |

Example:

```lua
[0] = {
  init = function(self)
    self:led_color(1, {{0, 0, 255, 1}})
    self:timer_start(500)
  end,
  encoder = function(self)
    midi_send(0, 176, 32, self:encoder_value())
  end,
  button = function(self)
    midi_send(0, 144, 32, self:button_value())
  end,
  timer = function(self)
    -- periodic task
  end,
},
```

## Reusable Templates

Define factory functions to avoid repetition:

```lua
local grid = require("grid")

local BLUE = {0, 0, 255, 1}
local GREEN = {87, 255, 165, 1}

-- Template factory
local function encoder(color, cc_base)
  return {
    init = function(self)
      self:led_color(1, {color})
    end,
    encoder = function(self)
      local cc = cc_base + self:element_index()
      midi_send(0, 176, cc, self:encoder_value())
    end,
    button = function(self)
      local note = cc_base + self:element_index()
      midi_send(0, 144, note, self:button_value())
    end,
  }
end

return grid.config {
  name = "Template Example",
  type = "EN16",
  version = {1, 0, 0},

  -- Same template with different parameters
  [0] = encoder(BLUE, 32),
  [1] = encoder(BLUE, 32),
  [2] = encoder(GREEN, 48),
  [3] = encoder(GREEN, 48),
}
```

## Long Press Detection

Detect long presses in the button handler:

```lua
button = function(self)
  local note = 32 + self:element_index()
  local val = self:button_value()

  -- Check on release (state == 0)
  if self:button_state() == 0 and self:button_elapsed_time() > 1000 then
    note = note + 16  -- Different note for long press
    val = 127
  end

  midi_send(0, 144, note, val)
end,
```

## MIDI Feedback

Handle incoming MIDI in the `midirx_cb` callback:

```lua
MIDI_NOTE, MIDI_CC = 144, 176

function midirx_cb(self, event, header)
  -- header[1] = port (13 = USB)
  if header[1] ~= 13 then return end

  local cmd, data1, data2 = event[2], event[3], event[4]

  if cmd == MIDI_CC then
    -- Update encoder ring position
    element[data1 - 32]:encoder_value(data2)
  elseif cmd == MIDI_NOTE then
    -- Update LED brightness
    element[data1 - 32]:led_value(1, data2 > 0 and 100 or 0)
  end
end
```

## CLI Commands

### Convert Lua to JSON

Preview the compiled output:

```bash
npx tsx grid-cli.ts convert config.lua
```

Save to file:

```bash
npx tsx grid-cli.ts convert config.lua -o config.json
```

Disable minification (keep human-readable function names):

```bash
npx tsx grid-cli.ts convert config.lua --no-minify
```

### Upload Directly

Upload Lua config to device (auto-converts):

```bash
npx tsx grid-cli.ts upload config.lua
```

### Validate Without Upload

Dry-run to check for errors:

```bash
npx tsx grid-cli.ts upload config.lua --dry-run
```

## Script Limits

Each event handler compiles to a single script with a **909 character limit** (including `<?lua ?>` wrapper).

If you exceed the limit:

1. **Use short function names**: `self:eva()` instead of `self:encoder_value()`
2. **Simplify logic**: Move complex logic to shared globals
3. **Split into multiple events**: Use timer events for periodic updates

The CLI validates script length before upload:

```text
Validation failed: Script too long for element 0, event 0: 934/909 characters.
Reduce by 25 characters.
```

## Comparison: JSON vs Lua

### JSON Format (Grid Editor)

```json
{
  "name": "My Config",
  "type": "EN16",
  "version": { "major": "1", "minor": "0", "patch": "0" },
  "configs": [
    {
      "controlElementNumber": 0,
      "events": [
        { "event": 0, "config": "self:glc(1,{{0,0,255,1}})" },
        { "event": 2, "config": "gms(0,176,32+self:ind(),self:eva())" }
      ]
    }
  ]
}
```

### Lua Format

```lua
local grid = require("grid")
local BLUE = {0, 0, 255, 1}

return grid.config {
  name = "My Config",
  type = "EN16",
  version = {1, 0, 0},

  [0] = {
    init = function(self)
      self:led_color(1, {BLUE})
    end,
    encoder = function(self)
      midi_send(0, 176, 32 + self:element_index(), self:encoder_value())
    end,
  },
}
```

## Best Practices

1. **Use locals for constants**: Colors, channel numbers, base offsets
2. **Use globals for runtime state**: Computed values, shared counters
3. **Create templates for repetitive elements**: DRY principle
4. **Keep handlers focused**: One responsibility per handler
5. **Comment complex logic**: Especially MIDI callback routing
6. **Test with dry-run first**: Catch errors before uploading
7. **Use minification in production**: Saves space, fits more logic

## Complete Example

See [EN16-Control.lua](../configs/EN16-Control.lua) for a full working configuration with:

- Color-coded element groups
- Long-press detection for track arming
- MIDI feedback handling
- Timer-based sync requests

## Related Documentation

**Local:**

- [Grid Lua API Reference](grid-lua.md) - Function reference for all handlers
- [EN16 Config Guide](en16-config.md) - Specific EN16 configuration example
- [Grid CLI](../grid-cli/README.md) - Command-line tool documentation

**Intech Studio Official:**

- [Grid Editor Guides](https://docs.intech.studio/guides/introduction)
- [Grid Functions Reference](https://docs.intech.studio/reference-manual/grid-functions/grid-functions)
- [Button Functions](https://docs.intech.studio/reference-manual/control-element-functions/button-control-element)
- [Encoder Functions](https://docs.intech.studio/reference-manual/control-element-functions/encoder-control-element)
- [LED Functions](https://docs.intech.studio/reference-manual/grid-functions/led)
- [MIDI Functions](https://docs.intech.studio/reference-manual/grid-functions/midi)
- [Timer Functions](https://docs.intech.studio/reference-manual/grid-functions/timer)
- [Page Functions](https://docs.intech.studio/reference-manual/grid-functions/page)

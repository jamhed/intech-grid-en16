# Global Functions

These functions are available globally in any Lua handler.

## LED Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `glr` | `led_default_red` | Get default red LED value |
| `glg` | `led_default_green` | Get default green LED value |
| `glb` | `led_default_blue` | Get default blue LED value |
| `glp` | `led_value` | Set LED phase/value |
| `glt` | `led_timeout` | Set LED timeout |
| `gln` | `led_color_min` | Set LED minimum color |
| `gld` | `led_color_mid` | Set LED middle color |
| `glx` | `led_color_max` | Set LED maximum color |
| `glc` | `led_color` | Set LED color |
| `glf` | `led_animation_rate` | Set LED animation frequency |
| `gls` | `led_animation_type` | Set LED animation shape |
| `glpfs` | `led_animation_phase_rate_type` | Set LED phase, frequency, and shape |
| `glag` | `led_address_get` | Get hardware LED index for element |

### LED Color Usage

```lua
-- Set LED color: glc(layer, {{r, g, b, intensity}, ...})
self:glc(1, {{255, 0, 0, 1}})  -- Red at full intensity
self:glc(1, {{0, 255, 0, 0.5}})  -- Green at 50% intensity

-- Get default colors
local r, g, b = glr(), glg(), glb()
```

## MIDI Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gms` | `midi_send` | Send standard MIDI message |
| `gmss` | `midi_sysex_send` | Send MIDI SysEx message |

### MIDI Send Usage

```lua
-- midi_send(channel, command, param1, param2)
gms(0, 176, 1, 127)  -- CC1 = 127 on channel 1
gms(0, 144, 60, 100)  -- Note On C4, velocity 100

-- Use -1 for auto values based on element state
self:gms(-1, -1, -1, -1)
```

## HID Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gks` | `keyboard_send` | Send keyboard HID message |
| `gmms` | `mouse_move_send` | Send mouse movement |
| `gmbs` | `mouse_button_send` | Send mouse button |
| `ggms` | `gamepad_move_send` | Send gamepad axis movement |
| `ggbs` | `gamepad_button_send` | Send gamepad button |

## Page Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gpn` | `page_next` | Get next page number |
| `gpp` | `page_previous` | Get previous page number |
| `gpc` | `page_current` | Get current page number |
| `gpl` | `page_load` | Load a specific page |

### Page Usage

```lua
-- Cycle to next page
gpl(gpn())

-- Go to specific page
gpl(0)  -- Load page 0

-- Get current page
local current = gpc()
```

## Timer Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gtt` | `timer_start` | Start timer with interval (ms) |
| `gtp` | `timer_stop` | Stop the timer |
| `gts` | `timer_source` | Get timer source |

### Timer Usage

```lua
-- Start 100ms timer
self:gtt(100)

-- Stop timer
self:gtp()
```

## Event Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `get` | `event_trigger` | Trigger an event on an element |

## MIDI RX Control

| Short | Human Name | Description |
|-------|-----------|-------------|
| `mre` | `midirx_enabled` | Enable/disable MIDI RX (1=on, 0=off) |
| `mrs` | `midirx_sync` | Enable/disable MIDI sync messages |

## Element Name Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gen` | `element_name` | Get element name |
| `gsen` | `element_name_set` | Set element name |
| `gens` | `element_name_send` | Send element name |
| `ggen` | `element_name_get` | Get element name (alternative) |

## Communication Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gwss` | `websocket_send` | Send WebSocket message |
| `gps` | `package_send` | Send package |
| `gis` | `immediate_send` | Execute Lua on another module |

### Immediate Send Usage

```lua
-- Execute Lua code on module at position (x, y)
gis(0, 0, "ele[0]:glc(1, {{255, 0, 0, 1}})")

-- Execute on all modules (use nil for x and y)
gis(nil, nil, "print('hello')")
```

## Module Info Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gmx` | `module_position_x` | Get module X position in grid |
| `gmy` | `module_position_y` | Get module Y position in grid |
| `gmr` | `module_rotation` | Get module rotation |
| `ghwcfg` | `hardware_configuration` | Get hardware configuration |
| `gvmaj` | `version_major` | Get firmware major version |
| `gvmin` | `version_minor` | Get firmware minor version |
| `gvpat` | `version_patch` | Get firmware patch version |
| `gec` | `element_count` | Get number of elements |

## Filesystem Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gfls` | `readdir` | List directory contents |
| `gfcat` | `readfile` | Read file contents |

## Calibration Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gcr` | `calibration_reset` | Reset all calibrations to defaults |
| `gpcg` | `potmeter_calibration_get` | Get raw potentiometer values |
| `gpcs` | `potmeter_center_set` | Set potentiometer center calibration |
| `gpds` | `potmeter_detent_set` | Set potentiometer detent |
| `grcg` | `range_calibration_get` | Get min/max range calibration |
| `grcs` | `range_calibration_set` | Set min/max range calibration |

## Utility Functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `grnd` | `random8` | Generate random 8-bit value (0-255) |
| `gmaps` | `map_saturate` | Map value from one range to another with saturation |
| `glim` | `limit` | Clamp value between min and max |
| `sgn` | `sign` | Get sign of number (-1, 0, or 1) |
| `gsc` | `segment_calculate` | Calculate LED segment intensity |
| `gsg` | `string_get` | Get string value |

### Map Saturate Usage

```lua
-- gmaps(value, in_min, in_max, out_min, out_max)
local mapped = gmaps(64, 0, 127, 0, 255)  -- Returns 128

-- Map encoder value to 0-1 range
local normalized = gmaps(self:eva(), self:emi(), self:ema(), 0, 1)
```

### Limit Usage

```lua
-- glim(value, min, max)
local clamped = glim(150, 0, 127)  -- Returns 127
```

### Sign Usage

```lua
-- sgn(value)
sgn(5)   -- Returns 1
sgn(-3)  -- Returns -1
sgn(0)   -- Returns 0
```

### Segment Calculate Usage

```lua
-- gsc(segment, value, min, max)
-- Divides range into 5 segments, returns intensity (0-255) for given segment
local intensity = gsc(0, self:eva(), self:emi(), self:ema())
```

## LCD/GUI Functions

These are low-level drawing functions (use `self:` methods in draw_handler instead):

| Short | Human Name | Description |
|-------|-----------|-------------|
| `glsb` | `lcd_set_backlight` | Set LCD backlight (0-255) |
| `ggdsw` | `gui_draw_swap` | Swap display buffers |
| `ggdpx` | `gui_draw_pixel` | Draw pixel |
| `ggdl` | `gui_draw_line` | Draw line |
| `ggdr` | `gui_draw_rectangle` | Draw rectangle |
| `ggdrf` | `gui_draw_rectangle_filled` | Draw filled rectangle |
| `ggdrr` | `gui_draw_rectangle_rounded` | Draw rounded rectangle |
| `ggdrrf` | `gui_draw_rectangle_rounded_filled` | Draw filled rounded rectangle |
| `ggdpo` | `gui_draw_polygon` | Draw polygon |
| `ggdpof` | `gui_draw_polygon_filled` | Draw filled polygon |
| `ggdt` | `gui_draw_text` | Draw text |
| `ggdft` | `gui_draw_fasttext` | Draw text (fast) |
| `ggdaf` | `gui_draw_area_filled` | Fill area |
| `ggdd` | `gui_draw_demo` | Draw demo |

See [draw_handler](draw-handler.md) for LCD element-specific methods.

---
[← Back to Reference](../grid-lua.md)

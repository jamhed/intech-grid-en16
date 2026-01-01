# `button_handler` (short: `bc`)

The handler receives `self` as its implicit parameter (object-oriented style), which is the button element object.

## Available Methods via `self`

### Button-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `lix` | `led_index` | LED index |
| `bva` | `button_value` | Current button value |
| `bmi` | `button_min` | Minimum button value |
| `bma` | `button_max` | Maximum button value |
| `bmo` | `button_mode` | Button mode |
| `bel` | `button_elapsed_time` | Time since last button event |
| `bst` | `button_state` | Current button state |
| `bstp` | `button_step` | Button step function |

### General functions

| Short | Human Name | Description |
|-------|-----------|-------------|
| `glc` | `led_color` | LED color |
| `glp` | `led_phase` | LED phase |
| `gms` | `midi_send` | MIDI send |
| `gtt` | `timer_start` | Timer start |
| `gtp` | `timer_stop` | Timer stop |
| `get` | `event_trigger` | Event trigger |
| `gen` | `element_name` | Get element name |
| `gsen` | `element_name_set` | Set element name |

## Default Action String

```lua
self:bmo(0) self:bmi(0) self:bma(127)
self:glc(-1,{{-1,-1,-1,1}}) self:glp(-1,-1)
self:gms(-1,-1,-1,-1)
```

This sets button mode to 0, min 0, max 127, configures LED color/phase, and sends MIDI.

---
[← Back to Reference](../GRID_LUA.md)

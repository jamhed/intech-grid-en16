# `endless_handler` (short: `epc`)

The handler receives `self` as its implicit parameter (object-oriented style), which is the endless potentiometer element object.

## Available Methods via `self`

### Endless-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `lix` | `led_index` | LED index |
| `lof` | `led_offset` | LED offset |
| `epva` | `endless_value` | Current endless value |
| `epmi` | `endless_min` | Minimum endless value |
| `epma` | `endless_max` | Maximum endless value |
| `epmo` | `endless_mode` | Endless mode (0=absolute, 1=relative, 2=relative 2's complement) |
| `epel` | `endless_elapsed_time` | Time since last endless event |
| `epst` | `endless_state` | Current endless state |
| `epv0` | `endless_velocity` | Endless velocity |
| `epdir` | `endless_direction` | Endless direction |
| `epse` | `endless_sensitivity` | Endless sensitivity |

### Button-related (endless push-button)

| Short | Human Name | Description |
|-------|-----------|-------------|
| `bva` | `button_value` | Button value |
| `bmi` | `button_min` | Button min |
| `bma` | `button_max` | Button max |
| `bmo` | `button_mode` | Button mode |
| `bel` | `button_elapsed_time` | Button elapsed time |
| `bst` | `button_state` | Button state |

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
self:epmo(0) self:epv0(50) self:epmi(0) self:epma(127) self:epse(50)
self:glc(-1,{{-1,-1,-1,1}}) self:glp(-1,-1)
self:gms(-1,-1,-1,-1)
```

This sets endless mode to 0, velocity to 50, min 0, max 127, sensitivity 50, configures LED color/phase, and sends MIDI.

---
[← Back to Reference](../GRID_LUA.md)

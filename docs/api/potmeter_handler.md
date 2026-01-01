# `potmeter_handler` (short: `pc`)

The handler receives `self` as its implicit parameter (object-oriented style), which is the potentiometer element object.

## Available Methods via `self`

### Potmeter-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `lix` | `led_index` | LED index |
| `pva` | `potmeter_value` | Current potentiometer value |
| `pmi` | `potmeter_min` | Minimum potentiometer value |
| `pma` | `potmeter_max` | Maximum potentiometer value |
| `pmo` | `potmeter_resolution` | Potentiometer resolution/mode |
| `pel` | `potmeter_elapsed_time` | Time since last potentiometer event |
| `pst` | `potmeter_state` | Current potentiometer state |

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
self:pmo(7) self:pmi(0) self:pma(127)
self:glc(-1,{{-1,-1,-1,1}}) self:glp(-1,-1)
self:gms(-1,-1,-1,-1)
```

This sets potentiometer resolution to 7-bit, min 0, max 127, configures LED color/phase, and sends MIDI.

---
[← Back to Reference](../GRID_LUA.md)

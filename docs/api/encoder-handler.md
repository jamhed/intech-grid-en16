# `encoder_handler` (short: `ec`)

The handler receives `self` as its implicit parameter (object-oriented style), which is the encoder element object.

## Available Methods via `self`

### Encoder-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `lix` | `led_index` | LED index |
| `eva` | `encoder_value` | Current encoder value |
| `emi` | `encoder_min` | Minimum encoder value |
| `ema` | `encoder_max` | Maximum encoder value |
| `emo` | `encoder_mode` | Encoder mode (0=absolute, 1=relative, 2=relative 2's complement) |
| `eel` | `encoder_elapsed_time` | Time since last encoder event |
| `est` | `encoder_state` | Current encoder state |
| `ev0` | `encoder_velocity` | Encoder velocity |
| `ese` | `encoder_sensitivity` | Encoder sensitivity |

### Button-related (encoder push-button)

| Short | Human Name | Description |
|-------|-----------|-------------|
| `bva` | `button_value` | Button value |
| `bmi` | `button_min` | Button min |
| `bma` | `button_max` | Button max |
| `bmo` | `button_mode` | Button mode |
| `bel` | `button_elapsed_time` | Button elapsed time |
| `bst` | `button_state` | Button state |
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
self:emo(0) self:ev0(50) self:emi(0) self:ema(127) self:ese(100)
self:glc(-1,{{-1,-1,-1,1}}) self:glp(-1,-1)
self:gms(-1,-1,-1,-1)
```

This sets encoder mode to 0, velocity to 50, min 0, max 127, sensitivity 100, configures LED color/phase, and sends MIDI.

---
[← Back to Reference](../grid-lua.md)

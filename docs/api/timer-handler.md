# `timer_handler` (short: `tim`)

The handler receives `self` as its implicit parameter (object-oriented style). The timer handler is available on all element types and inherits all methods from its parent element.

## Starting and Stopping Timers

Timers are controlled via the parent element's methods:

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gtt` | `timer_start` | Start timer with interval in milliseconds |
| `gtp` | `timer_stop` | Stop the timer |
| `gts` | `timer_source` | Get timer source |

## Available Methods via `self`

The timer handler has access to all methods of its parent element type:

- For encoders: all encoder parameters (`eva`, `emo`, etc.) and button parameters
- For buttons: all button parameters (`bva`, `bst`, etc.)
- For potmeters: all potmeter parameters (`pva`, `pmo`, etc.)
- For endless: all endless parameters (`epva`, `epmo`, etc.) and button parameters

### General functions (always available)

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
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
print('tick')
```

This simply prints 'tick' to the console. Timer must be started first via `self:gtt(interval_ms)` in another handler (e.g., init or button handler).

---
[← Back to Reference](../grid-lua.md)

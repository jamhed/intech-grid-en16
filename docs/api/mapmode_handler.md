# `mapmode_handler` (short: `map`)

The handler receives `self` as its implicit parameter (object-oriented style). This handler is part of the System element and is triggered when the page/mapmode changes (e.g., via utility button press).

## Available Methods via `self`

### System-specific parameters

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |

### Page functions (global)

| Short | Human Name | Description |
|-------|-----------|-------------|
| `gpn` | `page_next` | Get next page number |
| `gpp` | `page_previous` | Get previous page number |
| `gpc` | `page_current` | Get current page number |
| `gpl` | `page_load` | Load a specific page |

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
gpl(gpn())
```

This loads the next page when mapmode changes (utility button cycles through pages).

---
[← Back to Reference](../GRID_LUA.md)

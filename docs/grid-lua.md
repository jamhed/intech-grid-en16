# Grid Lua API Reference

This documentation covers the Lua API available for Grid controllers. Each handler receives `self` as an implicit parameter providing access to element-specific methods.

## Globals

| Global | Short | Description |
|--------|-------|-------------|
| [element](api/element.md) | `ele` | Array of all elements on the controller |
| [global_functions](api/global-functions.md) | - | LED, MIDI, page, timer, utility functions |

## Element Handlers

### Lifecycle

| Handler | Short | Element | Description |
|---------|-------|---------|-------------|
| [init_handler](api/init-handler.md) | `ini` | All | Element/page initialization (runs once) |

### Input Elements

| Handler | Short | Element | Description |
|---------|-------|---------|-------------|
| [encoder_handler](api/encoder-handler.md) | `ec` | Encoder | Rotary encoder rotation events |
| [button_handler](api/button-handler.md) | `bc` | Button/Encoder | Button press/release events |
| [potmeter_handler](api/potmeter-handler.md) | `pc` | Potentiometer | Analog potentiometer events |
| [endless_handler](api/endless-handler.md) | `epc` | Endless | Endless potentiometer rotation events |

### System Handlers

| Handler | Short | Element | Description |
|---------|-------|---------|-------------|
| [timer_handler](api/timer-handler.md) | `tim` | All | Timer tick events (must be started first) |
| [mapmode_handler](api/mapmode-handler.md) | `map` | System | Page/mapmode change events |
| [midirx_handler](api/midirx-handler.md) | `mrx` | System | MIDI receive events |

### Display Handlers

| Handler | Short | Element | Description |
|---------|-------|---------|-------------|
| [draw_handler](api/draw-handler.md) | `ld` | LCD | Screen drawing/refresh events |

## Common Functions

These functions are available across most handlers:

| Short | Human Name | Description |
|-------|-----------|-------------|
| `ind` | `element_index` | Element index |
| `glc` | `led_color` | Set LED color |
| `glp` | `led_phase` | Set LED phase |
| `gms` | `midi_send` | Send MIDI message |
| `gtt` | `timer_start` | Start timer |
| `gtp` | `timer_stop` | Stop timer |
| `get` | `event_trigger` | Trigger event |
| `gen` | `element_name` | Get element name |
| `gsen` | `element_name_set` | Set element name |

## Handler Slots

Each element type has specific handler slots:

- **Encoder**: init (`ini`), button (`bc`), encoder (`ec`), timer (`tim`)
- **Button**: init (`ini`), button (`bc`), timer (`tim`)
- **Potmeter**: init (`ini`), potmeter (`pc`), timer (`tim`)
- **Endless**: init (`ini`), button (`bc`), endless (`epc`), timer (`tim`)
- **System**: init (`ini`), mapmode (`map`), midirx (`mrx`), timer (`tim`)
- **LCD**: init (`ini`), draw (`ld`)

## Related Documentation

- [Lua Config Authoring Guide](lua-config-guide.md) - How to write Lua config files
- [Grid CLI](../grid-cli/README.md) - Upload/download configurations

**Intech Studio Official:**

- [Grid Editor](https://docs.intech.studio/guides/introduction) - Visual configuration tool
- [Reference Manual](https://docs.intech.studio/reference-manual/introduction) - Complete function reference

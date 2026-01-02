# EN16 Configuration for Ableton Control Surface

This document explains how to configure the Intech EN16 Grid controller to work with the Ableton control surface.

## Overview

The EN16 needs custom Lua scripts on each element to:
- Send MIDI CC/Note messages to Ableton
- Receive MIDI feedback to update encoder positions and LED states
- Handle long-press for track arming

## MIDI Layout

| Control | Type | Channel | Identifiers |
|---------|------|---------|-------------|
| Encoders | CC | 0 | 32-47 |
| Buttons | Note | 0 | 32-47 |
| Long Buttons | Note | 0 | 48-63 |
| Control Button | Note | 0 | 64 |

## Configuration Files

The configuration is stored in `configs/EN16-Control.json` (JSON format) or `configs/EN16-Control.lua` (Lua format).

Upload using the [Grid CLI tool](../grid-cli/README.md):
```bash
cd grid-cli
npx tsx grid-cli.ts upload ../configs/EN16-Control.json
```

## Element Scripts

### System Element (Element 16)

The system element (index 255 in config, physical element 16) handles:
- MIDI feedback routing from Ableton
- Periodic sync requests via timer

#### Setup Event (init)

```lua
MIDI_NOTE, MIDI_CC, CH = 144, 176, page_current()
function self.midirx_cb(self, event, header)
    if header[1] ~= 13 then
        return
    end
    local cmd, el, val = event[2], event[3] - 32, event[4]
    local on = val == 127
    if cmd == MIDI_NOTE and el >= 16 then
        element[el - 16]:led_color(1, {on and {255, 0, 0, 1} or {0, 0, 255, 1}})
    elseif cmd == MIDI_NOTE then
        element[el]:led_value(1, on and 100 or 0)
    elseif cmd == MIDI_CC and el < 16 then
        element[el]:encoder_value(val)
    end
end
self:timer_start(1000)
```

**How it works:**
- `midirx_cb` receives MIDI from Ableton
- Note messages (cmd=144) control LED brightness for buttons
- Note messages with el >= 16 set LED color for arm state (red=armed, blue=unarmed)
- CC messages (cmd=176) update encoder ring positions
- Timer triggers sync request every 1000ms

#### Timer Event

```lua
midi_send(CH, MIDI_NOTE, 64, 127)
```

Sends Note 64 to trigger Ableton's `update()` method, syncing all parameter values.

### Track/Device Encoders (Elements 0-7)

Control device parameters and track selection/arming.

#### Setup Event
```lua
self:led_color(1, {{0, 0, 255, 1}})
```
Blue LED color for device/track controls.

#### Button Event
```lua
local note, val = 32 + self:element_index(), self:button_value()
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
    end
end
midi_send(CH, MIDI_NOTE, note, val)
```

**Long press detection:**
- Normal press: sends Note 32-39 (track select)
- Long press (>1000ms): sends Note 48-55 (track arm)

#### Encoder Event
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

### Return Track Encoders (Elements 8-11)

#### Setup Event
```lua
self:led_color(1, {{87, 255, 165, 1}})
```
Green/teal LED color for return tracks.

#### Button Event
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

#### Encoder Event
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

### Clip/Volume Encoders (Elements 12-15)

#### Setup Event
```lua
self:led_color(1, {{255, 255, 0, 1}})
```
Yellow LED color for clip launch and mixer controls.

#### Button Event
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

#### Encoder Event
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Lua Snippets

### Long Press Detection Pattern

```lua
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        print("long press")
    else
        print("short press")
    end
end
```

### LED Color Format

```lua
-- {red, green, blue, layer}
-- Values: 0-255 for colors, layer is typically 1
self:led_color(1, {{255, 0, 0, 1}})  -- Red
self:led_color(1, {{0, 255, 0, 1}})  -- Green
self:led_color(1, {{0, 0, 255, 1}})  -- Blue
```

### MIDI Send

```lua
-- midi_send(channel, status, data1, data2)
midi_send(0, 144, 60, 127)  -- Note On, middle C, velocity 127
midi_send(0, 176, 1, 64)    -- CC 1, value 64
```

## Known Issues

**Initial sync delay**: On startup, Ableton sends parameter values before EN16's MIDI callback is ready. The timer event sends a sync request (note 64) to trigger a refresh after 1 second.

## References

- [Grid Lua API Reference](GRID_LUA.md)
- [Grid Editor Documentation](https://docs.intech.studio/guides/introduction)

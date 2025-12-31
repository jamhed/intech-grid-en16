# Ableton and EN16

```sh
cd ~/Music/Ableton/User\ Library/Remote\ Scripts/Intech
```

On Control Surface initialisation Ableton sends out values as MIDI messages,
however EN16 installs MIDI callback handler later, so these messages are skipped
or partially processed. As remediation, we request parameter update
in `setup` handler via delayed timer event.

##

Control track devices with auto-mapped encoders:
- first 8 encoders control device
- first 8 buttons select track
- buttons 8-12 select return track
- button long press arms track

It requires two things working together:

- EN16 configuration with Lua-snippets with [Grid editor](https://docs.intech.studio/guides/introduction)
- Ableton Control Surface Script for EN16 in Python

## Ableton Control Surface Script

### Development environment

Decompiled control surface [scripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts), for reference and inspiration.

Obtain Ableton Beta to enable Python console and script reload functions in `options.txt`:
```
-_ToolsMenuRemoteScripts
```

In Ableton Python console:

```python
control_surfaces[0]._c_instance.show_message("test")
```

## EN16 setup

### System button

There is a "system" button (16) to select pages, with following slots:

- setup
- utility
- midi rx (looks obsoleted)
- timer

Set encoder values based on the state transmitted by Ableton in setup slot:

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

Timer slot:

```lua
-- channel, midi note, note, velocity
midi_send(CH, MIDI_NOTE, 64, 127)
```

## Encoders

Encoders are configured by defininig Lua code per each encoder, in respective slots:

- setup
- button
- encoder
- timer

### Track encoder

For encoders 0-7:

Setup:
```lua
self:led_color(1, {{0, 0, 255, 1}})
```

Button:
```lua
local ch, note, val = page_current(), 32 + self:element_index(), self:button_value()
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
    end
end
-- channel, midi, note, velocity [-1 being a default]
self:midi_send(ch, 144, note, val)
```

Encoder:
```lua
local ch, cc, val = page_current(), 32 + self:element_index(), self:encoder_value()
midi_send(ch, 176, cc, val)
```

### Send encoder

Send/return tracks encoders (8-11):

Setup:
```lua
self:led_color(1, {{87, 255, 165, 1}})
```

Button:
```lua
local note, val = 32 + self:element_index(), self:button_value()
self:midi_send(CH, MIDI_NOTE, note, val)
```

Encoder:
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

### Control encoders

Control encoders (12-15):

Setup:
```lua
self:led_color(1, {{255, 255, 0, 1}})
```

Button:
```lua
local note, val = 32 + self:element_index(), self:button_value()
self:midi_send(CH, MIDI_NOTE, note, val)
```

Encoder:
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Lua

```lua
led_animation_phase_rate_type(num, 1, val, 1, 1)
led_color(self:element_index(), 1, led_default_red(), led_default_green(), led_default_blue())
led_value(self:element_index(), 1, 127)
timer_source(self:element_index(), 0)
timer_start(self:element_index(), 1000)
timer_stop(self:element_index())
self:led_color(-1, {{-1, -1, -1, 1}})
self:led_value(-1, -1)
self:button_mode(0)
self:button_min(0)
self:button_max(127)
self:encoder_mode(0)
self:encoder_velocity(50)
self:encoder_min(0)
self:encoder_max(127)
self:encoder_sensitivity(100)
self:endless_mode(0)
self:endless_velocity(50)
self:endless_min(0)
self:endless_max(16383)
self:endless_sensitivity(50)
self:potmeter_resolution(7)
self:potmeter_min(0)
self:potmeter_max(127)
```

Button long-press detector:

```lua
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        print("long press")
    else
        print("short press")
    end
end
```

# References

https://github.com/kmontag/modeStep
https://github.com/oslo1989/ableton-control-surface-toolkit

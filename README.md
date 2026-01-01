# Intech EN16 Ableton Control surface

Control Ableton with EN16 encoders and buttons:

- buttons 1-8 select a track, long press arms the track
- buttons 9-12 select a return track
- buttons 13-16 launch clips 1-4 in the current track
- encoders 1-12 control device in the current track
- encoders 13-16 control sends and volume (16 - volume, 15 - sends A, 14 - sends B, 13 - sends C)

It requires two components working together:

- Custom EN16 configuration profile
- Ableton Control Surface Script for EN16

# Ableton Control Surface Script

Copy python files (`*.py`) from this repo to Ableton remote scripts location,
e.g., `~/Music/Ableton/User\ Library/Remote\ Scripts/Intech`.

## Setting up Ableton for development

Ableton Python API is known to be poorly documented, so decompiled Python scripts from Ableton is the
documentation source. Helpful references on how to develop a custom Ableton Control surface:

- https://github.com/kmontag/modeStep
- https://github.com/oslo1989/ableton-control-surface-toolkit
- https://github.com/gluon/AbletonLive12_MIDIRemoteScripts

Obtain Ableton Beta to enable Python console and script reload functions in `options.txt`:
```
-_ToolsMenuRemoteScripts
```

Then in Ableton Python console:

```python
control_surfaces[0]._c_instance.show_message("test")
```

This project has AbletonLive12_MIDIRemoteScripts in `__ext__` folder as git submodule.
This enables Pyright to check types and editor to provide context help, and it is not 
required to run the control surface.

# EN16 development

Development requires providing Lua-snippets via [Grid editor](https://docs.intech.studio/guides/introduction) in different pre-defined event slots.
Grid editor configuration files location: `~/Documents/grid-userdata/configs`. Below are Lua snippets
that can be pasted in event slots into `Code` widget, and adjusted if needed.

Lua scripts are [transformed](https://github.com/intechstudio/grid-protocol) to reduce size (by using abbreviations for built-in functions, and
removing whitespaces).

At the device boot, it executes event handlers in order:

- System Setup
- System other Events
- Element 0 Setup
- Element 0 other Events
- Element 1 Setup
- Element 1 other Events
- ...

## System button

There is a "system" button (e.g., Element 16), typically used to select pages, with following event slots:

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

## Track/Device encoder

For encoders 0-7:

Setup:
```lua
self:led_color(1, {{0, 0, 255, 1}})
```

Button:
```lua
local note, val = page_current(), 32 + self:element_index(), self:button_value()
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
    end
end
-- channel, midi, note, velocity [-1 being a default]
self:midi_send(CH, MIDI_NOTE, note, val)
```

Encoder:
```lua
local cc, val = page_current(), 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Return/Send encoder

Send/return tracks encoders (8-11):

Setup:
```lua
self:led_color(1, {{87, 255, 165, 1}})
```

Button:
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

Encoder:
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Launch/volume encoders

Launch/volume encoders (12-15):

Setup:
```lua
self:led_color(1, {{255, 255, 0, 1}})
```

Button:
```lua
local note, val = 32 + self:element_index(), self:button_value()
midi_send(CH, MIDI_NOTE, note, val)
```

Encoder:
```lua
local cc, val = 32 + self:element_index(), self:encoder_value()
midi_send(CH, MIDI_CC, cc, val)
```

## Lua

Button long-press detector:

```lua
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        print("long press, after 1 seconds")
    else
        print("short press")
    end
end
```

## Built-in functions

For reference, built-in functions defined by Grid [firmware](https://github.com/intechstudio/grid-fw/tree/master/grid_common/lua_src):

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

# Known issues

On Control Surface initialisation Ableton sends out values as MIDI messages,
however EN16 installs MIDI callback handler later, so these messages are skipped
or partially processed. As remediation, we request parameter update
in `setup` handler via delayed timer event.

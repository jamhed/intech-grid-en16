--[[
  EN16 Control - Ableton Live Controller

  Layout:
    Encoders 0-7:   Track selection (long press = arm)
    Encoders 8-11:  Return track selection
    Encoders 12-15: Clip launch / Volume control
    System (255):   MIDI feedback handler
]]

local grid = require("grid")

-- Colors
local BLUE = {0, 0, 255, 1}
local GREEN = {87, 255, 165, 1}
local YELLOW = {255, 255, 0, 1}

-- Element template with color and optional long-press behavior
local function encoder(color, long_press)
  return {
    init = function(self)
      self:led_color(1, {color})
    end,

    encoder = function(self)
      local cc, val = 32 + self:element_index(), self:encoder_value()
      midi_send(CH, MIDI_CC, cc, val)
    end,

    button = function(self)
      local note, val = 32 + self:element_index(), self:button_value()
      if long_press and self:button_state() == 0 and self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
      end
      midi_send(CH, MIDI_NOTE, note, val)
    end,
  }
end

return grid.config {
  name = "EN16 Control",
  type = "EN16",
  version = {1, 7, 0},

  -- Track encoders (blue, long-press = arm)
  [0] = encoder(BLUE, true),
  [1] = encoder(BLUE, true),
  [2] = encoder(BLUE, true),
  [3] = encoder(BLUE, true),
  [4] = encoder(BLUE, true),
  [5] = encoder(BLUE, true),
  [6] = encoder(BLUE, true),
  [7] = encoder(BLUE, true),

  -- Return track encoders (green)
  [8] = encoder(GREEN, false),
  [9] = encoder(GREEN, false),
  [10] = encoder(GREEN, false),
  [11] = encoder(GREEN, false),

  -- Clip/Volume encoders (yellow)
  [12] = encoder(YELLOW, false),
  [13] = encoder(YELLOW, false),
  [14] = encoder(YELLOW, false),
  [15] = encoder(YELLOW, false),

  -- System element
  [255] = {
    init = function(self)
      MIDI_NOTE, MIDI_CC, CH = 144, 176, page_current()

      function self.midirx_cb(self, event, header)
        if header[1] ~= 13 then return end

        local cmd, el, val = event[2], event[3] - 32, event[4]
        local on = val == 127
        local elm = element[el >= 16 and el - 16 or el]

        if cmd == MIDI_NOTE and el >= 16 then
          elm:led_color(1, {on and {255, 0, 0, 1} or {0, 0, 255, 1}})
        elseif cmd == MIDI_NOTE then
          elm:led_value(1, on and 100 or 0)
        elseif cmd == MIDI_CC and el < 16 then
          elm:encoder_value(val)
        end
      end

      self:timer_start(1000)
    end,

    utility = function(self)
      page_load(page_next())
    end,

    timer = function(self)
      midi_send(CH, MIDI_NOTE, 64, 127)
    end,
  },
}

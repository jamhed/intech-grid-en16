# `element` (short: `ele`)

The `ele` global is an array containing all elements on the Grid controller. Elements are 0-indexed and can be accessed directly to interact with any control on the module.

## Accessing Elements

```lua
-- Access element by index
ele[0]  -- First element
ele[1]  -- Second element
ele[#ele]  -- Last element (usually System element)

-- Iterate over all elements
for i = 0, #ele do
  local e = ele[i]
  -- do something with element
end

-- Iterate over all elements except System
for i = 0, #ele - 1 do
  local e = ele[i]
  -- do something with element
end
```

## Element Properties

Each element has the following properties:

| Property | Description |
|----------|-------------|
| `index` | The element's index in the `ele` array |
| `type` | Element type string (see below) |

### Element Types

| Type | Description |
|------|-------------|
| `'encoder'` | Rotary encoder with push button |
| `'button'` | Push button |
| `'potmeter'` | Analog potentiometer (fader/knob) |
| `'endless'` | Endless potentiometer with push button |
| `'system'` | System element (always last, handles pages/MIDI RX) |
| `'lcd'` | LCD display element |

## Element Methods

Each element has access to all methods of its type. See the specific handler documentation for available methods:

- Encoder: [encoder_handler](encoder_handler.md), [button_handler](button_handler.md)
- Button: [button_handler](button_handler.md)
- Potmeter: [potmeter_handler](potmeter_handler.md)
- Endless: [endless_handler](endless_handler.md), [button_handler](button_handler.md)
- System: [mapmode_handler](mapmode_handler.md), [midirx_handler](midirx_handler.md)
- LCD: [draw_handler](draw_handler.md)

## Custom Properties

You can attach custom properties to any element for state management:

```lua
-- In init_handler
self.counter = 0
self.mode = 1
self.color = {255, 0, 0}

-- Access from another element
ele[0].counter = ele[0].counter + 1
```

## Common Use Cases

### Cross-element communication

```lua
-- In button handler, update another element's LED
ele[5]:glc(1, {{255, 0, 0, 1}})

-- Read value from another encoder
local other_value = ele[3]:eva()
```

### Check element type

```lua
for i = 0, #ele - 1 do
  if ele[i].type == "encoder" then
    -- Handle encoder-specific logic
  elseif ele[i].type == "button" then
    -- Handle button-specific logic
  end
end
```

### Initialize all elements

```lua
-- In system init, set all LEDs to same color
for i = 0, #ele - 1 do
  ele[i]:glc(1, {{0, 255, 0, 1}})
end
```

### Register callbacks on elements

```lua
-- Register MIDI receive callback on specific element
ele[0].midirx_cb = function(self, event, header)
  -- Handle MIDI for this element
end

-- Register event receive callback (for LCD)
ele[0].eventrx_cb = function(self, header, event, value, name)
  -- Handle events from other elements
end
```

## Module Layouts

Different Grid modules have different element counts and arrangements:

| Module | Elements | Layout |
|--------|----------|--------|
| EN16 | 16 encoders + system | 0-15: encoders, 16: system |
| BU16 | 16 buttons + system | 0-15: buttons, 16: system |
| PO16 | 16 potmeters + system | 0-15: potmeters, 16: system |
| PBF4 | 4 faders + 4 buttons + system | 0-3: faders, 4-7: buttons, 8: system |
| EF44 | 4 faders + 4 encoders + system | 0-3: faders, 4-7: encoders, 8: system |
| TEK2 | 2 endless + system | 0-1: endless, 2: system |

The System element is always the last element in the array.

---
[← Back to Reference](../GRID_LUA.md)

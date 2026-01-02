# `init_handler` (short: `ini`)

The handler receives `self` as its implicit parameter (object-oriented style). This handler is available on all element types and runs once when the element or page is initialized.

## Purpose

The init handler is used to:

- Set up initial element state
- Configure default values
- Initialize custom variables on `self`
- Set up LED colors for the initial state
- Register callbacks (e.g., `midirx_cb`, `eventrx_cb`)

## Available Methods via `self`

The init handler has access to all methods of its parent element type:

- For encoders: all encoder parameters (`eva`, `emo`, etc.) and button parameters
- For buttons: all button parameters (`bva`, `bst`, etc.)
- For potmeters: all potmeter parameters (`pva`, `pmo`, etc.)
- For endless: all endless parameters (`epva`, `epmo`, etc.) and button parameters
- For system: page functions (`gpn`, `gpc`, `gpl`, etc.)
- For LCD: screen parameters and drawing functions

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

## Default Action Strings

The default init handlers are placeholder comments for user code:

| Element | Default Action String |
|---------|----------------------|
| Encoder | `--[[Encoder Init]]` |
| Button | `--[[Button Init]]` |
| Potmeter | `--[[Potmeter Init]]` |
| Endless | `--[[Endless Init]]` |
| System | `--[[page init]]` |
| LCD | Complex initialization (see below) |

### LCD Init Example

The LCD init handler sets up display variables and callbacks:

```lua
glsb(255)  -- set backlight
pi,s,c = math.pi, 64, {{0,0,0},{255,255,255},{glr(),glg(),glb()}}
self.f = 1  -- frame flag
self.v = {27,0,100}  -- value array
self.id = 'VSN1'  -- element ID string

-- Element type names
d = {[1]='Linear',[2]='Encoder',[3]='Button',[7]='Endless'}

-- Screen center and padding
xc,yc,p = 160,120,s*5/8

-- Event receive callback
self.eventrx_cb = function(self,hdr,e,v,n)
  self.v = v
  if #n==0 then n=d[e[3]]..e[2] end
  self.id = string.sub(n,1,(self:lsw()/(s/2)-1)//1)
  self.f = 1
end

-- Draw initial frame
self:ldaf(0,0,319,239,c[1])
self:ldrr(3,3,317,237,10,c[2])
```

## Common Use Cases

### Setting initial LED color

```lua
self:glc(1, {{255, 0, 0, 1}})  -- Red LED
```

### Starting a timer

```lua
self:gtt(100)  -- Start 100ms timer
```

### Initializing custom state

```lua
self.counter = 0
self.mode = 1
```

### Registering MIDI receive callback

```lua
self.midirx_cb = function(self, event, header)
  -- Handle incoming MIDI
end
```

---
[← Back to Reference](../grid-lua.md)

# Grid Firmware Internals

Technical documentation for the Lua runtime embedded in Intech Grid device firmware.

## Overview

Grid devices run **Lua 5.4.3** embedded in the firmware. Scripts are stored per-event in flash memory and executed when hardware events occur.

## Runtime Constraints

| Aspect | Details |
|--------|---------|
| Lua Version | 5.4.3 (full interpreter) |
| Memory Limit | ~70 KB soft target |
| Max Script Length | 909 characters per event |
| `require()` Support | **None** - package library disabled |
| Storage | LittleFS flash filesystem |

## Script Storage

Scripts are uploaded as "action strings" wrapped with Lua tags:

```text
<?lua CODE_HERE ?>
```

The firmware transforms this into an element method:

```lua
ele[0].init = function(self)
  local _efn = EFN
  EFN = "init"
  CODE_HERE
  EFN = _efn
end
```

### Storage Path

```text
Device Flash (LittleFS)
└── page/
    └── element/
        └── event_type  (contains Lua action string)
```

- 4 pages (0-3)
- 16 elements per page (0-15) + system element (255)
- Multiple events per element

## No Module Support

The firmware explicitly disables the Lua package library:

```c
// From grid_lua.c - package library commented out
// {LUA_LOADLIBNAME, luaopen_package}
```

This means:

- `require()` function is not available
- No dynamic module loading
- All code must be self-contained per event
- Shared code must be duplicated or placed in system element init

## Memory Management

- Single Lua state shared by all elements
- Automatic garbage collection when memory > 70 KB
- GC runs after each event handler completes
- Use concise code to stay within limits

## Execution Flow

1. **Boot**: Firmware initializes Lua VM, loads embedded libraries
2. **Config Load**: Action strings read from LittleFS flash
3. **Registration**: Each `<?lua CODE ?>` → `ele[n].event = function(self) CODE end`
4. **Event Trigger**: Hardware event → `lua_pcall(ele[n].event, element)`
5. **GC Step**: Incremental garbage collection after each event

## Embedded Libraries

These Lua utilities are compiled into firmware (not uploadable):

| Library | Purpose |
|---------|---------|
| `decode.lua` | MIDI/event message decoding |
| `lookup.lua` | Lookup table functions |
| `limit.lua` | Value limiting/clamping |
| `mapsat.lua` | Map and saturate functions |
| `simplemidi.lua` | MIDI helper utilities |
| `simplecolor.lua` | Color manipulation |

## C API Bindings

The firmware exposes these C functions to Lua:

### MIDI

- `grid_midi_send()` → `midi_send()` / `gms()`
- `grid_midi_sysex_send()` → MIDI SysEx

### LED Control

- `grid_led_layer_color()` → `led_color()` / `glc()`
- `grid_led_layer_phase()` → `led_phase()` / `glp()`
- `grid_led_layer_frequency()` → LED animation

### Timers

- `grid_timer_start()` → `timer_start()` / `gtt()`
- `grid_timer_stop()` → `timer_stop()` / `gtp()`

### Page Navigation

- `grid_page_curr()` → `page_current()` / `gpc()`
- `grid_page_next()` → `page_next()` / `gpn()`
- `grid_page_load()` → `page_load()` / `gpl()`

### USB HID

- `grid_usb_keyboard_send()` → USB keyboard
- `grid_mousemove_send()` → USB mouse movement
- `grid_mousebutton_send()` → USB mouse button

### Debug

- `print()` → Sends to Grid Editor console

## Thread Safety

- Lua state protected by semaphore
- `grid_lua_semaphore_lock()` / `grid_lua_semaphore_release()`
- Prevents corruption from concurrent hardware events

## Error Handling

- All Lua execution uses `lua_pcall()` (protected call)
- Errors captured in `stde` buffer (400 bytes)
- Error messages broadcast to connected Grid Editor

## Implications for CLI Tool

Since the device:

1. Has no `require()` support
2. Stores scripts per element/event
3. Transforms action strings into `ele[n].event = function(self) ... end`

The CLI tool must:

1. Parse Lua config files locally
2. Extract individual function bodies
3. Inline any upvalues/closures
4. Upload each event as a separate action string

The `grid.config` format with `require("grid")` is purely a CLI convenience - the device never sees this structure.

## References

- [Grid Lua API Reference](grid-lua.md)
- [EN16 Configuration Guide](en16-config.md)
- [Lua Config Authoring Guide](lua-config-guide.md)
- [Grid Editor Source](https://github.com/intechstudio/grid-editor)
- [Grid Firmware Source](https://github.com/intechstudio/grid-fw)

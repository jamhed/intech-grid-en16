# `midirx` (short: `mrx`)

The MIDI receive handler is part of the System element and is triggered when MIDI messages are received. It provides access to incoming MIDI data via the global `midi` object.

## The `midi` Object

When the handler is triggered, the `midi` global object contains the received MIDI message:

| Property | Description |
|----------|-------------|
| `midi.ch` | MIDI channel |
| `midi.cmd` | MIDI command (status byte) |
| `midi.p1` | MIDI parameter 1 (note/CC number) |
| `midi.p2` | MIDI parameter 2 (velocity/value) |

## MIDI RX Control Functions (global)

| Short | Human Name | Description |
|-------|-----------|-------------|
| `mre` | `midirx_enabled` | Enable/disable MIDI RX processing (1=enabled, 0=disabled) |
| `mrs` | `midirx_sync` | Enable/disable MIDI sync messages (clock, start, stop) |

## Custom Callback Pattern

You can define a custom `midirx_cb` callback on elements to handle MIDI messages:

```lua
function self.midirx_cb(self, event, header)
    -- event[1] = channel, event[2] = command, event[3] = param1, event[4] = param2
    -- header[1] = source info
end
```

## Default Action String

```lua
local ch,cmd,param1,param2=midi.ch,midi.cmd,midi.p1,midi.p2
```

This extracts the MIDI message components into local variables for use in custom code.

---
[← Back to Reference](../grid-lua.md)

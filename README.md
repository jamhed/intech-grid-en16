# Intech EN16 Ableton Control Surface

![Intech EN16](docs/en16.png)

A custom Ableton Live control surface for the [Intech Grid EN16](https://intech.studio/shop/en16) controller.

## How It Works

This integration has two parts that communicate via MIDI:

```mermaid
flowchart LR
    subgraph EN16["EN16 Controller"]
        Lua["Lua Scripts"]
    end
    subgraph Ableton["Ableton Live"]
        Python["Python Control Surface"]
    end
    Lua <-->|MIDI| Python
```

| Component | Location | Purpose |
|-----------|----------|---------|
| **Control Surface** | `control_surface/Grid.py` | Python script running in Ableton that maps MIDI to tracks, devices, and clips |
| **EN16 Configuration** | `configs/EN16-Control.lua` | Lua scripts running on the EN16 that handle encoders, buttons, and LED feedback |

Both sides must agree on the MIDI layout (which CC/Note numbers mean what). See [Control Surface Architecture](docs/control-surface.md) for details.

## Features

| Control | Function |
|---------|----------|
| Buttons 1-8 | Select track (long press to arm) |
| Buttons 9-12 | Select Return track A-D |
| Buttons 13-16 | Launch/stop clips 1-4 (selected track) |
| Encoders 1-8 | Device parameters (selected track) |
| Encoders 9-12 | (available for custom mapping) |
| Encoder 13 | Send level to Return C (selected track) |
| Encoder 14 | Send level to Return B (selected track) |
| Encoder 15 | Send level to Return A (selected track) |
| Encoder 16 | Volume (selected track) |

## Installation

### 1. Control Surface (Ableton)

1. Copy this folder to Ableton's Remote Scripts:

   ```text
   ~/Music/Ableton/User Library/Remote Scripts/Intech
   ```

2. In Ableton Live, go to **Preferences → Link, Tempo & MIDI**

3. Set Control Surface to **Intech**, Input/Output to your EN16 MIDI ports

4. Restart Ableton Live

### 2. EN16 Configuration

Upload the Lua configuration to your EN16 using Grid Editor or the CLI tool:

```bash
cd grid-cli && npm install
npx tsx grid-cli.ts upload ../configs/EN16-Control.json
```

See [EN16 Configuration Guide](docs/en16-config.md) for details on the Lua scripts.

## Project Structure

```text
Intech/
├── __init__.py              # Entry point
├── control_surface/
│   └── Grid.py              # Control surface implementation
├── configs/
│   ├── EN16-Control.json    # Grid config (JSON)
│   └── EN16-Control.lua     # Grid config (Lua)
├── grid-cli/                # CLI tool for config upload/download
├── docs/                    # Documentation
└── __ext__/                 # Git submodules (reference scripts)
```

## Development

### Control Surface (Python)

Edit `control_surface/Grid.py` to modify Ableton integration.

**Prerequisites:** Ableton Live 11+ (Python 3.x bundled)

**Reload scripts:** Add `-_ToolsMenuRemoteScripts` to `Options.txt` (Beta only), then use Tools → Reload MIDI Remote Scripts. Clear `__pycache__` before reloading.

**View logs:**

```bash
tail -f ~/Library/Preferences/Ableton/Live\ */Log.txt | grep -i intech
```

**References:**

- [Control Surface Architecture](docs/control-surface.md) - How the framework works
- [AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) - Decompiled scripts
- [ableton-control-surface-toolkit](https://github.com/oslo1989/ableton-control-surface-toolkit) - Live object documentation

### EN16 Configuration (Lua)

Edit `configs/EN16-Control.lua` to modify controller behavior, then upload to the device.

**Using Grid CLI:**

```bash
cd grid-cli && npm install
npx tsx grid-cli.ts upload ../configs/EN16-Control.json
```

**Using Grid Editor:** Open [Grid Editor](https://editor.intech.studio/), connect your EN16, and configure elements visually.

**References:**

- [EN16 Configuration Guide](docs/en16-config.md) - Element scripts and MIDI routing
- [Lua Config Authoring Guide](docs/lua-config-guide.md) - Write configs in Lua
- [Grid CLI Tool](grid-cli/README.md) - CLI for upload/download
- [Grid Lua API](docs/grid-lua.md) - Full API reference
- [Grid Firmware Internals](docs/grid-firmware.md) - Device runtime details
- [Grid Editor Documentation](https://docs.intech.studio/guides/introduction) - Official docs

## Known Issues

**Initial sync delay**: On startup, Ableton sends parameter values before EN16's MIDI callback is ready. A one-shot timer fires after 1 second to request a refresh.

## License

MIT

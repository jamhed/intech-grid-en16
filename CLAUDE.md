# Intech EN16 Ableton Control Surface

Ableton Live MIDI Remote Script for Intech Grid EN16 controller.

## Project Structure

| Path | Purpose |
|------|---------|
| `control_surface/Grid.py` | Python control surface (runs in Ableton) |
| `configs/EN16-Control.lua` | Lua config (runs on EN16 hardware) |
| `grid-cli/` | TypeScript CLI for config upload/download |
| `docs/` | Documentation |
| `__ext__/` | Git submodules (reference scripts, not modified) |

## Two-Part Architecture

EN16 Lua and Ableton Python communicate via MIDI. Both must use matching CC/Note numbers.

| Control | MIDI | Direction |
|---------|------|-----------|
| Encoders | CC 32-47 | Bidirectional |
| Buttons | Note 32-47 | EN16 → Ableton |
| Long buttons | Note 48-63 | EN16 → Ableton |
| LEDs | Note 32-63 | Ableton → EN16 |

## Key Documentation

- [Framework Versions](docs/ableton-framework-versions.md) - `_Framework` vs `ableton.v2` vs `ableton.v3`
- [Control Surface Architecture](docs/control-surface.md) - Component system, layers, events
- [EN16 Configuration](docs/en16-config.md) - Lua scripts for hardware
- [Grid Lua API](docs/grid-lua.md) - Hardware API reference

## Development Commands

```bash
# Python (control surface)
ruff check control_surface/
ruff format control_surface/

# TypeScript (grid-cli)
cd grid-cli && pnpm lint && pnpm build

# Documentation
./scripts/check-docs.sh        # Lint markdown
./scripts/check-docs.sh --fix  # Auto-fix

# Upload config to EN16
cd grid-cli && npx tsx grid-cli.ts upload ../configs/EN16-Control.json
```

## Testing Changes

1. Edit `control_surface/Grid.py`
2. Clear `control_surface/__pycache__/`
3. Restart Ableton (or use Tools → Reload MIDI Remote Scripts in Beta)
4. Watch logs: `tail -f ~/Library/Preferences/Ableton/Live\ */Log.txt | grep -i intech`

## Reference Scripts

Decompiled Ableton scripts in `__ext__/AbletonLive12_MIDIRemoteScripts/`:
- `APC40_MkII/` - Good `_Framework` example
- `APC64/` - Modern `ableton.v3` example
- `_Framework/` - Base classes (ControlSurface, components, elements)

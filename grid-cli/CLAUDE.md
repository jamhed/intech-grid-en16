# Claude Code Instructions for grid-cli

## Project Overview

Grid CLI is a TypeScript command-line tool for managing Intech Grid controller configurations. It communicates with hardware via USB serial and supports both JSON and Lua configuration formats.

**Read first:** [docs/architecture.md](docs/architecture.md) for system design and module responsibilities.

## Quick Reference

| File            | Purpose                     |
| --------------- | --------------------------- |
| `grid-cli.ts`   | CLI commands                |
| `connection.ts` | Serial communication        |
| `protocol/`     | Packet building/parsing     |
| `lib.ts`        | Types, constants, utilities |
| `lua-loader.ts` | Lua parsing, AST processing |

## Development Commands

```bash
npm test          # Run tests (vitest)
npm run lint      # Check code quality
npm run format    # Format with prettier
npm run cli -- <command>  # Run CLI
```

## Coding Standards

**Follow:** [docs/coding-style.md](docs/coding-style.md)

Key patterns in this codebase:

- Arrow functions for predicates: `const shouldRename = (name) => ...`
- Named constants for magic numbers: `MAX_SERIALIZABLE_ARRAY_LENGTH`
- Helper functions for repeated logic: `toAbsoluteIndex()`
- Functional style for transformations: `.map().filter().sort()`
- Type aliases for complex types: `type LuaState = ...`

## Architecture Guidelines

### Module Boundaries

- **lib.ts**: Pure utilities, no I/O, no side effects
- **lua-loader.ts**: Lua processing only, exports `loadLuaConfig` and `renameIdentifiers`
- **grid-cli.ts**: CLI and serial I/O, imports from lib and lua-loader

### Adding New Features

1. **New utility function** → Add to `lib.ts` with tests in `lib.test.ts`
2. **New Lua processing** → Add to `lua-loader.ts` with tests in `lua-loader.test.ts`
3. **New CLI command** → Add to `grid-cli.ts` using commander pattern

### Reserved Identifiers (lua-loader.ts)

When modifying identifier renaming, preserve:

- `self` - Grid implicit parameter
- `midirx_cb`, `sysex_cb` - Firmware callback names
- Grid builtins from `@intechstudio/grid-protocol`
- Lua keywords

## Testing

Tests use Vitest. Run with `npm test`.

**Test patterns:**

- Unit tests for pure functions
- Integration tests for Lua loading (create temp files)
- All tests must pass before committing

## Common Tasks

### Fix a bug in Lua parsing

1. Add failing test to `lua-loader.test.ts`
2. Fix in `lua-loader.ts`
3. Run `npm test` to verify

### Add a new Grid device type

1. Add to `DEVICE_CONFIG` in `lib.ts`
2. Add test case in `lib.test.ts`
3. Update `docs/architecture.md` device table

### Modify script validation

1. Update `validateActionLength()` in `lib.ts`
2. Update `MAX_ACTION_LENGTH` if limit changes
3. Add/update tests in `lib.test.ts`

## Important Constants

| Constant                | Value   | Purpose                 |
| ----------------------- | ------- | ----------------------- |
| `MAX_ACTION_LENGTH`     | 909     | Max chars per script    |
| `SYSTEM_ELEMENT`        | 255     | System event element ID |
| `SERIAL_BAUD_RATE`      | 2000000 | USB serial speed        |
| `FRAME_TERMINATOR_SIZE` | 3       | Protocol frame ending   |

## Dependencies

- `fengari` - Lua VM in JavaScript
- `luaparse` - Lua AST parser
- `serialport` - USB serial communication
- `commander` - CLI framework
- `@intechstudio/grid-protocol` - Grid binary protocol

## Code Quality Checklist

Before committing:

- [ ] `npm test` passes
- [ ] `npm run lint` has no errors
- [ ] New functions have JSDoc comments
- [ ] Magic numbers extracted to named constants
- [ ] No duplicate logic (check for DRY violations)

# Grid CLI Architecture

A TypeScript CLI tool for uploading and downloading Grid controller configurations via USB serial communication.

## Overview

Grid CLI manages configurations for Intech Grid controllers (EN16, PO16, BU16, EF44, PBF4, TEK2, PB44). It supports two configuration formats:
- **JSON** - Binary Grid Editor format
- **Lua** - Human-readable format with Grid library

## File Structure

```
grid-cli/
├── grid-cli.ts      # CLI entry point, serial communication
├── lib.ts           # Shared utilities, types, constants
├── lua-loader.ts    # Lua parsing and JSON conversion
├── lib.test.ts      # Unit tests for lib.ts
├── lua-loader.test.ts # Unit tests for lua-loader.ts
└── docs/
    └── architecture.md
```

## Core Modules

### grid-cli.ts (19 KB)

Main CLI entry point using the `commander` library.

**Commands:**
- `upload <config>` - Upload JSON/Lua config to device
- `download <output>` - Download current config as JSON
- `convert <input>` - Convert Lua to JSON format

**Key Functions:**
- `buildConfigPacket()` - Creates binary packets for CONFIG commands
- `parsePacket()` - Decodes binary frames from device responses
- `sendAndWait()` - Generic async communication with timeout/retry
- `uploadConfig()` - Uploads scripts with progress tracking
- `downloadConfig()` - Fetches configuration from device

**Dependencies:**
- `serialport` - USB serial communication
- `commander` - CLI argument parsing
- `@intechstudio/grid-protocol` - Binary protocol encoding/decoding

### lib.ts (5 KB)

Shared utilities and type definitions.

**Constants:**
- `MAX_ACTION_LENGTH = 909` - Max script size per element/event
- `SYSTEM_ELEMENT = 255` - Reserved element for system-level events
- `EVENT_NAMES` - Maps event IDs (0-8) to names
- `DEVICE_CONFIG` - Hardware configs for 7 device types
- `USB_FILTERS` - USB VID/PID filters for device detection

**Types:**
- `ConfigFile` - Main config structure
- `ElementConfig` - Element-level configuration
- `EventConfig` - Individual event handler

**Functions:**
- `wrapScript()` / `unwrapScript()` - Protocol wrapper handling
- `validateActionLength()` - Enforces 909 char limit
- `countEvents()` - Counts non-empty events
- `parseEventType()` - Validates event type
- `sortElements()` - Sorts with system element last
- `renderProgress()` - ASCII progress bar

### lua-loader.ts (28 KB)

Lua script parsing and conversion to JSON format.

**Lua VM:**
- Uses Fengari (Lua in JavaScript) with Grid API stubs
- Executes Lua configs in sandboxed environment
- Extracts function bodies via AST parsing (luaparse)

**Key Components:**

1. **AST-Based Extraction**
   - `parseFunctions()` - Parses Lua and extracts function locations
   - `extractFunctionBody()` - Gets function body using AST ranges
   - `collectFunctions()` - Recursively collects function nodes

2. **Upvalue Inlining**
   - `getUpvalues()` - Uses Lua debug API to extract closure variables
   - `serializeLuaValue()` - Converts Lua values to literal strings
   - `inlineUpvalues()` - Replaces upvalue references with values

3. **Identifier Renaming** (`-r` flag)
   - `NameGenerator` - Generates short names (a, b, ..., z, aa, ab, ...)
   - `collectIdentifiers()` - Extracts identifiers with scope info
   - `renameIdentifiers()` - Multi-script renaming with consistent globals

4. **Config Extraction**
   - `extractMetadata()` - Parses name, type, version
   - `extractSystemEvents()` - Gets system element events
   - `extractElementConfigs()` - Gets element-specific events

**Main Export:**
- `loadLuaConfig(filePath)` - Converts Lua file to ConfigFile object
- `renameIdentifiers(scripts)` - Renames identifiers across scripts

## Data Flow

```
Lua Config (.lua)
       │
       ▼
lua-loader.ts (Fengari VM)
       │
       ├─► Extract metadata
       ├─► Extract system events
       ├─► Extract element configs
       ├─► Inline upvalues
       │
       ▼
ConfigFile (JSON)
       │
       ├─► Optional: Identifier renaming (-r flag)
       ├─► Optional: Minification (default)
       │
       ▼
grid-cli.ts (Serial Communication)
       │
       ├─► Wrap script: `<?lua ... ?>`
       ├─► Build binary packet (grid-protocol)
       ├─► Send to device via USB
       ├─► Wait for ACK/REPORT
       │
       ▼
Grid Device (via SerialPort)
```

## Supported Devices

| Device | Elements | Events |
|--------|----------|--------|
| EN16 | 16 + system | init, encoder, button, timer |
| PO16 | 16 + system | init, potmeter, button, timer |
| BU16 | 16 + system | init, button, timer |
| EF44 | 16 + system | init, encoder, button, endless, timer |
| PBF4 | 8 + system | init, potmeter, button, timer |
| TEK2 | 8 + system | init, encoder, button, timer |
| PB44 | 8 + system | init, potmeter, button, timer |

## Event Types

| ID | Name | Description |
|----|------|-------------|
| 0 | init | Element initialization |
| 1 | potmeter | Potentiometer movement |
| 2 | encoder | Rotary encoder turn |
| 3 | button | Button press/release |
| 4 | utility | System utility event |
| 5 | midirx | MIDI receive callback |
| 6 | timer | Periodic timer event |
| 7 | endless | Infinite rotary (EF44) |
| 8 | draw | Display draw event |

## Protocol

Communication uses the `@intechstudio/grid-protocol` library for binary packet encoding/decoding. Packets are wrapped with SOH/EOT markers and include checksums.

USB connection parameters:
- Baud rate: 2,000,000
- VID/PID: 03eb:ecac (D51), 03eb:ecad (D51 alt), 303a:8123 (ESP32)

## Testing

Tests use Vitest:
- `lib.test.ts` - 30+ test cases for utilities
- `lua-loader.test.ts` - 100+ test cases for Lua parsing

Run with: `npm test`

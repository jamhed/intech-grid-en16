# Coding Style Guide

TypeScript coding conventions for grid-cli, based on industry best practices.

## Core Principles

1. **DRY (Don't Repeat Yourself)** - Extract repeated logic into reusable functions
2. **Single Responsibility** - Functions should do one thing well
3. **Type Safety** - Leverage TypeScript's type system, avoid `any`
4. **Simplicity** - Prefer readable code over clever code

## TypeScript Conventions

### Prefer Arrow Functions for Predicates

```typescript
// Good: Single-expression predicates as arrow functions
const shouldRename = (name: string): boolean =>
  !LUA_KEYWORDS.has(name) && !RESERVED_IDENTIFIERS.has(name);

// Avoid: Verbose multi-line for simple logic
function shouldRename(name: string): boolean {
  if (LUA_KEYWORDS.has(name)) return false;
  if (RESERVED_IDENTIFIERS.has(name)) return false;
  return true;
}
```

### Use Named Constants for Magic Numbers

```typescript
// Good: Self-documenting constants
const MAX_SERIALIZABLE_ARRAY_LENGTH = 20;
const FRAME_TERMINATOR_SIZE = 3;  // EOT + 2 checksum bytes
const PROGRESS_BAR_WIDTH = 20;

if (len > MAX_SERIALIZABLE_ARRAY_LENGTH) return null;

// Avoid: Unexplained magic numbers
if (len > 20) return null;
```

### Extract Repeated Patterns into Helpers

```typescript
// Good: Reusable helper
const toAbsoluteIndex = (L: LuaState, idx: number): number =>
  idx < 0 ? lua.lua_gettop(L) + idx + 1 : idx;

// Then use everywhere
const absIdx = toAbsoluteIndex(L, index);

// Avoid: Repeated inline logic
const absIdx = index < 0 ? lua.lua_gettop(L) + index + 1 : index;
```

### Prefer Functional Style for Transformations

```typescript
// Good: Declarative chain
config.configs = sortElements(
  [...elementConfigs.entries()]
    .map(([elementNum, events]) => ({
      controlElementNumber: elementNum,
      events: [...events.entries()]
        .map(([eventType, script]) => ({ event: eventType, config: script }))
        .sort((a, b) => a.event - b.event),
    }))
    .filter((el) => el.events.length > 0)
);

// Avoid: Imperative loops with mutation
for (const [elementNum, events] of elementConfigs) {
  const eventArray: EventConfig[] = [];
  for (const [eventType, script] of events) {
    eventArray.push({ event: eventType, config: script });
  }
  // ...
}
```

### Consolidate Set/Collection Construction

```typescript
// Good: Constructor handles common reserved set
class NameGenerator {
  constructor(...additionalReserved: Iterable<string>[]) {
    this.reserved = new Set([
      ...RESERVED_IDENTIFIERS,
      ...additionalReserved.flatMap((s) => [...s])
    ]);
  }
}

// Usage is cleaner
const nameGen = new NameGenerator(keptNames);
const nameGen = new NameGenerator(globalRenames.values(), keptNames);

// Avoid: Repeated spread patterns
const nameGen = new NameGenerator(new Set([...RESERVED_IDENTIFIERS, ...keptNames]));
```

### Type Aliases for Complex Types

```typescript
// Good: Named type alias
type LuaState = ReturnType<typeof lauxlib.luaL_newstate>;

function getStringField(L: LuaState, field: string): string { ... }

// Avoid: Repeated inline types
function getStringField(L: ReturnType<typeof lauxlib.luaL_newstate>, field: string): string { ... }
```

### Pre-compile Regex Outside Loops

```typescript
// Good: Compile once
const UPPERCASE_CONST_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const isUserGlobal = (name: string): boolean =>
  UPPERCASE_CONST_PATTERN.test(name);

// Avoid: Compile in every call
function isUserGlobal(name: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
}
```

## Code Organization

### Section Comments

Use clear section separators for major code sections:

```typescript
// =============================================================================
// Constants
// =============================================================================

const MAX_ACTION_LENGTH = 909;

// =============================================================================
// Types
// =============================================================================

interface ConfigFile { ... }
```

### JSDoc for Exports

Document exported functions with JSDoc:

```typescript
/**
 * Load and parse a Lua configuration file using fengari.
 * @param filePath - Path to the .lua config file
 * @returns Parsed configuration ready for upload
 */
export async function loadLuaConfig(filePath: string): Promise<ConfigFile> { ... }
```

### Group Related Functions

Keep related functions close together:

```typescript
// Validation helpers (grouped)
export function validateActionLength(...) { ... }
export function validatePage(...) { ... }
export function parseEventType(...) { ... }

// Iteration helpers (grouped)
export function forEachEvent(...) { ... }
export function mapEvents(...) { ... }
```

## Error Handling

### Consistent Error Strategy

Choose one approach per module:
- Throw for unrecoverable errors
- Return `null` for expected failures (e.g., parsing optional content)

```typescript
// Throws - caller must handle
function executeLua(L: LuaState, code: string, context: string): void {
  const result = lauxlib.luaL_dostring(L, fengari.to_luastring(code));
  if (result !== lua.LUA_OK) {
    throw new Error(`${context}: ${lua.lua_tojsstring(L, -1)}`);
  }
}

// Returns null - graceful fallback
function serializeLuaValue(L: LuaState, index: number): string | null {
  // ... returns null if value can't be serialized
}
```

### Safe Error Extraction

```typescript
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

## Testing

### Test File Naming

- `lib.test.ts` for `lib.ts`
- `lua-loader.test.ts` for `lua-loader.ts`

### Test Organization

Group related tests with `describe`:

```typescript
describe("validateActionLength", () => {
  it("should accept scripts within limit", () => { ... });
  it("should reject scripts exceeding limit", () => { ... });
  it("should include helpful error message", () => { ... });
});
```

## Formatting

Configured via `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 120
}
```

Run formatting: `npm run format`

## Linting

Configured via `eslint.config.js`:
- TypeScript recommended rules
- Unused vars allowed with `_` prefix
- Prettier integration for formatting conflicts

Run linting: `npm run lint`

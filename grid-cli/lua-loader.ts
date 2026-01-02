import * as fengari from "fengari";
import * as interop from "fengari-interop";
import * as fs from "fs";
import * as path from "path";
import * as luaparse from "luaparse";
import type { ConfigFile, EventConfig } from "./lib.js";
import { EVENT_NAMES, SYSTEM_ELEMENT, sortElements } from "./lib.js";

// Import grid protocol for Lua function names
const gridProtocol = await import("@intechstudio/grid-protocol");
const { grid } = gridProtocol;

const { lua, lauxlib, lualib } = fengari;

// Reverse lookup: event name -> event ID
const EVENT_IDS: Record<string, number> = Object.fromEntries(
  Object.entries(EVENT_NAMES).map(([id, name]) => [name, parseInt(id, 10)])
);

// =============================================================================
// AST-based function extraction
// =============================================================================

interface FunctionNode {
  startLine: number;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Parse Lua source and extract all function locations.
 */
function parseFunctions(source: string): FunctionNode[] {
  const functions: FunctionNode[] = [];

  try {
    const ast = luaparse.parse(source, { locations: true, ranges: true });
    collectFunctions(ast, functions);
  } catch {
    // Parse error - return empty, will fall back to line-based extraction
  }

  return functions;
}

/**
 * Recursively collect function nodes from AST.
 */
function collectFunctions(node: any, results: FunctionNode[]): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
    if (node.body?.length > 0 && node.loc && node.body[0].range && node.body[node.body.length - 1].range) {
      results.push({
        startLine: node.loc.start.line,
        bodyStart: node.body[0].range[0],
        bodyEnd: node.body[node.body.length - 1].range[1],
      });
    }
  }

  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child) => collectFunctions(child, results));
    } else if (typeof value === "object") {
      collectFunctions(value, results);
    }
  }
}

/**
 * Extract function body from source using AST ranges.
 */
function extractFunctionBody(source: string, startLine: number, functions: FunctionNode[]): string {
  // Find function starting at this line
  const fn = functions.find((f) => f.startLine === startLine);

  if (fn) {
    const body = source.slice(fn.bodyStart, fn.bodyEnd);
    return body.trim().replace(/\s+/g, " ");
  }

  // Fallback: shouldn't happen if AST parsing succeeded
  return "";
}

/**
 * Serialize a simple Lua value to a Lua literal string.
 * Only handles primitives and flat arrays of primitives (like color tables).
 */
function serializeLuaValue(L: any, index: number, allowTable = true): string | null {
  const type = lua.lua_type(L, index);
  const absIdx = index < 0 ? lua.lua_gettop(L) + index + 1 : index;

  switch (type) {
    case lua.LUA_TNIL:
      return "nil";
    case lua.LUA_TBOOLEAN:
      return lua.lua_toboolean(L, absIdx) ? "true" : "false";
    case lua.LUA_TNUMBER:
      return String(lua.lua_tonumber(L, absIdx));
    case lua.LUA_TSTRING:
      return `"${lua.lua_tojsstring(L, absIdx)}"`;
    case lua.LUA_TTABLE: {
      if (!allowTable) return null;

      // Get table length for array-style tables
      const len = lua.lua_rawlen(L, absIdx);
      if (len === 0 || len > 20) return null;

      // Serialize as array using rawgeti to preserve order
      const parts: string[] = [];
      for (let i = 1; i <= len; i++) {
        lua.lua_rawgeti(L, absIdx, i);
        const valType = lua.lua_type(L, -1);

        if (valType !== lua.LUA_TNUMBER && valType !== lua.LUA_TBOOLEAN && valType !== lua.LUA_TSTRING) {
          lua.lua_pop(L, 1);
          return null;
        }

        const val = serializeLuaValue(L, -1, false);
        lua.lua_pop(L, 1);

        if (val === null) return null;
        parts.push(val);
      }

      return `{${parts.join(",")}}`;
    }
    default:
      return null;
  }
}

/**
 * Get upvalues for a function and return as name->serialized value map.
 */
function getUpvalues(L: any, fnIndex: number): Map<string, string> {
  const upvalues = new Map<string, string>();

  // Normalize index to absolute
  const absIdx = fnIndex < 0 ? lua.lua_gettop(L) + fnIndex + 1 : fnIndex;

  let i = 1;
  while (true) {
    lua.lua_getglobal(L, fengari.to_luastring("debug"));
    lua.lua_getfield(L, -1, fengari.to_luastring("getupvalue"));
    lua.lua_pushvalue(L, absIdx);
    lua.lua_pushinteger(L, i);
    lua.lua_call(L, 2, 2);

    if (lua.lua_isnil(L, -2)) {
      lua.lua_pop(L, 3); // Pop nil, nil, debug table
      break;
    }

    const name = lua.lua_tojsstring(L, -2);
    const serialized = serializeLuaValue(L, -1);

    if (name && serialized !== null && name !== "_ENV") {
      upvalues.set(name, serialized);
    }

    lua.lua_pop(L, 3); // Pop name, value, debug table
    i++;
  }

  return upvalues;
}

/**
 * Replace upvalue references in function body with their values.
 */
function inlineUpvalues(body: string, upvalues: Map<string, string>): string {
  let result = body;

  for (const [name, value] of upvalues) {
    // Replace standalone identifier (not part of larger identifier or method call)
    // Match: word boundary + name + word boundary, but not followed by ( for function calls
    const pattern = new RegExp(`\\b${name}\\b(?!\\s*[\\(.:])`, "g");
    result = result.replace(pattern, value);
  }

  return result;
}

// System event names that can appear at top level (not init - use root globals instead)
const SYSTEM_EVENT_NAMES = ["utility", "timer"];

// =============================================================================
// Grid API Stub Generation
// =============================================================================

// Custom return values for functions that need specific stub behavior
const CUSTOM_STUBS: Record<string, string> = {
  // Functions returning numbers
  glr: "return 0",
  glg: "return 0",
  glb: "return 0",
  glag: "return 0",
  gpn: "return 0",
  gpp: "return 0",
  gpc: "return 0",
  gts: "return 0",
  gmx: "return 0",
  gmy: "return 0",
  gmr: "return 0",
  ghwcfg: "return 0",
  gvmaj: "return 0",
  gvmin: "return 0",
  gvpat: "return 0",
  gec: "return 16",
  grnd: "return 0",
  gsc: "return 0",
  // Functions returning strings
  gen: 'return ""',
  ggen: 'return ""',
  gfcat: 'return ""',
  gsg: 'return ""',
  // Functions returning tables
  gfls: "return {}",
  // Functions returning multiple values
  gpcg: "return 0,0,0",
  grcg: "return 0,0",
  // Functions with parameters that pass through
  gmaps: "return v",
  glim: "return v",
  sgn: "return v >= 0 and 1 or -1",
};

// Function types from grid-protocol that represent Lua API functions
const GRID_FUNCTION_TYPES = new Set(["global", "encoder", "button", "potmeter", "endless", "lcd"]);

/**
 * Iterate over grid-protocol Lua function definitions.
 * Calls callback for each function with its short and human names.
 */
function forEachGridFunction(callback: (shortName: string, humanName: string | undefined) => void): void {
  const luaProps = grid.getProperty("LUA") as Record<string, { short?: string; human?: string; type?: string }>;
  if (!luaProps) return;

  for (const key in luaProps) {
    const entry = luaProps[key];
    if (GRID_FUNCTION_TYPES.has(entry.type ?? "") && entry.short) {
      callback(entry.short, entry.human);
    }
  }
}

/**
 * Generate Lua API stubs from grid-protocol definitions.
 * Creates function stubs and human-readable aliases.
 */
function generateGridApiStubs(): string {
  const stubs: string[] = [];
  const aliases: string[] = [];

  forEachGridFunction((shortName, humanName) => {
    const customBody = CUSTOM_STUBS[shortName];

    // Generate function stub with custom return value if defined
    if (customBody?.includes("return v")) {
      stubs.push(`function ${shortName}(v) ${customBody} end`);
    } else if (customBody) {
      stubs.push(`function ${shortName}() ${customBody} end`);
    } else {
      stubs.push(`function ${shortName}() end`);
    }

    // Generate human-readable alias if available
    if (humanName && humanName !== shortName) {
      aliases.push(`${humanName} = ${shortName}`);
    }
  });

  if (stubs.length === 0) {
    return "-- No LUA properties found in grid-protocol\nfunction print() end";
  }

  return [
    "-- Grid API stubs (auto-generated from grid-protocol)",
    ...stubs,
    "",
    "-- Human-readable aliases",
    ...aliases,
    "",
    "-- Suppress print",
    "function print() end",
  ].join("\n");
}

// Cache the generated stubs at module load
const GRID_API_STUBS = generateGridApiStubs();

// Lua built-in globals (as Set for O(1) membership testing)
const LUA_BUILTINS = new Set([
  "_G",
  "_VERSION",
  "assert",
  "collectgarbage",
  "dofile",
  "error",
  "getmetatable",
  "ipairs",
  "load",
  "loadfile",
  "next",
  "pairs",
  "pcall",
  "print",
  "rawequal",
  "rawget",
  "rawlen",
  "rawset",
  "require",
  "select",
  "setmetatable",
  "tonumber",
  "tostring",
  "type",
  "warn",
  "xpcall",
  "coroutine",
  "debug",
  "io",
  "math",
  "os",
  "package",
  "string",
  "table",
  "utf8",
  "js",
]);

// Globals injected by the loader
const INJECTED_GLOBALS = ["grid", "__grid_config", "__get_func_info", "element"];

/**
 * Extract global names from GRID_API_STUBS.
 * Matches: `function name(` and `name = `
 */
function extractStubGlobals(stubs: string): string[] {
  const names: string[] = [];
  // Match function definitions: function name(
  for (const match of stubs.matchAll(/function\s+(\w+)\s*\(/g)) {
    names.push(match[1]);
  }
  // Match global assignments: name = (with any leading whitespace)
  for (const match of stubs.matchAll(/^\s*(\w+)\s*=/gm)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

/**
 * Extract Lua function names from @intechstudio/grid-protocol.
 * Returns both short (glr) and human (led_default_red) names.
 */
function extractProtocolFunctions(): string[] {
  const names: string[] = [];
  forEachGridFunction((shortName, humanName) => {
    names.push(shortName);
    if (humanName) names.push(humanName);
  });
  return names;
}

// Built-in globals to ignore when detecting new ones
const BUILTIN_GLOBALS = new Set([
  ...LUA_BUILTINS,
  ...INJECTED_GLOBALS,
  ...extractStubGlobals(GRID_API_STUBS),
  ...extractProtocolFunctions(),
]);

// Allowed callback names that can be defined at root level
const ALLOWED_CALLBACKS = new Set(["midirx_cb", "sysex_cb"]);

// =============================================================================
// Identifier renaming for minification
// =============================================================================

// Lua keywords that cannot be used as identifiers
const LUA_KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

// Reserved identifiers that should not be renamed
const RESERVED_IDENTIFIERS = new Set([
  "self", // Grid implicit self parameter
  "_ENV",
  "_G", // Lua environment
  "midirx_cb",
  "sysex_cb", // Grid callback function names (firmware expects these)
]);

/**
 * Generate short identifier names: a, b, ..., z, aa, ab, ..., az, ba, ...
 */
class NameGenerator {
  private index = 0;

  constructor(private reserved: Set<string>) {}

  next(): string {
    let name: string;
    do {
      name = this.indexToName(this.index++);
    } while (this.reserved.has(name) || LUA_KEYWORDS.has(name));
    this.reserved.add(name);
    return name;
  }

  private indexToName(i: number): string {
    let name = "";
    do {
      name = String.fromCharCode(97 + (i % 26)) + name;
      i = Math.floor(i / 26) - 1;
    } while (i >= 0);
    return name;
  }
}

interface IdentifierInfo {
  name: string;
  range: [number, number];
  isLocal: boolean;
  isDeclaration: boolean;
  scope: number;
}

/**
 * Collect all identifiers from Lua source with scope information.
 * Two-pass approach: first collect, then analyze scope.
 */
function collectIdentifiers(source: string): IdentifierInfo[] {
  // First pass: collect all identifiers and declarations
  const allIdentifiers: Array<{ name: string; range: [number, number]; scopeAtCreation: number }> = [];
  const declarations: Array<{ name: string; range: [number, number]; scope: number }> = [];
  let scopeDepth = 0;

  try {
    luaparse.parse(source, {
      locations: true,
      ranges: true,
      scope: true,
      onCreateScope: () => {
        scopeDepth++;
      },
      onDestroyScope: () => {
        scopeDepth--;
      },
      onLocalDeclaration: (name: string) => {
        // Mark this name as declared at current scope
        // We'll match it to identifier nodes by name and scope
        declarations.push({ name, range: [0, 0], scope: scopeDepth });
      },
      onCreateNode: (node: any) => {
        if (node.type === "Identifier" && node.range) {
          allIdentifiers.push({
            name: node.name,
            range: node.range,
            scopeAtCreation: scopeDepth,
          });
        }
      },
    });
  } catch {
    return [];
  }

  // Build declaration map: name -> [scopes where declared]
  const declaredAt = new Map<string, number[]>();
  for (const d of declarations) {
    const scopes = declaredAt.get(d.name) || [];
    scopes.push(d.scope);
    declaredAt.set(d.name, scopes);
  }

  // Second pass: determine which identifiers are local
  const identifiers: IdentifierInfo[] = [];
  const seenRanges = new Set<string>();
  const declCounts = new Map<string, number>(); // Track how many declarations we've seen per name

  for (const id of allIdentifiers) {
    const key = `${id.range[0]},${id.range[1]}`;
    if (seenRanges.has(key)) continue;
    seenRanges.add(key);

    const declScopes = declaredAt.get(id.name) || [];

    // Check if this is a declaration (first occurrence at a declaration scope)
    const declCount = declCounts.get(id.name) || 0;
    const isDeclaration = declCount < declScopes.length && declScopes[declCount] === id.scopeAtCreation;
    if (isDeclaration) {
      declCounts.set(id.name, declCount + 1);
    }

    // Check if name is local at this point (any declaration at or above current scope)
    const isLocal = declScopes.some((ds) => ds <= id.scopeAtCreation);

    identifiers.push({
      name: id.name,
      range: id.range,
      isLocal,
      isDeclaration,
      scope: id.scopeAtCreation,
    });
  }

  return identifiers;
}

/**
 * Check if an identifier should be renamed.
 */
function shouldRename(name: string): boolean {
  if (LUA_KEYWORDS.has(name)) return false;
  if (RESERVED_IDENTIFIERS.has(name)) return false;
  if (BUILTIN_GLOBALS.has(name)) return false;
  return true;
}

/**
 * Check if an identifier would benefit from renaming (is longer than minimal).
 * Single-letter identifiers are already minimal and should be kept as-is.
 */
function needsRenaming(name: string): boolean {
  return name.length > 1;
}

/**
 * Apply renames to source, replacing from end to preserve positions.
 */
function applyRenames(source: string, identifiers: IdentifierInfo[], renames: Map<string, string>): string {
  // Sort by position descending to replace from end
  const sorted = [...identifiers].sort((a, b) => b.range[0] - a.range[0]);

  let result = source;
  for (const id of sorted) {
    const newName = renames.get(id.name);
    if (newName && newName !== id.name) {
      result = result.slice(0, id.range[0]) + newName + result.slice(id.range[1]);
    }
  }

  return result;
}

/**
 * Rename identifiers in a single script.
 * @param source - Lua source code
 * @param globalRenames - Pre-defined renames for globals (consistent across scripts)
 * @returns Renamed source
 */
function renameScript(source: string, globalRenames: Map<string, string>): string {
  const identifiers = collectIdentifiers(source);
  if (identifiers.length === 0) return source;

  // Collect names that will be KEPT (not renamed) to avoid collisions
  const keptNames = new Set<string>();
  for (const id of identifiers) {
    // Keep single-letter names and names that shouldn't be renamed
    if (!shouldRename(id.name) || !needsRenaming(id.name)) {
      keptNames.add(id.name);
    }
  }

  // Build local renames (per-script)
  // Reserve: global rename targets, reserved identifiers, and kept names
  const localRenames = new Map<string, string>();
  const nameGen = new NameGenerator(new Set([...globalRenames.values(), ...RESERVED_IDENTIFIERS, ...keptNames]));

  // Find local declarations that need renaming
  for (const id of identifiers) {
    if (
      id.isLocal &&
      id.isDeclaration &&
      shouldRename(id.name) &&
      needsRenaming(id.name) &&
      !localRenames.has(id.name)
    ) {
      localRenames.set(id.name, nameGen.next());
    }
  }

  // Combine renames: locals override globals
  const allRenames = new Map([...globalRenames, ...localRenames]);

  // Filter identifiers to only those that should be renamed
  const toRename = identifiers.filter((id) => {
    if (!shouldRename(id.name)) return false;
    if (!needsRenaming(id.name)) return false;
    if (id.isLocal) return localRenames.has(id.name);
    return globalRenames.has(id.name);
  });

  return applyRenames(source, toRename, allRenames);
}

/**
 * Analyze identifiers across multiple scripts in a single pass.
 * Returns globals that need renaming and names that will be kept.
 */
function analyzeIdentifiers(scripts: string[]): { globals: Set<string>; keptNames: Set<string> } {
  const globals = new Set<string>();
  const keptNames = new Set<string>();

  for (const source of scripts) {
    for (const id of collectIdentifiers(source)) {
      if (!shouldRename(id.name) || !needsRenaming(id.name)) {
        keptNames.add(id.name);
      } else if (!id.isLocal) {
        globals.add(id.name);
      }
    }
  }

  return { globals, keptNames };
}

/**
 * Rename identifiers across multiple scripts with consistent global naming.
 * @param scripts - Array of Lua source strings
 * @returns Array of renamed sources
 */
export function renameIdentifiers(scripts: string[]): string[] {
  // Single pass: collect globals and kept names
  const { globals, keptNames } = analyzeIdentifiers(scripts);

  // Create consistent global renames, avoiding kept names
  const globalRenames = new Map<string, string>();
  const nameGen = new NameGenerator(new Set([...RESERVED_IDENTIFIERS, ...keptNames]));
  for (const name of globals) {
    globalRenames.set(name, nameGen.next());
  }

  // Second pass: rename each script
  return scripts.map((source) => renameScript(source, globalRenames));
}

/**
 * Check if a global name should be extracted.
 */
function isUserGlobal(name: string): boolean {
  if (BUILTIN_GLOBALS.has(name)) return false;
  // Uppercase constants (e.g., MIDI_NOTE, CH)
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true;
  // Allowed callbacks (e.g., midirx_cb)
  if (ALLOWED_CALLBACKS.has(name)) return true;
  return false;
}

/**
 * Extract new globals defined in the script by comparing before/after execution.
 */
function extractNewGlobals(L: any, source: string, functions: FunctionNode[]): Map<string, string> {
  const newGlobals = new Map<string, string>();

  // Iterate over _G to find new globals
  lua.lua_getglobal(L, fengari.to_luastring("_G"));
  lua.lua_pushnil(L);

  while (lua.lua_next(L, -2) !== 0) {
    if (lua.lua_isstring(L, -2)) {
      const name = lua.lua_tojsstring(L, -2);

      if (isUserGlobal(name)) {
        // Handle functions - extract body from source
        if (lua.lua_isfunction(L, -1)) {
          const body = extractFunction(L, source, -1, functions);
          if (body) {
            newGlobals.set(name, `function(self,event,header) ${body} end`);
          }
        } else {
          // Handle values - serialize directly
          const serialized = serializeLuaValue(L, -1);
          if (serialized !== null) {
            newGlobals.set(name, serialized);
          }
        }
      }
    }
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1); // Pop _G

  return newGlobals;
}

/**
 * Convert new globals map to Lua assignment string.
 */
function globalsToLua(globals: Map<string, string>): string {
  if (globals.size === 0) return "";

  const assignments: string[] = [];
  for (const [name, value] of globals) {
    assignments.push(`${name}=${value}`);
  }
  return assignments.join(" ");
}

/**
 * Extract a function's body with upvalue inlining.
 */
function extractFunction(L: any, source: string, fnStackIndex: number, functions: FunctionNode[]): string | null {
  // Convert to absolute index before any stack modifications
  const absIdx = fnStackIndex < 0 ? lua.lua_gettop(L) + fnStackIndex + 1 : fnStackIndex;

  const upvalues = getUpvalues(L, absIdx);

  lua.lua_getglobal(L, fengari.to_luastring("__get_func_info"));
  lua.lua_pushvalue(L, absIdx);
  lua.lua_call(L, 1, 1);

  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return null;
  }

  lua.lua_getfield(L, -1, fengari.to_luastring("linedefined"));
  const startLine = lua.lua_tointeger(L, -1);
  lua.lua_pop(L, 1);
  lua.lua_pop(L, 1); // Pop info table

  if (startLine <= 0) {
    return null;
  }

  let body = extractFunctionBody(source, startLine, functions);
  body = inlineUpvalues(body, upvalues);
  return body || null;
}

// =============================================================================
// Lua VM Helpers
// =============================================================================

// Lua state type alias for documentation
type LuaState = ReturnType<typeof lauxlib.luaL_newstate>;

/**
 * Get a string field from the table at the top of the stack.
 */
function getStringField(L: LuaState, field: string, defaultVal: string = ""): string {
  lua.lua_getfield(L, -1, fengari.to_luastring(field));
  const value = lua.lua_tojsstring(L, -1) || defaultVal;
  lua.lua_pop(L, 1);
  return value;
}

/**
 * Get an integer from array index in the table at the top of the stack.
 */
function getArrayInt(L: LuaState, index: number, defaultVal: number = 0): number {
  lua.lua_rawgeti(L, -1, index);
  const value = lua.lua_isnil(L, -1) ? defaultVal : lua.lua_tointeger(L, -1);
  lua.lua_pop(L, 1);
  return value;
}

const LUA_SETUP_CODE = `
  ${GRID_API_STUBS}

  -- Stub element array
  element = setmetatable({}, { __index = function() return {} end })

  -- Grid module
  local grid = {
    config = function(tbl)
      __grid_config = tbl
      return tbl
    end
  }

  -- Custom require
  local original_require = require
  function require(name)
    if name == "grid" then
      return grid
    end
    return original_require(name)
  end

  -- Helper to get function line info
  function __get_func_info(fn)
    local info = debug.getinfo(fn, "S")
    if info then
      return { linedefined = info.linedefined, lastlinedefined = info.lastlinedefined }
    end
    return nil
  end
`;

/**
 * Create and initialize a new Lua VM with standard libraries.
 */
function createLuaVM(): LuaState {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  interop.luaopen_js(L);
  return L;
}

/**
 * Execute Lua code and throw on error.
 */
function executeLua(L: LuaState, code: string, context: string): void {
  const result = lauxlib.luaL_dostring(L, fengari.to_luastring(code));
  if (result !== lua.LUA_OK) {
    const err = lua.lua_tojsstring(L, -1);
    throw new Error(`${context}: ${err}`);
  }
}

/**
 * Extract config metadata (name, type, version) from Lua config table.
 * Assumes config table is at top of stack.
 */
function extractMetadata(
  L: LuaState,
  filePath: string
): { name: string; type: string; version: { major: string; minor: string; patch: string } } {
  const name = getStringField(L, "name", path.basename(filePath, ".lua"));
  const type = getStringField(L, "type", "EN16");

  lua.lua_getfield(L, -1, fengari.to_luastring("version"));
  let version = { major: "1", minor: "0", patch: "0" };
  if (lua.lua_istable(L, -1)) {
    version.major = String(getArrayInt(L, 1, 1));
    version.minor = String(getArrayInt(L, 2, 0));
    version.patch = String(getArrayInt(L, 3, 0));
  }
  lua.lua_pop(L, 1);

  return { name, type, version };
}

/**
 * Extract system element events from root globals and top-level handlers.
 * Assumes config table is at top of stack.
 */
function extractSystemEvents(L: LuaState, source: string, functions: FunctionNode[]): EventConfig[] {
  const systemEvents: EventConfig[] = [];

  // Extract new globals defined at script root (becomes system init)
  const newGlobals = extractNewGlobals(L, source, functions);
  const rootGlobals = globalsToLua(newGlobals);

  if (rootGlobals) {
    systemEvents.push({ event: 0, config: rootGlobals });
  }

  // Extract top-level system event handlers (utility, timer)
  for (const eventName of SYSTEM_EVENT_NAMES) {
    lua.lua_getfield(L, -1, fengari.to_luastring(eventName));
    if (lua.lua_isfunction(L, -1)) {
      const eventId = EVENT_IDS[eventName];
      if (eventId !== undefined) {
        const body = extractFunction(L, source, -1, functions);
        if (body) {
          systemEvents.push({ event: eventId, config: body });
        }
      }
    }
    lua.lua_pop(L, 1);
  }

  return systemEvents;
}

/**
 * Extract element event handlers from config table.
 * Assumes config table is at top of stack.
 */
function extractElementConfigs(
  L: LuaState,
  source: string,
  functions: FunctionNode[]
): Array<{ controlElementNumber: number; events: EventConfig[] }> {
  const elements: Array<{ controlElementNumber: number; events: EventConfig[] }> = [];

  lua.lua_pushnil(L);
  while (lua.lua_next(L, -2) !== 0) {
    if (lua.lua_isnumber(L, -2) && lua.lua_istable(L, -1)) {
      const elementNum = lua.lua_tointeger(L, -2);

      // Skip system element (handled via extractSystemEvents)
      if (elementNum === SYSTEM_ELEMENT) {
        lua.lua_pop(L, 1);
        continue;
      }

      const events: EventConfig[] = [];

      lua.lua_pushnil(L);
      while (lua.lua_next(L, -2) !== 0) {
        if (lua.lua_isstring(L, -2) && lua.lua_isfunction(L, -1)) {
          const eventName = lua.lua_tojsstring(L, -2);
          const eventId = EVENT_IDS[eventName];

          if (eventId !== undefined) {
            const body = extractFunction(L, source, -1, functions);
            if (body) {
              events.push({ event: eventId, config: body });
            }
          }
        }
        lua.lua_pop(L, 1);
      }

      if (events.length > 0) {
        events.sort((a, b) => a.event - b.event);
        elements.push({ controlElementNumber: elementNum, events });
      }
    }
    lua.lua_pop(L, 1);
  }

  return elements;
}

// =============================================================================
// Main Config Loader
// =============================================================================

/**
 * Load and parse a Lua configuration file using fengari.
 */
export async function loadLuaConfig(filePath: string): Promise<ConfigFile> {
  const source = fs.readFileSync(filePath, "utf-8");
  const functions = parseFunctions(source);
  const L = createLuaVM();

  try {
    // Initialize environment and execute config
    executeLua(L, LUA_SETUP_CODE, "Setup failed");
    executeLua(L, source, "Config execution failed");

    // Get the config table
    lua.lua_getglobal(L, fengari.to_luastring("__grid_config"));
    if (lua.lua_isnil(L, -1)) {
      throw new Error("Config file must call grid.config()");
    }

    // Extract all components
    const { name, type, version } = extractMetadata(L, filePath);
    const systemEvents = extractSystemEvents(L, source, functions);
    const elements = extractElementConfigs(L, source, functions);

    // Build config object
    const config: ConfigFile = { name, type, version, configs: [] };

    // Add system element if we have system events
    if (systemEvents.length > 0) {
      systemEvents.sort((a, b) => a.event - b.event);
      config.configs.push({ controlElementNumber: SYSTEM_ELEMENT, events: systemEvents });
    }

    // Add element configs
    config.configs.push(...elements);

    // Sort elements (system element 255 last)
    config.configs = sortElements(config.configs);

    return config;
  } finally {
    lua.lua_close(L);
  }
}

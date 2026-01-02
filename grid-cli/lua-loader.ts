import * as fengari from "fengari";
import * as interop from "fengari-interop";
import * as fs from "fs";
import * as path from "path";
import * as luaparse from "luaparse";
import type { ConfigFile, EventConfig } from "./lib.js";
import { EVENT_NAMES } from "./lib.js";

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

        if (
          valType !== lua.LUA_TNUMBER &&
          valType !== lua.LUA_TBOOLEAN &&
          valType !== lua.LUA_TSTRING
        ) {
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

// Grid API stubs for script execution
const GRID_API_STUBS = `
  -- LED functions
  function glr() return 0 end  -- led_default_red
  function glg() return 0 end  -- led_default_green
  function glb() return 0 end  -- led_default_blue
  function glp() end           -- led_value
  function glt() end           -- led_timeout
  function gln() end           -- led_color_min
  function gld() end           -- led_color_mid
  function glx() end           -- led_color_max
  function glc() end           -- led_color
  function glf() end           -- led_animation_rate
  function gls() end           -- led_animation_type
  function glpfs() end         -- led_animation_phase_rate_type
  function glag() return 0 end -- led_address_get
  led_default_red = glr
  led_default_green = glg
  led_default_blue = glb
  led_value = glp
  led_timeout = glt
  led_color_min = gln
  led_color_mid = gld
  led_color_max = glx
  led_color = glc
  led_animation_rate = glf
  led_animation_type = gls
  led_animation_phase_rate_type = glpfs
  led_address_get = glag

  -- MIDI functions
  function gms() end           -- midi_send
  function gmss() end          -- midi_sysex_send
  midi_send = gms
  midi_sysex_send = gmss

  -- HID functions
  function gks() end           -- keyboard_send
  function gmms() end          -- mouse_move_send
  function gmbs() end          -- mouse_button_send
  function ggms() end          -- gamepad_move_send
  function ggbs() end          -- gamepad_button_send
  keyboard_send = gks
  mouse_move_send = gmms
  mouse_button_send = gmbs
  gamepad_move_send = ggms
  gamepad_button_send = ggbs

  -- Page functions
  function gpn() return 0 end  -- page_next
  function gpp() return 0 end  -- page_previous
  function gpc() return 0 end  -- page_current
  function gpl() end           -- page_load
  page_next = gpn
  page_previous = gpp
  page_current = gpc
  page_load = gpl

  -- Timer functions
  function gtt() end           -- timer_start
  function gtp() end           -- timer_stop
  function gts() return 0 end  -- timer_source
  timer_start = gtt
  timer_stop = gtp
  timer_source = gts

  -- Event functions
  function get() end           -- event_trigger
  event_trigger = get

  -- MIDI RX control
  function mre() end           -- midirx_enabled
  function mrs() end           -- midirx_sync
  midirx_enabled = mre
  midirx_sync = mrs

  -- Element name functions
  function gen() return "" end -- element_name
  function gsen() end          -- element_name_set
  function gens() end          -- element_name_send
  function ggen() return "" end -- element_name_get
  element_name = gen
  element_name_set = gsen
  element_name_send = gens
  element_name_get = ggen

  -- Communication functions
  function gwss() end          -- websocket_send
  function gps() end           -- package_send
  function gis() end           -- immediate_send
  websocket_send = gwss
  package_send = gps
  immediate_send = gis

  -- Module info functions
  function gmx() return 0 end  -- module_position_x
  function gmy() return 0 end  -- module_position_y
  function gmr() return 0 end  -- module_rotation
  function ghwcfg() return 0 end -- hardware_configuration
  function gvmaj() return 0 end -- version_major
  function gvmin() return 0 end -- version_minor
  function gvpat() return 0 end -- version_patch
  function gec() return 16 end -- element_count
  module_position_x = gmx
  module_position_y = gmy
  module_rotation = gmr
  hardware_configuration = ghwcfg
  version_major = gvmaj
  version_minor = gvmin
  version_patch = gvpat
  element_count = gec

  -- Filesystem functions
  function gfls() return {} end -- readdir
  function gfcat() return "" end -- readfile
  readdir = gfls
  readfile = gfcat

  -- Calibration functions
  function gcr() end           -- calibration_reset
  function gpcg() return 0,0,0 end -- potmeter_calibration_get
  function gpcs() end          -- potmeter_center_set
  function gpds() end          -- potmeter_detent_set
  function grcg() return 0,0 end -- range_calibration_get
  function grcs() end          -- range_calibration_set
  calibration_reset = gcr
  potmeter_calibration_get = gpcg
  potmeter_center_set = gpcs
  potmeter_detent_set = gpds
  range_calibration_get = grcg
  range_calibration_set = grcs

  -- Utility functions
  function grnd() return 0 end -- random8
  function gmaps(v) return v end -- map_saturate
  function glim(v) return v end -- limit
  function sgn(v) return v >= 0 and 1 or -1 end -- sign
  function gsc() return 0 end  -- segment_calculate
  function gsg() return "" end -- string_get
  random8 = grnd
  map_saturate = gmaps
  limit = glim
  sign = sgn
  segment_calculate = gsc
  string_get = gsg

  -- LCD/GUI functions
  function glsb() end          -- lcd_set_backlight
  function ggdsw() end         -- gui_draw_swap
  function ggdpx() end         -- gui_draw_pixel
  function ggdl() end          -- gui_draw_line
  function ggdr() end          -- gui_draw_rectangle
  function ggdrf() end         -- gui_draw_rectangle_filled
  function ggdrr() end         -- gui_draw_rectangle_rounded
  function ggdrrf() end        -- gui_draw_rectangle_rounded_filled
  function ggdpo() end         -- gui_draw_polygon
  function ggdpof() end        -- gui_draw_polygon_filled
  function ggdt() end          -- gui_draw_text
  function ggdft() end         -- gui_draw_fasttext
  function ggdaf() end         -- gui_draw_area_filled
  function ggdd() end          -- gui_draw_demo
  lcd_set_backlight = glsb
  gui_draw_swap = ggdsw
  gui_draw_pixel = ggdpx
  gui_draw_line = ggdl
  gui_draw_rectangle = ggdr
  gui_draw_rectangle_filled = ggdrf
  gui_draw_rectangle_rounded = ggdrr
  gui_draw_rectangle_rounded_filled = ggdrrf
  gui_draw_polygon = ggdpo
  gui_draw_polygon_filled = ggdpof
  gui_draw_text = ggdt
  gui_draw_fasttext = ggdft
  gui_draw_area_filled = ggdaf
  gui_draw_demo = ggdd

  -- Suppress print
  function print() end
`;

// Lua built-in globals
const LUA_BUILTINS = [
  "_G", "_VERSION", "assert", "collectgarbage", "dofile", "error", "getmetatable",
  "ipairs", "load", "loadfile", "next", "pairs", "pcall", "print", "rawequal",
  "rawget", "rawlen", "rawset", "require", "select", "setmetatable", "tonumber",
  "tostring", "type", "warn", "xpcall", "coroutine", "debug", "io", "math",
  "os", "package", "string", "table", "utf8", "js",
];

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
  // Match global assignments: name =
  for (const match of stubs.matchAll(/^  (\w+)\s*=/gm)) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Extract Lua function names from @intechstudio/grid-protocol.
 * Returns both short (glr) and human (led_default_red) names.
 */
function extractProtocolFunctions(): string[] {
  const names: string[] = [];
  const luaProps = grid.getProperty("LUA") as Record<string, { short?: string; human?: string; type?: string }>;
  if (!luaProps) return names;

  const functionTypes = ["global", "encoder", "button", "potmeter", "endless", "lcd"];
  for (const key in luaProps) {
    const entry = luaProps[key];
    if (functionTypes.includes(entry.type ?? "")) {
      if (entry.short) names.push(entry.short);
      if (entry.human) names.push(entry.human);
    }
  }
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
function extractFunction(
  L: any,
  source: string,
  fnStackIndex: number,
  functions: FunctionNode[]
): string | null {
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

/**
 * Load and parse a Lua configuration file using fengari.
 */
export async function loadLuaConfig(filePath: string): Promise<ConfigFile> {
  const source = fs.readFileSync(filePath, "utf-8");

  // Parse AST to get function locations
  const functions = parseFunctions(source);

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  interop.luaopen_js(L);

  try {
    // Set up the grid module, API stubs, and execute config
    const setupCode = `
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

    let result = lauxlib.luaL_dostring(L, fengari.to_luastring(setupCode));
    if (result !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(L, -1);
      throw new Error(`Setup failed: ${err}`);
    }

    // Execute the config file
    result = lauxlib.luaL_dostring(L, fengari.to_luastring(source));
    if (result !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(L, -1);
      throw new Error(`Config execution failed: ${err}`);
    }

    // Get the config table
    lua.lua_getglobal(L, fengari.to_luastring("__grid_config"));
    if (lua.lua_isnil(L, -1)) {
      throw new Error("Config file must call grid.config()");
    }

    // Extract config metadata
    lua.lua_getfield(L, -1, fengari.to_luastring("name"));
    const name = lua.lua_tojsstring(L, -1) || path.basename(filePath, ".lua");
    lua.lua_pop(L, 1);

    lua.lua_getfield(L, -1, fengari.to_luastring("type"));
    const type = lua.lua_tojsstring(L, -1) || "EN16";
    lua.lua_pop(L, 1);

    lua.lua_getfield(L, -1, fengari.to_luastring("version"));
    let version = { major: "1", minor: "0", patch: "0" };
    if (lua.lua_istable(L, -1)) {
      lua.lua_rawgeti(L, -1, 1);
      version.major = String(lua.lua_tointeger(L, -1) || 1);
      lua.lua_pop(L, 1);
      lua.lua_rawgeti(L, -1, 2);
      version.minor = String(lua.lua_tointeger(L, -1) || 0);
      lua.lua_pop(L, 1);
      lua.lua_rawgeti(L, -1, 3);
      version.patch = String(lua.lua_tointeger(L, -1) || 0);
      lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 1);

    const config: ConfigFile = {
      name,
      type,
      version,
      configs: [],
    };

    // Extract system element (255) from top-level handlers
    const systemEvents: EventConfig[] = [];

    // Extract new globals defined at script root (becomes system init)
    const newGlobals = extractNewGlobals(L, source, functions);
    const rootGlobals = globalsToLua(newGlobals);

    // Create system init from root globals
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

    // Add system element if we have any system events
    if (systemEvents.length > 0) {
      systemEvents.sort((a, b) => (a.event as number) - (b.event as number));
      config.configs.push({
        controlElementNumber: 255,
        events: systemEvents,
      });
    }

    // Iterate over numeric keys (regular elements)
    lua.lua_pushnil(L);
    while (lua.lua_next(L, -2) !== 0) {
      // Key is at -2, value is at -1
      if (lua.lua_isnumber(L, -2) && lua.lua_istable(L, -1)) {
        const elementNum = lua.lua_tointeger(L, -2);

        // Skip if this is element 255 (handled above via top-level)
        if (elementNum === 255) {
          lua.lua_pop(L, 1);
          continue;
        }

        const events: EventConfig[] = [];

        // Iterate over event handlers in this element
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
          lua.lua_pop(L, 1); // Pop value, keep key
        }

        if (events.length > 0) {
          events.sort((a, b) => (a.event as number) - (b.event as number));
          config.configs.push({
            controlElementNumber: elementNum,
            events,
          });
        }
      }
      lua.lua_pop(L, 1); // Pop value, keep key
    }

    // Sort elements (system element 255 last)
    config.configs.sort((a, b) => {
      if (a.controlElementNumber === 255) return 1;
      if (b.controlElementNumber === 255) return -1;
      return a.controlElementNumber - b.controlElementNumber;
    });

    return config;
  } finally {
    lua.lua_close(L);
  }
}

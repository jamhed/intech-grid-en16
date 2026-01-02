import * as fengari from "fengari";
import * as interop from "fengari-interop";
import * as fs from "fs";
import * as path from "path";
import type { ConfigFile, EventConfig } from "./lib.js";
import { EVENT_NAMES } from "./lib.js";

const { lua, lauxlib, lualib } = fengari;

// Reverse lookup: event name -> event ID
const EVENT_IDS: Record<string, number> = Object.fromEntries(
  Object.entries(EVENT_NAMES).map(([id, name]) => [name, parseInt(id, 10)])
);

/**
 * Extract function body from Lua source code given line range.
 */
function extractFunctionBody(source: string, startLine: number, endLine: number): string {
  const lines = source.split("\n");
  const fnLines = lines.slice(startLine - 1, endLine);

  let body = fnLines.join("\n");

  // Remove function declaration
  body = body.replace(/^\s*\w+\s*=\s*function\s*\([^)]*\)\s*/m, "");
  body = body.replace(/^\s*function\s*\([^)]*\)\s*/m, "");

  // Remove trailing end and comma
  body = body.replace(/\s*end\s*,?\s*$/, "");

  // Normalize whitespace
  return body.trim().replace(/\s+/g, " ");
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

/**
 * Load and parse a Lua configuration file using fengari.
 */
export async function loadLuaConfig(filePath: string): Promise<ConfigFile> {
  const source = fs.readFileSync(filePath, "utf-8");

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  interop.luaopen_js(L);

  try {
    // Set up the grid module and execute config
    const setupCode = `
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

    // Iterate over numeric keys (element indices)
    lua.lua_pushnil(L);
    while (lua.lua_next(L, -2) !== 0) {
      // Key is at -2, value is at -1
      if (lua.lua_isnumber(L, -2) && lua.lua_istable(L, -1)) {
        const elementNum = lua.lua_tointeger(L, -2);
        const events: EventConfig[] = [];

        // Iterate over event handlers in this element
        lua.lua_pushnil(L);
        while (lua.lua_next(L, -2) !== 0) {
          if (lua.lua_isstring(L, -2) && lua.lua_isfunction(L, -1)) {
            const eventName = lua.lua_tojsstring(L, -2);
            const eventId = EVENT_IDS[eventName];

            if (eventId !== undefined) {
              // Get upvalues for this function
              const upvalues = getUpvalues(L, -1);

              // Get function line info
              lua.lua_getglobal(L, fengari.to_luastring("__get_func_info"));
              lua.lua_pushvalue(L, -2); // Push the function
              lua.lua_call(L, 1, 1);

              if (lua.lua_istable(L, -1)) {
                lua.lua_getfield(L, -1, fengari.to_luastring("linedefined"));
                const startLine = lua.lua_tointeger(L, -1);
                lua.lua_pop(L, 1);

                lua.lua_getfield(L, -1, fengari.to_luastring("lastlinedefined"));
                const endLine = lua.lua_tointeger(L, -1);
                lua.lua_pop(L, 1);

                if (startLine > 0 && endLine > 0) {
                  let body = extractFunctionBody(source, startLine, endLine);
                  body = inlineUpvalues(body, upvalues);
                  if (body) {
                    events.push({ event: eventId, config: body });
                  }
                }
              }
              lua.lua_pop(L, 1); // Pop info table
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

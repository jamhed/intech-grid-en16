/**
 * Lua Runtime for Grid Config
 *
 * Executes Lua config files using wasmoon (Lua 5.4 via WASM).
 * Allows real Lua code with templates, functions, and string manipulation.
 */

import { LuaFactory, LuaEngine } from "wasmoon";
import luamin from "luamin";

// =============================================================================
// Types
// =============================================================================

interface JsonConfig {
  id?: string;
  name: string;
  type: string;
  version: { major: string; minor: string; patch: string };
  configType?: string;
  configs: Array<{
    controlElementNumber: number;
    events: Array<{ event: number; config: string }>;
  }>;
}

const EVENT_NAME_TO_ID: Record<string, number> = {
  init: 0,
  potmeter: 1,
  encoder: 2,
  button: 3,
  utility: 4,
  midirx: 5,
  timer: 6,
  endless: 7,
  draw: 8,
};

// =============================================================================
// Minification
// =============================================================================

function minifyScript(script: string): string {
  if (!script || script.trim() === "") return "";

  let s = script.trim();

  // Try to minify with luamin
  try {
    s = luamin.minify(s);
  } catch {
    // If minification fails, do basic compression
    s = s
      .replace(/--(?!\[\[@).*$/gm, "") // Remove comments (preserve --[[@cb]])
      .replace(/\s+/g, " ") // Collapse whitespace
      .replace(/\s*([=<>~+\-*\/%^#,;{}()\[\]])\s*/g, "$1") // Remove spaces around operators
      .trim();
  }

  // Add callback marker if not present
  if (!s.startsWith("--[[@cb]]")) {
    s = "--[[@cb]] " + s;
  }

  return s;
}

// =============================================================================
// Grid Library (Lua source)
// =============================================================================

const GRID_LIB = `
local grid = {}

-- Source code passed from Node.js for function extraction
grid._source = ""
grid._source_lines = {}

function grid._set_source(src)
  grid._source = src
  grid._source_lines = {}
  for line in (src .. "\\n"):gmatch("([^\\n]*)\\n") do
    table.insert(grid._source_lines, line)
  end
end

-- Serialize a Lua value to source code
function grid._serialize(val)
  local t = type(val)
  if t == "nil" then
    return "nil"
  elseif t == "boolean" then
    return val and "true" or "false"
  elseif t == "number" then
    return tostring(val)
  elseif t == "string" then
    return string.format("%q", val)
  elseif t == "table" then
    local parts = {}
    local is_array = true
    local max_i = 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then
        is_array = false
        break
      end
      if k > max_i then max_i = k end
    end
    if is_array then
      for i = 1, max_i do
        parts[i] = grid._serialize(val[i])
      end
      return "{" .. table.concat(parts, ", ") .. "}"
    else
      for k, v in pairs(val) do
        local key = type(k) == "string" and k:match("^[%a_][%w_]*$")
          and k or ("[" .. grid._serialize(k) .. "]")
        table.insert(parts, key .. " = " .. grid._serialize(v))
      end
      return "{" .. table.concat(parts, ", ") .. "}"
    end
  end
  return "nil"
end

-- Get upvalues from a function
function grid._get_upvalues(fn)
  local upvalues = {}
  local i = 1
  while true do
    local name, val = debug.getupvalue(fn, i)
    if not name then break end
    if name ~= "_ENV" and type(val) ~= "function" then
      upvalues[name] = val
    end
    i = i + 1
  end
  return upvalues
end

-- Extract function body from source using debug info
function grid._extract_function(fn)
  local info = debug.getinfo(fn, "S")
  if not info or info.what ~= "Lua" then
    return nil
  end

  local first = info.linedefined
  local last = info.lastlinedefined

  if first <= 0 or last <= 0 or first > #grid._source_lines then
    return nil
  end

  -- Extract lines
  local lines = {}
  for i = first, math.min(last, #grid._source_lines) do
    table.insert(lines, grid._source_lines[i])
  end
  local code = table.concat(lines, "\\n")

  -- Remove function wrapper patterns:
  -- "name = function(...) ... end," or "function name(...) ... end"
  local body

  -- Pattern 1: key = function(params) body end,
  body = code:match("^%s*[%w_]+%s*=%s*function%s*%([^)]*%)(.-)end%s*,?%s*$")
  if body then
    body = body:match("^%s*(.-)%s*$")
  end

  -- Pattern 2: function(params) body end
  if not body then
    body = code:match("^%s*function%s*%([^)]*%)(.-)end%s*,?%s*$")
    if body then
      body = body:match("^%s*(.-)%s*$")
    end
  end

  -- Pattern 3: function name(params) body end
  if not body then
    body = code:match("^%s*function%s+[%w_]+%s*%([^)]*%)(.-)end%s*,?%s*$")
    if body then
      body = body:match("^%s*(.-)%s*$")
    end
  end

  if not body then
    body = code
  end

  -- Substitute upvalues (closed-over variables from template functions)
  local upvalues = grid._get_upvalues(fn)
  for name, val in pairs(upvalues) do
    -- Replace whole-word occurrences of the variable with its serialized value
    body = body:gsub("([^%w_])" .. name .. "([^%w_])", "%1" .. grid._serialize(val) .. "%2")
    body = body:gsub("^" .. name .. "([^%w_])", grid._serialize(val) .. "%1")
    body = body:gsub("([^%w_])" .. name .. "$", "%1" .. grid._serialize(val))
    body = body:gsub("^" .. name .. "$", grid._serialize(val))
  end

  return body
end

-- Process config table, converting functions to source strings
function grid.compile(config)
  local function process(tbl)
    local result = {}
    for k, v in pairs(tbl) do
      if type(v) == "function" then
        local src = grid._extract_function(v)
        if src then
          result[k] = src
        else
          error("Failed to extract source for function at key: " .. tostring(k))
        end
      elseif type(v) == "table" then
        result[k] = process(v)
      else
        result[k] = v
      end
    end
    return result
  end
  return process(config)
end

-- Format color table as nested Lua table string: {{r, g, b, a}}
function grid.color(c)
  if type(c) == "table" then
    return string.format("{{%s, %s, %s, %s}}", c[1] or 0, c[2] or 0, c[3] or 0, c[4] or 1)
  end
  return tostring(c)
end

-- Alias for string.format
grid.fmt = string.format

-- Spread elements across a range
function grid.spread(from, to, template_fn, ...)
  local result = {}
  for i = from, to do
    result[i] = template_fn(i, ...)
  end
  return result
end

-- Merge multiple element tables
function grid.merge(...)
  local result = {}
  for _, t in ipairs({...}) do
    if type(t) == "table" then
      for k, v in pairs(t) do
        result[k] = v
      end
    end
  end
  return result
end

-- Config builder (just returns the table, for cleaner syntax)
function grid.config(tbl)
  return tbl
end

return grid
`;

// =============================================================================
// Lua Execution
// =============================================================================

let luaEngine: LuaEngine | null = null;

async function getLuaEngine(): Promise<LuaEngine> {
  if (!luaEngine) {
    const factory = new LuaFactory();
    luaEngine = await factory.createEngine();

    // Preload grid library
    await luaEngine.doString(`
      package.preload["grid"] = function()
        ${GRID_LIB}
      end
    `);
  }
  return luaEngine;
}

export async function executeLuaConfig(luaSource: string): Promise<JsonConfig> {
  const lua = await getLuaEngine();

  // Pass source code to Lua for function extraction
  const escapedSource = luaSource
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
  await lua.doString(`require("grid")._set_source("${escapedSource}")`);

  // Load user config as a chunk (preserves line numbers), execute, then compile
  // All happens in Lua to avoid JS<->Lua function marshalling issues
  const loaderCode = `
    local chunk, err = load([=[${luaSource.replace(/\]=\]/g, "]=] .. ']=' .. [=[")}]=], "@config", "t")
    if not chunk then error("Failed to load config: " .. tostring(err)) end
    local raw_config = chunk()
    return require("grid").compile(raw_config)
  `;

  const result = await lua.doString(loaderCode);

  if (!result || typeof result !== "object") {
    throw new Error("Config must return a table");
  }

  // Build JSON config
  const config: JsonConfig = {
    id: crypto.randomUUID(),
    name: String(result.name || "Untitled"),
    type: String(result.type || "EN16"),
    version: {
      // wasmoon converts Lua arrays to 0-indexed JS arrays
      major: String(result.version?.[0] ?? 1),
      minor: String(result.version?.[1] ?? 0),
      patch: String(result.version?.[2] ?? 0),
    },
    configType: "profile",
    configs: [],
  };

  // Process elements (numeric keys)
  for (const key of Object.keys(result)) {
    const elementNum = parseInt(key, 10);
    if (isNaN(elementNum)) continue;

    const element = result[key];
    if (!element || typeof element !== "object") continue;

    const events: Array<{ event: number; config: string }> = [];

    for (const [eventName, script] of Object.entries(element)) {
      const eventId = EVENT_NAME_TO_ID[eventName];
      if (eventId !== undefined && typeof script === "string" && script.trim()) {
        events.push({
          event: eventId,
          config: minifyScript(script),
        });
      }
    }

    events.sort((a, b) => a.event - b.event);

    if (events.length > 0) {
      config.configs.push({
        controlElementNumber: elementNum,
        events,
      });
    }
  }

  // Sort elements (system element 255 last)
  config.configs.sort((a, b) => {
    if (a.controlElementNumber === 255) return 1;
    if (b.controlElementNumber === 255) return -1;
    return a.controlElementNumber - b.controlElementNumber;
  });

  return config;
}

export function closeLuaEngine(): void {
  if (luaEngine) {
    luaEngine.global.close();
    luaEngine = null;
  }
}

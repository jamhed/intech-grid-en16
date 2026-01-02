import { describe, it, expect } from "vitest";
import { loadLuaConfig } from "./lua-loader.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper to create a temp Lua file for testing
function createTempLuaFile(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `test-${Date.now()}.lua`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("loadLuaConfig", () => {
  describe("basic parsing", () => {
    it("parses minimal config", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 2, 3},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.name).toBe("Test");
      expect(config.type).toBe("EN16");
      expect(config.version).toEqual({ major: "1", minor: "2", patch: "3" });
      expect(config.configs).toEqual([]);

      fs.unlinkSync(file);
    });

    it("extracts element with init event", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              self:led_color(1, {{0, 0, 255, 1}})
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs).toHaveLength(1);
      expect(config.configs[0].controlElementNumber).toBe(0);
      expect(config.configs[0].events).toHaveLength(1);
      expect(config.configs[0].events[0].event).toBe(0); // init = 0
      expect(config.configs[0].events[0].config).toContain("led_color");

      fs.unlinkSync(file);
    });

    it("extracts multiple events per element", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              self:led_color(1, {{255, 0, 0, 1}})
            end,
            encoder = function(self)
              local val = self:encoder_value()
            end,
            button = function(self)
              local val = self:button_value()
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs[0].events).toHaveLength(3);

      // Events should be sorted by ID
      const eventIds = config.configs[0].events.map(e => e.event);
      expect(eventIds).toEqual([0, 2, 3]); // init=0, encoder=2, button=3

      fs.unlinkSync(file);
    });

    it("extracts multiple elements", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self) print("el0") end,
          },
          [1] = {
            init = function(self) print("el1") end,
          },
          [255] = {
            init = function(self) print("sys") end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs).toHaveLength(3);

      // Elements should be sorted with 255 last
      const elements = config.configs.map(c => c.controlElementNumber);
      expect(elements).toEqual([0, 1, 255]);

      fs.unlinkSync(file);
    });
  });

  describe("upvalue inlining", () => {
    it("inlines simple number upvalues", async () => {
      const lua = `
        local grid = require("grid")
        local OFFSET = 32
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            encoder = function(self)
              local cc = OFFSET + self:element_index()
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs[0].events[0].config).toContain("32");
      expect(config.configs[0].events[0].config).not.toContain("OFFSET");

      fs.unlinkSync(file);
    });

    it("inlines boolean upvalues", async () => {
      const lua = `
        local grid = require("grid")
        local ENABLED = true
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              if ENABLED then print("yes") end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs[0].events[0].config).toContain("true");
      expect(config.configs[0].events[0].config).not.toContain("ENABLED");

      fs.unlinkSync(file);
    });

    it("inlines color table upvalues", async () => {
      const lua = `
        local grid = require("grid")
        local BLUE = {0, 0, 255, 1}
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              self:led_color(1, {BLUE})
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs[0].events[0].config).toContain("{0,0,255,1}");
      expect(config.configs[0].events[0].config).not.toContain("BLUE");

      fs.unlinkSync(file);
    });

    it("inlines upvalues from factory function", async () => {
      const lua = `
        local grid = require("grid")
        local BLUE = {0, 0, 255, 1}

        local function encoder(clr)
          return {
            init = function(self)
              self:led_color(1, {clr})
            end,
          }
        end

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = encoder(BLUE),
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      // The 'clr' upvalue should be inlined with the actual BLUE value
      expect(config.configs[0].events[0].config).toContain("{0,0,255,1}");
      expect(config.configs[0].events[0].config).not.toContain("clr");

      fs.unlinkSync(file);
    });
  });

  describe("function body extraction", () => {
    it("extracts single-line function body", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            timer = function(self) midi_send(0, 144, 64, 127) end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs[0].events[0].config).toBe("midi_send(0, 144, 64, 127)");

      fs.unlinkSync(file);
    });

    it("extracts multi-line function body", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            button = function(self)
              local note = 32 + self:element_index()
              local val = self:button_value()
              midi_send(0, 144, note, val)
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("local note = 32");
      expect(body).toContain("local val = self:button_value()");
      expect(body).toContain("midi_send");

      fs.unlinkSync(file);
    });

    it("handles if statements in function body", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            button = function(self)
              if self:button_state() == 0 then
                print("released")
              end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("if self:button_state() == 0 then");
      expect(body).toContain("print");

      fs.unlinkSync(file);
    });
  });

  describe("JSON format compatibility", () => {
    it("produces valid ConfigFile structure", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test Config",
          type = "EN16",
          version = {1, 5, 0},
          [0] = {
            init = function(self)
              self:led_color(1, {{0, 0, 255, 1}})
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      // Verify structure matches ConfigFile interface
      expect(config).toHaveProperty("name");
      expect(config).toHaveProperty("type");
      expect(config).toHaveProperty("version");
      expect(config).toHaveProperty("configs");

      expect(config.version).toHaveProperty("major");
      expect(config.version).toHaveProperty("minor");
      expect(config.version).toHaveProperty("patch");

      expect(Array.isArray(config.configs)).toBe(true);
      expect(config.configs[0]).toHaveProperty("controlElementNumber");
      expect(config.configs[0]).toHaveProperty("events");
      expect(config.configs[0].events[0]).toHaveProperty("event");
      expect(config.configs[0].events[0]).toHaveProperty("config");

      fs.unlinkSync(file);
    });

    it("version fields are strings", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {2, 3, 4},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(typeof config.version.major).toBe("string");
      expect(typeof config.version.minor).toBe("string");
      expect(typeof config.version.patch).toBe("string");
      expect(config.version).toEqual({ major: "2", minor: "3", patch: "4" });

      fs.unlinkSync(file);
    });

    it("event IDs are numbers", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self) print("init") end,
            encoder = function(self) print("enc") end,
            button = function(self) print("btn") end,
            timer = function(self) print("tmr") end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs).toHaveLength(1);
      expect(config.configs[0].events.length).toBeGreaterThan(0);

      for (const event of config.configs[0].events) {
        expect(typeof event.event).toBe("number");
      }

      fs.unlinkSync(file);
    });
  });

  describe("real config file", () => {
    it("loads EN16-Control.lua successfully", async () => {
      const configPath = path.join(__dirname, "../configs/EN16-Control.lua");

      if (!fs.existsSync(configPath)) {
        console.log("Skipping: EN16-Control.lua not found");
        return;
      }

      const config = await loadLuaConfig(configPath);

      expect(config.name).toBe("EN16 Control");
      expect(config.type).toBe("EN16");
      expect(config.configs.length).toBeGreaterThan(0);

      // Should have 17 elements (0-15 + 255)
      expect(config.configs).toHaveLength(17);

      // Check element 0 has expected events
      const el0 = config.configs.find(c => c.controlElementNumber === 0);
      expect(el0).toBeDefined();
      expect(el0!.events.length).toBeGreaterThanOrEqual(3); // init, encoder, button

      // Check system element 255 exists
      const sys = config.configs.find(c => c.controlElementNumber === 255);
      expect(sys).toBeDefined();

      // Check colors are inlined correctly
      const initEvent = el0!.events.find(e => e.event === 0);
      expect(initEvent!.config).toContain("{0,0,255,1}"); // BLUE
    });

    it("produces output compatible with JSON config format", async () => {
      const luaPath = path.join(__dirname, "../configs/EN16-Control.lua");

      if (!fs.existsSync(luaPath)) {
        console.log("Skipping: EN16-Control.lua not found");
        return;
      }

      const config = await loadLuaConfig(luaPath);

      // Serialize to JSON and parse back - should work without errors
      const json = JSON.stringify(config);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe(config.name);
      expect(parsed.type).toBe(config.type);
      expect(parsed.configs.length).toBe(config.configs.length);
    });
  });

  describe("error handling", () => {
    it("throws on syntax error", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test"
          -- missing comma causes syntax error
          type = "EN16"
        }
      `;
      const file = createTempLuaFile(lua);

      await expect(loadLuaConfig(file)).rejects.toThrow();

      fs.unlinkSync(file);
    });

    it("throws when grid.config not called", async () => {
      const lua = `
        local x = 1
      `;
      const file = createTempLuaFile(lua);

      await expect(loadLuaConfig(file)).rejects.toThrow(/grid\.config/);

      fs.unlinkSync(file);
    });
  });
});

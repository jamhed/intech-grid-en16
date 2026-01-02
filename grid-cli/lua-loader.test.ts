import { describe, it, expect } from "vitest";
import { loadLuaConfig, renameIdentifiers } from "./lua-loader.js";
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

        CH = 0

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          utility = function(self) page_load(page_next()) end,
          [0] = {
            init = function(self) print("el0") end,
          },
          [1] = {
            init = function(self) print("el1") end,
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

    it("extracts top-level system handlers as element 255", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          utility = function(self) page_load(page_next()) end,
          timer = function(self) midi_send(0, 144, 64, 127) end,
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      expect(config.configs).toHaveLength(1);
      expect(config.configs[0].controlElementNumber).toBe(255);
      expect(config.configs[0].events).toHaveLength(2);

      const eventIds = config.configs[0].events.map(e => e.event);
      expect(eventIds).toContain(4);  // utility
      expect(eventIds).toContain(6);  // timer

      fs.unlinkSync(file);
    });

    it("creates init from root globals", async () => {
      const lua = `
        local grid = require("grid")

        MIDI_NOTE = 144
        CH = 0

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const sys = config.configs.find(c => c.controlElementNumber === 255);
      expect(sys).toBeDefined();

      const initEvent = sys!.events.find(e => e.event === 0);
      expect(initEvent).toBeDefined();
      expect(initEvent!.config).toContain("MIDI_NOTE=144");
      expect(initEvent!.config).toContain("CH=0");

      fs.unlinkSync(file);
    });

    it("extracts root-level callbacks", async () => {
      const lua = `
        local grid = require("grid")

        function midirx_cb(self, event, header)
          local cmd = event[2]
        end

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const sys = config.configs.find(c => c.controlElementNumber === 255);
      expect(sys).toBeDefined();

      const initEvent = sys!.events.find(e => e.event === 0);
      expect(initEvent).toBeDefined();
      expect(initEvent!.config).toContain("midirx_cb=function");
      expect(initEvent!.config).toContain("event[2]");

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

  describe("AST-based extraction", () => {
    it("extracts named function declarations", async () => {
      const lua = `
        local grid = require("grid")

        function midirx_cb(self, event, header)
          local cmd = event[2]
          local val = event[4]
        end

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const sys = config.configs.find(c => c.controlElementNumber === 255);
      const initEvent = sys!.events.find(e => e.event === 0);

      // Body should contain the statements, not the function declaration
      expect(initEvent!.config).toContain("event[2]");
      expect(initEvent!.config).toContain("event[4]");
      expect(initEvent!.config).not.toContain("function midirx_cb");

      fs.unlinkSync(file);
    });

    it("handles nested if/elseif/else/end correctly", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            button = function(self)
              local val = self:button_value()
              if val > 100 then
                print("high")
              elseif val > 50 then
                print("mid")
              else
                print("low")
              end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("if val > 100 then");
      expect(body).toContain("elseif val > 50 then");
      expect(body).toContain("else");
      // Should not include trailing "end," from the function
      expect(body).not.toMatch(/end\s*,\s*$/);

      fs.unlinkSync(file);
    });

    it("handles nested for loops", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              for i = 1, 10 do
                print(i)
              end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("for i = 1, 10 do");
      expect(body).toContain("print(i)");

      fs.unlinkSync(file);
    });

    it("handles while loops", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              local x = 0
              while x < 10 do
                x = x + 1
              end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("while x < 10 do");
      expect(body).toContain("x = x + 1");

      fs.unlinkSync(file);
    });

    it("handles multiple nested control structures", async () => {
      const lua = `
        local grid = require("grid")

        function midirx_cb(self, event, header)
          if header[1] ~= 13 then return end
          local cmd, el, val = event[2], event[3] - 32, event[4]
          local on = val == 127
          local elm = element[el >= 16 and el - 16 or el]
          if cmd == 144 and el >= 16 then
            elm:led_color(1, {on and {255, 0, 0, 1} or {0, 0, 255, 1}})
          elseif cmd == 144 then
            elm:led_value(1, on and 100 or 0)
          elseif cmd == 176 and el < 16 then
            elm:encoder_value(val)
          end
        end

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const sys = config.configs.find(c => c.controlElementNumber === 255);
      const initEvent = sys!.events.find(e => e.event === 0);

      expect(initEvent!.config).toContain("header[1] ~= 13");
      expect(initEvent!.config).toContain("cmd == 144 and el >= 16");
      expect(initEvent!.config).toContain("led_color");

      fs.unlinkSync(file);
    });

    it("handles functions with local function definitions", async () => {
      const lua = `
        local grid = require("grid")

        local function helper(x)
          return x * 2
        end

        local function encoder(color)
          return {
            init = function(self)
              self:led_color(1, {color})
            end,
            encoder = function(self)
              local val = helper(self:encoder_value())
              midi_send(0, 176, 32, val)
            end,
          }
        end

        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = encoder({255, 0, 0, 1}),
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const el0 = config.configs.find(c => c.controlElementNumber === 0);
      expect(el0).toBeDefined();
      expect(el0!.events.length).toBe(2);

      // Check init has color inlined
      const initEvent = el0!.events.find(e => e.event === 0);
      expect(initEvent!.config).toContain("{255,0,0,1}");

      // Check encoder event exists
      const encoderEvent = el0!.events.find(e => e.event === 2);
      expect(encoderEvent!.config).toContain("midi_send");

      fs.unlinkSync(file);
    });

    it("handles empty function bodies gracefully", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          utility = function(self) end,
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      // Empty function should not create an event or should have empty config
      const sys = config.configs.find(c => c.controlElementNumber === 255);
      if (sys) {
        const utilityEvent = sys.events.find(e => e.event === 4);
        // Either no event or empty config is acceptable
        if (utilityEvent) {
          expect(utilityEvent.config).toBe("");
        }
      }

      fs.unlinkSync(file);
    });

    it("handles functions with string literals containing 'end'", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              local msg = "the end is near"
              print(msg)
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain('"the end is near"');
      expect(body).toContain("print(msg)");

      fs.unlinkSync(file);
    });

    it("handles deeply nested structures", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            button = function(self)
              if self:button_state() == 1 then
                for i = 1, 3 do
                  if i == 2 then
                    while true do
                      break
                    end
                  end
                end
              end
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("if self:button_state() == 1 then");
      expect(body).toContain("for i = 1, 3 do");
      expect(body).toContain("while true do");
      expect(body).toContain("break");

      fs.unlinkSync(file);
    });

    it("preserves function call chains", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              self:led_color(1, {{0, 0, 255, 1}}):led_value(1, 100)
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("led_color(1, {{0, 0, 255, 1}}):led_value(1, 100)");

      fs.unlinkSync(file);
    });

    it("handles repeat-until loops", async () => {
      const lua = `
        local grid = require("grid")
        return grid.config {
          name = "Test",
          type = "EN16",
          version = {1, 0, 0},
          [0] = {
            init = function(self)
              local x = 0
              repeat
                x = x + 1
              until x >= 10
            end,
          },
        }
      `;
      const file = createTempLuaFile(lua);
      const config = await loadLuaConfig(file);

      const body = config.configs[0].events[0].config;
      expect(body).toContain("repeat");
      expect(body).toContain("until x >= 10");

      fs.unlinkSync(file);
    });
  });
});

describe("renameIdentifiers", () => {
  describe("local variable renaming", () => {
    it("renames local variables to short names", () => {
      const scripts = ["local myVariable = 10\nprint(myVariable)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("myVariable");
      expect(result[0]).toMatch(/local \w+ = 10/);
    });

    it("renames multiple locals in same script", () => {
      const scripts = ["local foo = 1\nlocal bar = 2\nprint(foo + bar)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("foo");
      expect(result[0]).not.toContain("bar");
      // Should have two different short names
      expect(result[0]).toMatch(/local (\w+) = 1\nlocal (\w+) = 2/);
    });

    it("consistently renames variable across usages", () => {
      const scripts = ["local count = 0\ncount = count + 1\nprint(count)"];
      const result = renameIdentifiers(scripts);

      // Extract the renamed variable
      const match = result[0].match(/local (\w+) = 0/);
      expect(match).toBeTruthy();
      const renamed = match![1];

      // Same name should be used in all places
      expect(result[0]).toContain(`${renamed} = ${renamed} + 1`);
      expect(result[0]).toContain(`print(${renamed})`);
    });
  });

  describe("global variable renaming", () => {
    it("renames user-defined globals", () => {
      const scripts = ["MY_CONSTANT = 42\nprint(MY_CONSTANT)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("MY_CONSTANT");
      expect(result[0]).toMatch(/\w+ = 42/);
    });

    it("uses consistent names for globals across scripts", () => {
      const scripts = [
        "SHARED = 1",
        "print(SHARED)",
        "SHARED = SHARED + 1",
      ];
      const result = renameIdentifiers(scripts);

      // Find what SHARED was renamed to in first script
      const match = result[0].match(/^(\w+) = 1$/);
      expect(match).toBeTruthy();
      const renamed = match![1];

      // Same name should be used in all scripts
      expect(result[1]).toBe(`print(${renamed})`);
      expect(result[2]).toBe(`${renamed} = ${renamed} + 1`);
    });

    it("assigns different names to different globals", () => {
      const scripts = ["FOO = 1\nBAR = 2"];
      const result = renameIdentifiers(scripts);

      // Should have two different short names
      const match = result[0].match(/(\w+) = 1\n(\w+) = 2/);
      expect(match).toBeTruthy();
      expect(match![1]).not.toBe(match![2]);
    });
  });

  describe("reserved identifiers", () => {
    it("does not rename 'self'", () => {
      const scripts = ["self:led_color(1, {{0, 0, 255, 1}})"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toContain("self:");
    });

    it("renames 'event' parameter", () => {
      const scripts = ["local cmd = event[2]"];
      const result = renameIdentifiers(scripts);

      // 'event' is a function parameter, can be renamed
      expect(result[0]).not.toContain("event");
    });

    it("renames 'header' parameter", () => {
      const scripts = ["if header[1] == 13 then end"];
      const result = renameIdentifiers(scripts);

      // 'header' is a function parameter, can be renamed
      expect(result[0]).not.toContain("header");
    });

    it("does not rename 'midirx_cb' callback", () => {
      const scripts = ["function midirx_cb(self, event, header) local cmd = event[2] end"];
      const result = renameIdentifiers(scripts);

      // Callback name must be preserved (firmware looks for this name)
      expect(result[0]).toContain("midirx_cb");
    });

    it("does not rename 'sysex_cb' callback", () => {
      const scripts = ["function sysex_cb(self, data) print(data) end"];
      const result = renameIdentifiers(scripts);

      // Callback name must be preserved (firmware looks for this name)
      expect(result[0]).toContain("sysex_cb");
    });
  });

  describe("builtin globals", () => {
    it("does not rename midi_send", () => {
      const scripts = ["midi_send(0, 144, 60, 127)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toBe("midi_send(0, 144, 60, 127)");
    });

    it("does not rename led_color", () => {
      const scripts = ["led_color(1, {{255, 0, 0, 1}})"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toBe("led_color(1, {{255, 0, 0, 1}})");
    });

    it("does not rename element", () => {
      const scripts = ["element[0]:led_value(1, 100)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toContain("element[0]");
    });

    it("does not rename page_current", () => {
      const scripts = ["local ch = page_current()"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toContain("page_current()");
    });

    it("does not rename print", () => {
      const scripts = ["print('hello')"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toBe("print('hello')");
    });
  });

  describe("Lua keywords", () => {
    it("does not use keywords as renamed identifiers", () => {
      // Create enough variables to potentially hit keywords
      const vars = Array.from({ length: 30 }, (_, i) => `var${i}`);
      const script = vars.map((v) => `local ${v} = ${vars.indexOf(v)}`).join("\n");
      const result = renameIdentifiers([script]);

      // Keywords that could conflict with a-z naming
      const keywords = ["do", "if", "in", "or", "and", "end", "for", "nil", "not"];
      for (const kw of keywords) {
        // Should not have a keyword used as variable name
        expect(result[0]).not.toMatch(new RegExp(`local ${kw} =`));
      }
    });
  });

  describe("function renaming", () => {
    it("renames user-defined functions", () => {
      const scripts = ["function myFunc() return 1 end\nmyFunc()"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("myFunc");
      expect(result[0]).toMatch(/function \w+\(\)/);
    });

    it("renames local functions", () => {
      const scripts = ["local function helper(x) return x * 2 end\nhelper(5)"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("helper");
    });

    it("renames function parameters", () => {
      const scripts = ["local function add(first, second) return first + second end"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("first");
      expect(result[0]).not.toContain("second");
    });
  });

  describe("mixed scopes", () => {
    it("handles local shadowing global", () => {
      const scripts = [
        "GLOBAL = 1",
        "local GLOBAL = 2\nprint(GLOBAL)",
      ];
      const result = renameIdentifiers(scripts);

      // Global should be renamed consistently in first script
      const globalMatch = result[0].match(/^(\w+) = 1$/);
      expect(globalMatch).toBeTruthy();
      const globalName = globalMatch![1];

      // Local in second script should get different name
      // (or same if shadowing is handled by treating as new local)
      expect(result[1]).not.toContain("GLOBAL");
    });

    it("handles nested scopes correctly", () => {
      const scripts = [
        `local outer = 1
do
  local inner = 2
  print(outer, inner)
end
print(outer)`,
      ];
      const result = renameIdentifiers(scripts);

      expect(result[0]).not.toContain("outer");
      expect(result[0]).not.toContain("inner");
    });
  });

  describe("collision avoidance", () => {
    it("does not clash with existing short variable names", () => {
      const scripts = ["local a = 1\nlocal myLongVar = 2\nprint(a + myLongVar)"];
      const result = renameIdentifiers(scripts);

      // 'a' should stay as 'a' (not renamed to something else)
      // 'myLongVar' should be renamed to 'b' (not 'a', which would clash)
      expect(result[0]).toContain("local a = 1");
      expect(result[0]).not.toContain("myLongVar");

      // Count occurrences of 'a' - should only appear where original 'a' was
      const aMatches = result[0].match(/\ba\b/g);
      expect(aMatches?.length).toBe(2); // declaration and usage in print
    });

    it("does not clash with existing globals", () => {
      const scripts = [
        "a = 1\nMY_GLOBAL = 2",
        "print(a + MY_GLOBAL)",
      ];
      const result = renameIdentifiers(scripts);

      // 'a' should stay as 'a'
      expect(result[0]).toContain("a = 1");
      // MY_GLOBAL should be renamed to 'b' (not 'a')
      expect(result[0]).not.toContain("MY_GLOBAL");

      // Both scripts should use consistent naming
      const globalMatch = result[0].match(/a = 1\n(\w+) = 2/);
      expect(globalMatch).toBeTruthy();
      const renamedGlobal = globalMatch![1];
      expect(renamedGlobal).not.toBe("a");
      expect(result[1]).toContain(`a + ${renamedGlobal}`);
    });

    it("handles multiple short names already in use", () => {
      const scripts = ["local a, b, c = 1, 2, 3\nlocal longName = 4\nprint(a + b + c + longName)"];
      const result = renameIdentifiers(scripts);

      // a, b, c should remain
      expect(result[0]).toContain("local a, b, c = 1, 2, 3");
      // longName should become 'd' (first available)
      expect(result[0]).not.toContain("longName");
      expect(result[0]).toMatch(/local d = 4/);
    });

    it("does not swap names when long variable appears before short", () => {
      // This tests the order-independence of collision avoidance
      const scripts = ["local myLongVar = 1\nlocal a = 2\nprint(myLongVar + a)"];
      const result = renameIdentifiers(scripts);

      // 'a' should still be 'a' (not swapped to something else)
      // Even though myLongVar appears first, 'a' should be reserved
      expect(result[0]).toContain("local a = 2");

      // myLongVar should become 'b' (not 'a')
      expect(result[0]).not.toContain("myLongVar");

      // Verify the renamed variable is 'b', not 'a'
      expect(result[0]).toMatch(/local b = 1/);
    });

    it("does not clash with existing short function names", () => {
      const scripts = ["local function a() return 1 end\nlocal function myLongFunc() return 2 end\nprint(a() + myLongFunc())"];
      const result = renameIdentifiers(scripts);

      // 'a' should stay as 'a'
      expect(result[0]).toContain("function a()");

      // myLongFunc should be renamed to 'b' (not 'a')
      expect(result[0]).not.toContain("myLongFunc");
      expect(result[0]).toMatch(/function b\(\)/);
    });

    it("does not clash with existing short global function names", () => {
      const scripts = [
        "function f() return 1 end\nfunction myGlobalFunc() return 2 end",
        "print(f() + myGlobalFunc())",
      ];
      const result = renameIdentifiers(scripts);

      // 'f' should stay as 'f'
      expect(result[0]).toContain("function f()");
      expect(result[1]).toContain("f()");

      // myGlobalFunc should be renamed consistently
      expect(result[0]).not.toContain("myGlobalFunc");
      expect(result[1]).not.toContain("myGlobalFunc");
    });
  });

  describe("edge cases", () => {
    it("handles empty script", () => {
      const scripts = [""];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toBe("");
    });

    it("handles script with only comments", () => {
      const scripts = ["-- this is a comment"];
      const result = renameIdentifiers(scripts);

      expect(result[0]).toBe("-- this is a comment");
    });

    it("handles syntax errors gracefully", () => {
      const scripts = ["local x = "];
      const result = renameIdentifiers(scripts);

      // Should return original on parse error
      expect(result[0]).toBe("local x = ");
    });

    it("handles multiple scripts with different locals", () => {
      const scripts = [
        "local foo = 1",
        "local bar = 2",
      ];
      const result = renameIdentifiers(scripts);

      // Each script's locals are independent
      expect(result[0]).not.toContain("foo");
      expect(result[1]).not.toContain("bar");
    });

    it("preserves string literals containing identifier names", () => {
      const scripts = ['local x = "myVariable"\nlocal myVariable = 1'];
      const result = renameIdentifiers(scripts);

      // String content should be preserved
      expect(result[0]).toContain('"myVariable"');
      // Variable should be renamed
      expect(result[0]).not.toMatch(/local myVariable/);
    });

    it("handles table field access correctly", () => {
      const scripts = ["local tbl = {}\ntbl.myField = 1"];
      const result = renameIdentifiers(scripts);

      // Table variable should be renamed (it's longer than 1 char)
      expect(result[0]).not.toContain("tbl");
      // Note: Field names ARE renamed (luaparse treats them as identifiers)
      // This works correctly as long as field access is consistent (dot notation only)
      expect(result[0]).not.toContain("myField");
    });
  });

  describe("real-world patterns", () => {
    it("renames Grid-style init code", () => {
      const scripts = [
        `MIDI_NOTE, MIDI_CC, CH = 144, 176, page_current()
function midirx_cb(self, event, header)
    local cmd, el, val = event[2], event[3] - 32, event[4]
    if cmd == MIDI_NOTE then
        element[el]:led_value(1, val)
    end
end`,
      ];
      const result = renameIdentifiers(scripts);

      // User globals should be renamed
      expect(result[0]).not.toContain("MIDI_NOTE");
      expect(result[0]).not.toContain("MIDI_CC");
      expect(result[0]).not.toContain("CH");

      // Callback name should NOT be renamed (firmware expects this name)
      expect(result[0]).toContain("midirx_cb");

      // Locals should be renamed
      expect(result[0]).not.toContain("cmd");
      expect(result[0]).not.toContain(" el,");
      expect(result[0]).not.toContain(" val ");

      // Reserved should NOT be renamed
      expect(result[0]).toContain("self");
      // 'event' and 'header' are parameters, they CAN be renamed
      expect(result[0]).not.toContain("event");
      expect(result[0]).not.toContain("header");

      // Builtins should NOT be renamed
      expect(result[0]).toContain("page_current");
      expect(result[0]).toContain("element[");
      expect(result[0]).toContain("led_value");
    });

    it("renames button handler code", () => {
      const scripts = [
        `local note, val = 32 + self:element_index(), self:button_value()
if self:button_state() == 0 then
    if self:button_elapsed_time() > 1000 then
        note = note + 16
        val = 127
    end
end
midi_send(CH, MIDI_NOTE, note, val)`,
      ];
      const result = renameIdentifiers(scripts);

      // Locals should be renamed
      expect(result[0]).not.toContain("note");
      expect(result[0]).not.toContain(" val");

      // Globals should be renamed
      expect(result[0]).not.toContain("CH");
      expect(result[0]).not.toContain("MIDI_NOTE");

      // Builtins preserved
      expect(result[0]).toContain("midi_send");
      expect(result[0]).toContain("self:");
    });
  });
});

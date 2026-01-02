import { describe, it, expect } from "vitest";
import {
  wrapScript,
  unwrapScript,
  validateActionLength,
  countEvents,
  parseEventType,
  validatePage,
  matchesUsbFilter,
  MAX_ACTION_LENGTH,
  DEVICE_CONFIG,
  EVENT_NAMES,
  ConfigFile,
} from "./lib.js";

describe("wrapScript", () => {
  it("wraps script with <?lua ?> tags", () => {
    expect(wrapScript("print('hello')")).toBe("<?lua print('hello') ?>");
  });

  it("returns empty string for empty input", () => {
    expect(wrapScript("")).toBe("");
    expect(wrapScript("   ")).toBe("");
  });

  it("does not double-wrap already wrapped scripts", () => {
    expect(wrapScript("<?lua code ?>")).toBe("<?lua code ?>");
  });
});

describe("unwrapScript", () => {
  it("unwraps <?lua ?> tags", () => {
    expect(unwrapScript("<?lua print('hello') ?>")).toBe("print('hello')");
  });

  it("returns empty string for empty input", () => {
    expect(unwrapScript("")).toBe("");
  });

  it("strips null bytes from end", () => {
    expect(unwrapScript("<?lua code ?>\0\0\0")).toBe("code");
  });

  it("returns script as-is if not wrapped", () => {
    expect(unwrapScript("raw code")).toBe("raw code");
  });

  it("handles multiline scripts", () => {
    const script = "<?lua\nline1\nline2\n?>";
    expect(unwrapScript(script)).toBe("line1\nline2");
  });
});

describe("validateActionLength", () => {
  it("does not throw for valid length", () => {
    expect(() => validateActionLength("x".repeat(909), 0, 0)).not.toThrow();
  });

  it("throws for script exceeding max length", () => {
    expect(() => validateActionLength("x".repeat(910), 0, 0)).toThrow(/Script too long/);
  });

  it("includes element and event in error message", () => {
    expect(() => validateActionLength("x".repeat(1000), 5, 2)).toThrow(/element 5, event 2/);
  });

  it("includes character count in error message", () => {
    expect(() => validateActionLength("x".repeat(1000), 0, 0)).toThrow(/1000\/909/);
  });
});

describe("countEvents", () => {
  it("counts non-empty events", () => {
    const config: ConfigFile = {
      name: "Test",
      type: "EN16",
      version: { major: "1", minor: "0", patch: "0" },
      configs: [
        {
          controlElementNumber: 0,
          events: [
            { event: 0, config: "code" },
            { event: 1, config: "" },
            { event: 2, config: "more code" },
          ],
        },
      ],
    };
    expect(countEvents(config)).toBe(2);
  });

  it("returns 0 for empty config", () => {
    const config: ConfigFile = {
      name: "Test",
      type: "EN16",
      version: { major: "1", minor: "0", patch: "0" },
      configs: [],
    };
    expect(countEvents(config)).toBe(0);
  });

  it("handles whitespace-only configs as empty", () => {
    const config: ConfigFile = {
      name: "Test",
      type: "EN16",
      version: { major: "1", minor: "0", patch: "0" },
      configs: [
        {
          controlElementNumber: 0,
          events: [{ event: 0, config: "   " }],
        },
      ],
    };
    expect(countEvents(config)).toBe(0);
  });
});

describe("parseEventType", () => {
  it("parses number event type", () => {
    expect(parseEventType(0)).toBe(0);
    expect(parseEventType(8)).toBe(8);
  });

  it("parses string event type", () => {
    expect(parseEventType("0")).toBe(0);
    expect(parseEventType("5")).toBe(5);
  });

  it("throws for negative event type", () => {
    expect(() => parseEventType(-1)).toThrow(/Invalid event type/);
  });

  it("throws for event type > 8", () => {
    expect(() => parseEventType(9)).toThrow(/Invalid event type/);
  });

  it("throws for non-numeric string", () => {
    expect(() => parseEventType("abc")).toThrow(/Invalid event type/);
  });
});

describe("validatePage", () => {
  it("returns all pages for undefined", () => {
    expect(validatePage(undefined)).toEqual([0, 1, 2, 3]);
  });

  it("returns single page for valid number", () => {
    expect(validatePage(0)).toEqual([0]);
    expect(validatePage(2)).toEqual([2]);
    expect(validatePage(3)).toEqual([3]);
  });

  it("throws for negative page", () => {
    expect(() => validatePage(-1)).toThrow(/Invalid page/);
  });

  it("throws for page > 3", () => {
    expect(() => validatePage(4)).toThrow(/Invalid page/);
  });

  it("throws for non-integer", () => {
    expect(() => validatePage(1.5)).toThrow(/Invalid page/);
  });
});

describe("matchesUsbFilter", () => {
  it("matches D51 device", () => {
    expect(matchesUsbFilter("03eb", "ecac")).toBe(true);
    expect(matchesUsbFilter("03EB", "ECAC")).toBe(true); // case insensitive
  });

  it("matches ESP32 device", () => {
    expect(matchesUsbFilter("303a", "8123")).toBe(true);
  });

  it("returns false for unknown device", () => {
    expect(matchesUsbFilter("1234", "5678")).toBe(false);
  });

  it("returns false for undefined values", () => {
    expect(matchesUsbFilter(undefined, "ecac")).toBe(false);
    expect(matchesUsbFilter("03eb", undefined)).toBe(false);
  });
});

describe("constants", () => {
  it("MAX_ACTION_LENGTH is 909", () => {
    expect(MAX_ACTION_LENGTH).toBe(909);
  });

  it("DEVICE_CONFIG has expected device types", () => {
    expect(Object.keys(DEVICE_CONFIG)).toEqual(["EN16", "PO16", "BU16", "EF44", "PBF4", "TEK2", "PB44"]);
  });

  it("EN16 has 17 elements (0-15 + 255)", () => {
    expect(DEVICE_CONFIG.EN16.elements).toHaveLength(17);
    expect(DEVICE_CONFIG.EN16.elements).toContain(0);
    expect(DEVICE_CONFIG.EN16.elements).toContain(15);
    expect(DEVICE_CONFIG.EN16.elements).toContain(255);
  });

  it("EVENT_NAMES maps all event types", () => {
    expect(EVENT_NAMES[0]).toBe("init");
    expect(EVENT_NAMES[2]).toBe("encoder");
    expect(EVENT_NAMES[3]).toBe("button");
    expect(EVENT_NAMES[6]).toBe("timer");
  });
});

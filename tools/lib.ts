// =============================================================================
// Constants
// =============================================================================

export const MAX_ACTION_LENGTH = 909;
export const SYSTEM_ELEMENT = 255;

export const EVENT_NAMES: Record<number, string> = {
  0: "init",
  1: "potmeter",
  2: "encoder",
  3: "button",
  4: "utility",
  5: "midirx",
  6: "timer",
  7: "endless",
  8: "draw",
};

export const DEVICE_CONFIG: Record<string, { elements: number[]; events: number[]; systemEvents: number[] }> = {
  EN16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 6], systemEvents: [0, 4, 5, 6] },
  PO16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
  BU16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 3, 6], systemEvents: [0, 4, 5, 6] },
  EF44: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 7, 6], systemEvents: [0, 4, 5, 6] },
  PBF4: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
  TEK2: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 6], systemEvents: [0, 4, 5, 6] },
  PB44: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
};

export const USB_FILTERS = [
  { vendorId: "03eb", productId: "ecac" }, // D51
  { vendorId: "03eb", productId: "ecad" }, // D51 alt
  { vendorId: "303a", productId: "8123" }, // ESP32
] as const;

// =============================================================================
// Types
// =============================================================================

export interface ConfigFile {
  id?: string;
  name: string;
  type: string;
  version: { major: string; minor: string; patch: string };
  configType?: string;
  configs: ElementConfig[];
}

export interface ElementConfig {
  controlElementNumber: number;
  events: EventConfig[];
}

export interface EventConfig {
  event: number | string;
  config: string;
}

// =============================================================================
// Script Helpers
// =============================================================================

export function wrapScript(script: string): string {
  if (!script || script.trim() === "") return "";
  if (script.startsWith("<?lua")) return script;
  return `<?lua ${script} ?>`;
}

export function unwrapScript(script: string): string {
  if (!script) return "";
  script = script.replace(/\0+$/, "").trim();
  const match = script.match(/^<\?lua\s+(.*?)\s+\?>$/s);
  return match ? match[1] : script;
}

export function validateActionLength(script: string, elementNum: number, eventType: number): void {
  if (script.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `Script too long for element ${elementNum}, event ${eventType}: ` +
        `${script.length}/${MAX_ACTION_LENGTH} characters. ` +
        `Reduce by ${script.length - MAX_ACTION_LENGTH} characters.`
    );
  }
}

// =============================================================================
// Config Helpers
// =============================================================================

export function countEvents(config: ConfigFile): number {
  return config.configs.reduce((count, element) => {
    return count + element.events.filter((e) => e.config?.trim()).length;
  }, 0);
}

export function parseEventType(event: number | string): number {
  const parsed = typeof event === "string" ? parseInt(event, 10) : event;
  if (isNaN(parsed) || parsed < 0 || parsed > 8) {
    throw new Error(`Invalid event type: ${event}`);
  }
  return parsed;
}

export function validatePage(page: number | undefined): number[] {
  if (page === undefined) return [0, 1, 2, 3];
  if (!Number.isInteger(page) || page < 0 || page > 3) {
    throw new Error(`Invalid page: ${page}. Must be 0-3.`);
  }
  return [page];
}

export function matchesUsbFilter(vendorId: string | undefined, productId: string | undefined): boolean {
  if (!vendorId || !productId) return false;
  const vid = vendorId.toLowerCase();
  const pid = productId.toLowerCase();
  return USB_FILTERS.some((f) => f.vendorId === vid && f.productId === pid);
}

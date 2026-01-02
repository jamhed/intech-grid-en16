#!/usr/bin/env npx tsx
import { SerialPort } from "serialport";
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { executeLuaConfig, closeLuaEngine } from "./lua-runtime.js";

// Dynamically import grid-protocol to work around ESM issues
const gridProtocol = await import("@intechstudio/grid-protocol");
const { grid } = gridProtocol;

// =============================================================================
// Constants
// =============================================================================

const LF = 0x0a;
const SYSTEM_ELEMENT = 255;
const MAX_ACTION_LENGTH = 909;

// Cache protocol constants at module level
const PROTOCOL_CONST = {
  SOH: parseInt(grid.getProperty("CONST").SOH),
  EOT: parseInt(grid.getProperty("CONST").EOT),
} as const;

const VERSION = grid.getProperty("VERSION");

const USB_FILTERS = [
  { vendorId: "03eb", productId: "ecac" }, // D51
  { vendorId: "03eb", productId: "ecad" }, // D51 alt
  { vendorId: "303a", productId: "8123" }, // ESP32
] as const;

const EVENT_NAMES: Record<number, string> = {
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

// Device configurations: element counts and relevant events per element type
const DEVICE_CONFIG: Record<string, { elements: number[]; events: number[]; systemEvents: number[] }> = {
  EN16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 6], systemEvents: [0, 4, 5, 6] },
  PO16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
  BU16: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 3, 6], systemEvents: [0, 4, 5, 6] },
  EF44: { elements: [...Array(16).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 7, 6], systemEvents: [0, 4, 5, 6] },
  PBF4: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
  TEK2: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 2, 3, 6], systemEvents: [0, 4, 5, 6] },
  PB44: { elements: [...Array(8).keys(), SYSTEM_ELEMENT], events: [0, 1, 3, 6], systemEvents: [0, 4, 5, 6] },
};

// =============================================================================
// Types
// =============================================================================

interface ConfigFile {
  id?: string;
  name: string;
  type: string;
  version: { major: string; minor: string; patch: string };
  configType?: string;
  configs: ElementConfig[];
}

interface ElementConfig {
  controlElementNumber: number;
  events: EventConfig[];
}

interface EventConfig {
  event: number | string;
  config: string;
}

interface DecodedFrame {
  class_name: string;
  class_instr: string;
  class_parameters: {
    ACTIONSTRING?: string;
    LENGTH?: number;
    [key: string]: unknown;
  };
  brc_parameters: Record<string, number>;
  raw: number[];
}

interface Packet {
  serial: number[];
  id: number;
}

interface SendOptions {
  timeout: number;
  retries: number;
  debug?: boolean;
}

// =============================================================================
// Lua Decompilation
// =============================================================================

function decompileLuaConfig(config: ConfigFile): string {
  const lines: string[] = [];

  lines.push(`return {`);
  lines.push(`  name = "${config.name}",`);
  lines.push(`  type = "${config.type}",`);
  lines.push(`  version = {${config.version.major}, ${config.version.minor}, ${config.version.patch}},`);
  lines.push(``);

  for (const element of config.configs) {
    lines.push(`  [${element.controlElementNumber}] = {`);

    for (const event of element.events) {
      const eventType = typeof event.event === "string" ? parseInt(event.event, 10) : event.event;
      const eventName = EVENT_NAMES[eventType] ?? `event${eventType}`;
      const script = event.config
        .replace(/^--\[\[@cb\]\]\s*/, "") // Remove callback marker
        .trim();

      // Format as function
      lines.push(`    ${eventName} = function(self)`);

      // Indent script lines
      for (const line of script.split(/[;\n]+/).filter((l) => l.trim())) {
        lines.push(`      ${line.trim()}`);
      }

      lines.push(`    end,`);
    }

    lines.push(`  },`);
    lines.push(``);
  }

  lines.push(`}`);

  return lines.join("\n");
}

// =============================================================================
// Packet Building
// =============================================================================

function buildConfigPacket(
  instruction: "EXECUTE" | "FETCH",
  params: {
    pageNumber: number;
    elementNumber: number;
    eventType: number;
    actionString?: string;
  }
): Packet {
  const actionString = params.actionString ?? "";

  const descriptor = {
    brc_parameters: {
      DX: 0,
      DY: 0,
    },
    class_name: "CONFIG",
    class_instr: instruction,
    class_parameters: {
      VERSIONMAJOR: VERSION.MAJOR,
      VERSIONMINOR: VERSION.MINOR,
      VERSIONPATCH: VERSION.PATCH,
      PAGENUMBER: params.pageNumber,
      ELEMENTNUMBER: params.elementNumber,
      EVENTTYPE: params.eventType,
      ACTIONLENGTH: actionString.length,
      ACTIONSTRING: actionString,
    },
  };

  const result = grid.encode_packet(descriptor);
  if (!result) {
    throw new Error(`Failed to encode CONFIG ${instruction} packet`);
  }
  return result;
}

// =============================================================================
// Packet Parsing
// =============================================================================

function parsePacket(data: Buffer): DecodedFrame[] | null {
  const bytes = Array.from(data);

  const start = bytes.indexOf(PROTOCOL_CONST.SOH);
  if (start === -1) return null;

  let end = -1;
  for (let i = start; i < bytes.length - 2; i++) {
    if (bytes[i] === PROTOCOL_CONST.EOT) {
      end = i + 3;
      break;
    }
  }

  if (end === -1 || end > bytes.length) return null;

  const packetBytes = bytes.slice(start, end);
  const frames = grid.decode_packet_frame(packetBytes) as DecodedFrame[] | undefined;

  if (!frames) {
    return null;
  }

  grid.decode_packet_classes(frames);
  return frames;
}

function parseConfigReport(data: Buffer): { actionString: string } | null {
  const frames = parsePacket(data);
  if (!frames) return null;

  for (const frame of frames) {
    if (frame.class_name === "CONFIG" && frame.class_instr === "REPORT") {
      return { actionString: frame.class_parameters.ACTIONSTRING ?? "" };
    }
  }

  return null;
}

function hasAcknowledge(data: Buffer): boolean {
  const frames = parsePacket(data);
  if (!frames) return false;
  return frames.some((frame) => frame.class_instr === "ACKNOWLEDGE");
}

// =============================================================================
// Script Helpers
// =============================================================================

function wrapScript(script: string): string {
  if (!script || script.trim() === "") return "";
  if (script.startsWith("<?lua")) return script;
  return `<?lua ${script} ?>`;
}

function unwrapScript(script: string): string {
  if (!script) return "";
  script = script.replace(/\0+$/, "").trim();
  const match = script.match(/^<\?lua\s+(.*?)\s+\?>$/s);
  return match ? match[1] : script;
}

function validateActionLength(script: string, elementNum: number, eventType: number): void {
  if (script.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `Script too long for element ${elementNum}, event ${eventType}: ` +
        `${script.length}/${MAX_ACTION_LENGTH} characters. ` +
        `Reduce by ${script.length - MAX_ACTION_LENGTH} characters.`
    );
  }
}

// =============================================================================
// Serial Port Helpers
// =============================================================================

async function findDevice(manualPort?: string): Promise<string> {
  if (manualPort) return manualPort;

  const ports = await SerialPort.list();

  for (const port of ports) {
    const vid = port.vendorId?.toLowerCase();
    const pid = port.productId?.toLowerCase();

    for (const filter of USB_FILTERS) {
      if (vid === filter.vendorId && pid === filter.productId) {
        console.log(`Found Grid device: ${port.path} (VID: ${vid}, PID: ${pid})`);
        return port.path;
      }
    }
  }

  console.log("\nAvailable ports:");
  for (const port of ports) {
    console.log(`  ${port.path} - ${port.manufacturer ?? "Unknown"} (VID: ${port.vendorId}, PID: ${port.productId})`);
  }

  throw new Error("No Grid device found. Connect device or specify --port.");
}

async function openPort(portPath: string): Promise<SerialPort> {
  const port = new SerialPort({
    path: portPath,
    baudRate: 2000000,
  });

  await new Promise<void>((resolve, reject) => {
    port.once("open", resolve);
    port.once("error", reject);
  });

  return port;
}

// =============================================================================
// Communication
// =============================================================================

async function sendAndWait<T>(
  port: SerialPort,
  packet: Packet,
  parser: (buffer: Buffer) => T | null,
  options: SendOptions
): Promise<T> {
  const { timeout, retries, debug = false } = options;

  return new Promise((resolve, reject) => {
    let timeoutId: NodeJS.Timeout;
    let attempt = 0;
    let buffer = Buffer.alloc(0);

    const cleanup = () => {
      clearTimeout(timeoutId);
      port.removeListener("data", onData);
    };

    const sendPacket = () => {
      attempt++;
      buffer = Buffer.alloc(0);
      clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        if (attempt < retries) {
          sendPacket();
        } else {
          cleanup();
          reject(new Error(`Timeout after ${retries} attempts`));
        }
      }, timeout);

      port.write(Buffer.from([...packet.serial, LF]));
    };

    const onData = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      if (debug) {
        console.log(`\n  [DEBUG] Received ${data.length} bytes:`, buffer.toString("hex").slice(0, 100));
      }

      const result = parser(buffer);
      if (result !== null) {
        cleanup();
        resolve(result);
      }
    };

    port.on("data", onData);
    sendPacket();
  });
}

async function sendAndWaitAck(port: SerialPort, packet: Packet, options: Partial<SendOptions> = {}): Promise<void> {
  const { timeout = 1000, retries = 3 } = options;
  await sendAndWait(port, packet, (buf) => (hasAcknowledge(buf) ? true : null), { timeout, retries });
}

async function sendAndWaitReport(port: SerialPort, packet: Packet, options: Partial<SendOptions> = {}): Promise<string> {
  const { timeout = 500, retries = 2, debug = false } = options;
  const result = await sendAndWait(port, packet, parseConfigReport, { timeout, retries, debug });
  return result.actionString;
}

// =============================================================================
// Config Operations
// =============================================================================

function countEvents(config: ConfigFile): number {
  return config.configs.reduce((count, element) => {
    return count + element.events.filter((e) => e.config?.trim()).length;
  }, 0);
}

function parseEventType(event: number | string): number {
  const parsed = typeof event === "string" ? parseInt(event, 10) : event;
  if (isNaN(parsed) || parsed < 0 || parsed > 8) {
    throw new Error(`Invalid event type: ${event}`);
  }
  return parsed;
}

async function uploadConfig(
  port: SerialPort,
  config: ConfigFile,
  pages: number[],
  verbose: boolean
): Promise<void> {
  const totalEvents = countEvents(config) * pages.length;
  let current = 0;

  for (const pageNum of pages) {
    if (verbose) console.log(`\nUploading page ${pageNum}...`);

    for (const element of config.configs) {
      for (const event of element.events) {
        if (!event.config?.trim()) continue;

        const eventType = parseEventType(event.event);
        const actionString = wrapScript(event.config);

        validateActionLength(actionString, element.controlElementNumber, eventType);

        const packet = buildConfigPacket("EXECUTE", {
          pageNumber: pageNum,
          elementNumber: element.controlElementNumber,
          eventType,
          actionString,
        });

        try {
          await sendAndWaitAck(port, packet);
          current++;

          const pct = Math.round((current / totalEvents) * 100);
          const bar = "=".repeat(Math.floor(pct / 5)).padEnd(20, " ");
          process.stdout.write(`\r[${bar}] ${pct}% | Element ${element.controlElementNumber}, Event ${eventType}`);

          if (verbose) {
            console.log(`  Sent: element=${element.controlElementNumber}, event=${eventType}, len=${actionString.length}`);
          }
        } catch (err) {
          console.error(`\nFailed: element ${element.controlElementNumber}, event ${eventType}`);
          throw err;
        }
      }
    }
  }

  console.log("\n");
}

interface DownloadResult {
  config: ConfigFile;
  failed: Array<{ element: number; event: number; error: string }>;
}

async function downloadConfig(
  port: SerialPort,
  deviceType: string,
  deviceConfig: { elements: number[]; events: number[]; systemEvents: number[] },
  pageNum: number,
  verbose: boolean
): Promise<DownloadResult> {
  const config: ConfigFile = {
    id: crypto.randomUUID(),
    name: `${deviceType} Config`,
    type: deviceType,
    version: { major: "1", minor: "0", patch: "0" },
    configType: "profile",
    configs: [],
  };

  const failed: DownloadResult["failed"] = [];

  // Build fetch list based on device configuration
  const toFetch: Array<{ element: number; event: number }> = [];
  for (const elementNum of deviceConfig.elements) {
    const events = elementNum === SYSTEM_ELEMENT ? deviceConfig.systemEvents : deviceConfig.events;
    for (const eventType of events) {
      toFetch.push({ element: elementNum, event: eventType });
    }
  }

  console.log(`Fetching ${toFetch.length} configs...`);

  const elementConfigs = new Map<number, Map<number, string>>();

  let current = 0;
  for (const { element: elementNum, event: eventType } of toFetch) {
    const packet = buildConfigPacket("FETCH", {
      pageNumber: pageNum,
      elementNumber: elementNum,
      eventType,
    });

    try {
      const actionString = await sendAndWaitReport(port, packet, { timeout: 500, retries: 1 });
      const script = unwrapScript(actionString);

      if (script) {
        if (!elementConfigs.has(elementNum)) {
          elementConfigs.set(elementNum, new Map());
        }
        elementConfigs.get(elementNum)!.set(eventType, script);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failed.push({ element: elementNum, event: eventType, error: errorMsg });

      if (verbose) {
        console.log(`\n  Failed: element=${elementNum}, event=${eventType}: ${errorMsg}`);
      }
    }

    current++;
    const pct = Math.round((current / toFetch.length) * 100);
    const bar = "=".repeat(Math.floor(pct / 5)).padEnd(20, " ");
    process.stdout.write(`\r[${bar}] ${pct}% | Element ${elementNum}, Event ${EVENT_NAMES[eventType] ?? eventType}`);
  }

  console.log("\n");

  // Convert to config format
  for (const [elementNum, events] of elementConfigs) {
    const eventArray: EventConfig[] = [];
    for (const [eventType, script] of events) {
      eventArray.push({ event: eventType, config: script });
    }
    eventArray.sort((a, b) => (a.event as number) - (b.event as number));

    if (eventArray.length > 0) {
      config.configs.push({
        controlElementNumber: elementNum,
        events: eventArray,
      });
    }
  }

  // Sort elements (system element last)
  config.configs.sort((a, b) => {
    if (a.controlElementNumber === SYSTEM_ELEMENT) return 1;
    if (b.controlElementNumber === SYSTEM_ELEMENT) return -1;
    return a.controlElementNumber - b.controlElementNumber;
  });

  return { config, failed };
}

// =============================================================================
// CLI Commands
// =============================================================================

program.name("grid-cli").description("Grid device configuration CLI").version("1.0.0");

program
  .command("upload")
  .description("Upload configuration to Grid device")
  .argument("<config>", "Path to config file (.json or .lua)")
  .option("-p, --port <path>", "Serial port path (auto-detect if not specified)")
  .option("--page <n>", "Upload to specific page only (0-3)", (v) => parseInt(v, 10))
  .option("-v, --verbose", "Show detailed progress")
  .option("-d, --dry-run", "Validate config without uploading")
  .action(async (configPath: string, options) => {
    const fullPath = path.resolve(configPath);

    if (!fs.existsSync(fullPath)) {
      console.error(`Config file not found: ${fullPath}`);
      process.exit(1);
    }

    const isLua = fullPath.endsWith(".lua");
    let config: ConfigFile;

    try {
      const raw = fs.readFileSync(fullPath, "utf-8");

      if (isLua) {
        // Execute Lua config using wasmoon runtime
        console.log("Executing Lua config...");
        config = await executeLuaConfig(raw);
      } else {
        config = JSON.parse(raw);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to parse config file: ${msg}`);
      process.exit(1);
    }

    if (!config.configs || !Array.isArray(config.configs)) {
      console.error("Invalid config: missing 'configs' array");
      process.exit(1);
    }

    // Validate all scripts before uploading
    for (const element of config.configs) {
      for (const event of element.events) {
        if (event.config?.trim()) {
          try {
            const eventType = parseEventType(event.event);
            const actionString = wrapScript(event.config);
            validateActionLength(actionString, element.controlElementNumber, eventType);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Validation failed: ${msg}`);
            process.exit(1);
          }
        }
      }
    }

    const pages = options.page !== undefined ? [options.page] : [0, 1, 2, 3];

    console.log("Grid CLI - Upload");
    console.log("=================");
    console.log(`Config:  ${path.basename(configPath)}${isLua ? " (Lua)" : ""}`);
    console.log(`Type:    ${config.type ?? "Unknown"}`);
    console.log(`Pages:   ${pages.join(", ")}`);
    console.log(`Events:  ${countEvents(config)} per page`);

    if (options.dryRun) {
      console.log("\nDry run - validation passed!");
      return;
    }

    console.log("\nConnecting to Grid device...");
    const portPath = await findDevice(options.port);
    const port = await openPort(portPath);
    console.log("Connected.\n");

    try {
      await uploadConfig(port, config, pages, options.verbose);
      console.log("Upload complete!");
    } finally {
      port.close();
    }
  });

program
  .command("download")
  .description("Download configuration from Grid device")
  .argument("<output>", "Output file path (.json or .lua)")
  .option("-p, --port <path>", "Serial port path (auto-detect if not specified)")
  .option("-t, --type <type>", "Device type (EN16, PO16, BU16, EF44, PBF4, TEK2, PB44)", "EN16")
  .option("--page <n>", "Download from specific page (0-3)", (v) => parseInt(v, 10), 0)
  .option("-f, --format <fmt>", "Output format: json or lua (auto-detect from extension)")
  .option("-v, --verbose", "Show detailed progress")
  .action(async (outputPath: string, options) => {
    const deviceType = options.type.toUpperCase();
    const deviceConfig = DEVICE_CONFIG[deviceType];

    if (!deviceConfig) {
      console.error(`Unknown device type: ${deviceType}`);
      console.error(`Supported types: ${Object.keys(DEVICE_CONFIG).join(", ")}`);
      process.exit(1);
    }

    // Determine output format
    let format = options.format?.toLowerCase();
    if (!format) {
      if (outputPath.endsWith(".lua")) {
        format = "lua";
      } else {
        format = "json";
      }
    }

    if (format !== "json" && format !== "lua") {
      console.error(`Invalid format: ${format}. Use 'json' or 'lua'.`);
      process.exit(1);
    }

    console.log("Grid CLI - Download");
    console.log("===================");
    console.log(`Type:     ${deviceType}`);
    console.log(`Page:     ${options.page}`);
    console.log(`Elements: ${deviceConfig.elements.length}`);
    console.log(`Format:   ${format}`);
    console.log(`Output:   ${outputPath}`);

    console.log("\nConnecting to Grid device...");
    const portPath = await findDevice(options.port);
    const port = await openPort(portPath);
    console.log("Connected.\n");

    try {
      const { config, failed } = await downloadConfig(port, deviceType, deviceConfig, options.page, options.verbose);

      const fullPath = path.resolve(outputPath);

      if (format === "lua") {
        const luaSource = decompileLuaConfig(config);
        fs.writeFileSync(fullPath, luaSource);
      } else {
        fs.writeFileSync(fullPath, JSON.stringify(config, null, 2));
      }

      console.log("Download complete!");
      console.log(`Saved to: ${fullPath}`);
      console.log(`Elements: ${config.configs.length}`);

      if (failed.length > 0) {
        console.log(`\nWarning: ${failed.length} fetch(es) failed (empty events are normal)`);
      }
    } finally {
      port.close();
    }
  });

// Convert command: convert between JSON and Lua formats
program
  .command("convert")
  .description("Convert config between JSON and Lua formats")
  .argument("<input>", "Input file path (.json or .lua)")
  .argument("<output>", "Output file path (.json or .lua)")
  .action(async (inputPath: string, outputPath: string) => {
    const fullInputPath = path.resolve(inputPath);

    if (!fs.existsSync(fullInputPath)) {
      console.error(`Input file not found: ${fullInputPath}`);
      process.exit(1);
    }

    const inputIsLua = fullInputPath.endsWith(".lua");
    const outputIsLua = outputPath.endsWith(".lua");

    if (inputIsLua === outputIsLua) {
      console.error("Input and output formats are the same. Use different extensions.");
      process.exit(1);
    }

    try {
      const raw = fs.readFileSync(fullInputPath, "utf-8");
      const fullOutputPath = path.resolve(outputPath);

      if (inputIsLua) {
        // Lua -> JSON (execute Lua with wasmoon)
        console.log("Executing Lua config...");
        const config = await executeLuaConfig(raw);
        fs.writeFileSync(fullOutputPath, JSON.stringify(config, null, 2));
      } else {
        // JSON -> Lua
        console.log("Converting JSON to Lua...");
        const config = JSON.parse(raw);
        const luaSource = decompileLuaConfig(config);
        fs.writeFileSync(fullOutputPath, luaSource);
      }

      console.log(`Converted: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Conversion failed: ${msg}`);
      process.exit(1);
    }
  });

program.parse();

#!/usr/bin/env npx tsx
import { SerialPort } from "serialport";
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { loadLuaConfig, renameIdentifiers } from "./lua-loader.js";
import {
  SYSTEM_ELEMENT,
  EVENT_NAMES,
  DEVICE_CONFIG,
  ConfigFile,
  EventConfig,
  wrapScript,
  unwrapScript,
  validateActionLength,
  countEvents,
  parseEventType,
  validatePage,
  matchesUsbFilter,
  sortElements,
  renderProgress,
  getErrorMessage,
  forEachEvent,
  mapEvents,
} from "./lib.js";

// Dynamically import grid-protocol to work around ESM issues
const gridProtocol = await import("@intechstudio/grid-protocol");
const { grid, GridScript } = gridProtocol;

// =============================================================================
// Constants
// =============================================================================

const LF = 0x0a;
const SERIAL_BAUD_RATE = 2000000;
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_RETRIES = 2;

// Cache protocol constants at module level
const PROTOCOL_CONST = {
  SOH: parseInt(grid.getProperty("CONST").SOH),
  EOT: parseInt(grid.getProperty("CONST").EOT),
} as const;

const VERSION = grid.getProperty("VERSION");

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
// Serial Port Helpers
// =============================================================================

async function findDevice(manualPort?: string): Promise<string> {
  if (manualPort) return manualPort;

  const ports = await SerialPort.list();

  for (const port of ports) {
    if (matchesUsbFilter(port.vendorId, port.productId)) {
      console.log(`Found Grid device: ${port.path} (VID: ${port.vendorId}, PID: ${port.productId})`);
      return port.path;
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
    baudRate: SERIAL_BAUD_RATE,
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

async function sendAndWaitReport(
  port: SerialPort,
  packet: Packet,
  options: Partial<SendOptions> = {}
): Promise<string> {
  const { timeout = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, debug = false } = options;
  const result = await sendAndWait(port, packet, parseConfigReport, { timeout, retries, debug });
  return result.actionString;
}

// =============================================================================
// Config Operations
// =============================================================================

async function uploadConfig(port: SerialPort, config: ConfigFile, pages: number[], verbose: boolean): Promise<void> {
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
          renderProgress(current, totalEvents, `Element ${element.controlElementNumber}, Event ${eventType}`);

          if (verbose) {
            console.log(
              `  Sent: element=${element.controlElementNumber}, event=${eventType}, len=${actionString.length}`
            );
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
      const actionString = await sendAndWaitReport(port, packet, { timeout: DEFAULT_TIMEOUT_MS, retries: 1 });
      const script = unwrapScript(actionString);

      if (script) {
        if (!elementConfigs.has(elementNum)) {
          elementConfigs.set(elementNum, new Map());
        }
        elementConfigs.get(elementNum)!.set(eventType, script);
      }
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      failed.push({ element: elementNum, event: eventType, error: errorMsg });

      if (verbose) {
        console.log(`\n  Failed: element=${elementNum}, event=${eventType}: ${errorMsg}`);
      }
    }

    current++;
    renderProgress(current, toFetch.length, `Element ${elementNum}, Event ${EVENT_NAMES[eventType] ?? eventType}`);
  }

  console.log("\n");

  // Convert to config format
  for (const [elementNum, events] of elementConfigs) {
    const eventArray: EventConfig[] = [];
    for (const [eventType, script] of events) {
      eventArray.push({ event: eventType, config: script });
    }
    eventArray.sort((a, b) => a.event - b.event);

    if (eventArray.length > 0) {
      config.configs.push({
        controlElementNumber: elementNum,
        events: eventArray,
      });
    }
  }

  // Sort elements (system element last)
  config.configs = sortElements(config.configs);

  return { config, failed };
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load a config file from disk (JSON or Lua format).
 */
async function loadConfig(configPath: string): Promise<ConfigFile> {
  const fullPath = path.resolve(configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (ext === ".lua") {
    return loadLuaConfig(fullPath);
  }

  const raw = fs.readFileSync(fullPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Validate all scripts in a config before uploading.
 */
function validateConfig(config: ConfigFile): void {
  if (!config.configs || !Array.isArray(config.configs)) {
    throw new Error("Invalid config: missing 'configs' array");
  }

  forEachEvent(config, (element, event) => {
    if (event.config?.trim()) {
      const eventType = parseEventType(event.event);
      const actionString = wrapScript(event.config);
      validateActionLength(actionString, element.controlElementNumber, eventType);
    }
  });
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
    let config: ConfigFile;
    let pages: number[];
    try {
      config = await loadConfig(configPath);
      validateConfig(config);
      pages = validatePage(options.page);
    } catch (err) {
      console.error(getErrorMessage(err));
      process.exit(1);
    }

    console.log("Grid CLI - Upload");
    console.log("=================");
    console.log(`Config:  ${path.basename(configPath)}`);
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
  .command("convert")
  .description("Convert Lua config to JSON")
  .argument("<input>", "Path to Lua config file")
  .option("-o, --output <path>", "Output file path (prints to stdout if not specified)")
  .option("--no-minify", "Skip minification (keep human-readable function names)")
  .option("-r, --rename", "Rename user variables/functions to short names")
  .action(async (inputPath: string, options) => {
    const fullPath = path.resolve(inputPath);
    const ext = path.extname(fullPath).toLowerCase();

    if (ext !== ".lua") {
      console.error(`Expected .lua file, got: ${ext}`);
      process.exit(1);
    }

    let config: ConfigFile;
    try {
      config = await loadConfig(inputPath);
    } catch (err) {
      console.error(`Failed to parse Lua config: ${getErrorMessage(err)}`);
      process.exit(1);
    }

    // Apply identifier renaming (before minification)
    if (options.rename) {
      const scriptMap = mapEvents(config, (element, event, index) => ({
        element: element.controlElementNumber,
        event: event.event,
        index,
        script: event.config,
      }));

      const renamed = renameIdentifiers(scriptMap.map((s) => s.script));

      for (const { element, event, index } of scriptMap) {
        const el = config.configs.find((e) => e.controlElementNumber === element);
        const ev = el?.events.find((e) => e.event === event);
        if (ev) {
          ev.config = renamed[index];
        }
      }
    }

    // Apply minification by default
    if (options.minify !== false) {
      forEachEvent(config, (_element, event) => {
        if (event.config) {
          event.config = GridScript.compressScript(event.config);
        }
      });
    }

    const json = JSON.stringify(config, null, 2);

    if (options.output) {
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, json);
      console.error(`Converted: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);
    } else {
      console.log(json);
    }
  });

program
  .command("download")
  .description("Download configuration from Grid device")
  .argument("<output>", "Output JSON file path")
  .option("-p, --port <path>", "Serial port path (auto-detect if not specified)")
  .option("-t, --type <type>", "Device type (EN16, PO16, BU16, EF44, PBF4, TEK2, PB44)", "EN16")
  .option("--page <n>", "Download from specific page (0-3)", (v) => parseInt(v, 10), 0)
  .option("-v, --verbose", "Show detailed progress")
  .action(async (outputPath: string, options) => {
    const deviceType = options.type.toUpperCase();
    const deviceConfig = DEVICE_CONFIG[deviceType];

    if (!deviceConfig) {
      console.error(`Unknown device type: ${deviceType}`);
      console.error(`Supported types: ${Object.keys(DEVICE_CONFIG).join(", ")}`);
      process.exit(1);
    }

    console.log("Grid CLI - Download");
    console.log("===================");
    console.log(`Type:     ${deviceType}`);
    console.log(`Page:     ${options.page}`);
    console.log(`Elements: ${deviceConfig.elements.length}`);
    console.log(`Output:   ${outputPath}`);

    console.log("\nConnecting to Grid device...");
    const portPath = await findDevice(options.port);
    const port = await openPort(portPath);
    console.log("Connected.\n");

    try {
      const { config, failed } = await downloadConfig(port, deviceType, deviceConfig, options.page, options.verbose);

      const fullPath = path.resolve(outputPath);
      fs.writeFileSync(fullPath, JSON.stringify(config, null, 2));

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

program.parse();

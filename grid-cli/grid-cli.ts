#!/usr/bin/env npx tsx
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { loadLuaConfig, renameIdentifiers } from "./lua-loader.js";
import {
  SYSTEM_ELEMENT,
  EVENT_NAMES,
  DEVICE_CONFIG,
  ConfigFile,
  wrapScript,
  unwrapScript,
  validateActionLength,
  countEvents,
  parseEventType,
  validatePage,
  sortElements,
  renderProgress,
  getErrorMessage,
  forEachEvent,
  mapEvents,
} from "./lib.js";
import { GridConnection } from "./connection.js";

// Dynamically import grid-protocol for GridScript (minification)
const gridProtocol = await import("@intechstudio/grid-protocol");
const { GridScript } = gridProtocol;

// =============================================================================
// Config Operations
// =============================================================================

async function uploadConfig(
  conn: GridConnection,
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

        try {
          await conn.uploadScript(pageNum, element.controlElementNumber, eventType, actionString);
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
  conn: GridConnection,
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
    try {
      const actionString = await conn.fetchScript(pageNum, elementNum, eventType);
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
  config.configs = sortElements(
    [...elementConfigs.entries()]
      .map(([elementNum, events]) => ({
        controlElementNumber: elementNum,
        events: [...events.entries()]
          .map(([eventType, script]) => ({ event: eventType, config: script }))
          .sort((a, b) => a.event - b.event),
      }))
      .filter((el) => el.events.length > 0)
  );

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
    const conn = await GridConnection.connect(options.port);
    console.log("Connected.\n");

    try {
      await uploadConfig(conn, config, pages, options.verbose);
      console.log("Upload complete!");
    } finally {
      conn.close();
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
    const conn = await GridConnection.connect(options.port);
    console.log("Connected.\n");

    try {
      const { config, failed } = await downloadConfig(conn, deviceType, deviceConfig, options.page, options.verbose);

      const fullPath = path.resolve(outputPath);
      fs.writeFileSync(fullPath, JSON.stringify(config, null, 2));

      console.log("Download complete!");
      console.log(`Saved to: ${fullPath}`);
      console.log(`Elements: ${config.configs.length}`);

      if (failed.length > 0) {
        console.log(`\nWarning: ${failed.length} fetch(es) failed (empty events are normal)`);
      }
    } finally {
      conn.close();
    }
  });

program.parse();

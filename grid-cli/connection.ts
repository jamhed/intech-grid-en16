/**
 * Grid device connection abstraction.
 */

import { SerialPort } from "serialport";
import { matchesUsbFilter } from "./lib.js";
import {
  buildConfigPacket,
  parseConfigReport,
  hasAcknowledge,
  type Packet,
  type SendOptions,
} from "./protocol/index.js";

const LF = 0x0a;
const SERIAL_BAUD_RATE = 2000000;
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_RETRIES = 2;

/**
 * Encapsulates serial communication with a Grid device.
 */
export class GridConnection {
  private constructor(private port: SerialPort) {}

  /**
   * Find and connect to a Grid device.
   * @param manualPort - Optional manual port path, auto-detects if not provided
   */
  static async connect(manualPort?: string): Promise<GridConnection> {
    const portPath = await findDevice(manualPort);
    const port = await openPort(portPath);
    return new GridConnection(port);
  }

  /**
   * Close the connection.
   */
  close(): void {
    this.port.close();
  }

  /**
   * Send a packet and wait for a response matching the parser.
   */
  async sendAndWait<T>(
    packet: Packet,
    parser: (buffer: Buffer) => T | null,
    options: Partial<SendOptions> = {}
  ): Promise<T> {
    const { timeout = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, debug = false } = options;

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let attempt = 0;
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.port.removeListener("data", onData);
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

        this.port.write(Buffer.from([...packet.serial, LF]));
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

      this.port.on("data", onData);
      sendPacket();
    });
  }

  /**
   * Send a packet and wait for ACKNOWLEDGE response.
   */
  async sendAndWaitAck(packet: Packet, options: Partial<SendOptions> = {}): Promise<void> {
    const { timeout = 1000, retries = 3 } = options;
    await this.sendAndWait(packet, (buf) => (hasAcknowledge(buf) ? true : null), { timeout, retries });
  }

  /**
   * Send a packet and wait for CONFIG REPORT response.
   */
  async sendAndWaitReport(packet: Packet, options: Partial<SendOptions> = {}): Promise<string> {
    const result = await this.sendAndWait(packet, parseConfigReport, options);
    return result.actionString;
  }

  /**
   * Upload a config script to a specific element/event.
   */
  async uploadScript(
    pageNumber: number,
    elementNumber: number,
    eventType: number,
    actionString: string
  ): Promise<void> {
    const packet = buildConfigPacket("EXECUTE", { pageNumber, elementNumber, eventType, actionString });
    await this.sendAndWaitAck(packet);
  }

  /**
   * Fetch a config script from a specific element/event.
   */
  async fetchScript(pageNumber: number, elementNumber: number, eventType: number): Promise<string> {
    const packet = buildConfigPacket("FETCH", { pageNumber, elementNumber, eventType });
    return this.sendAndWaitReport(packet, { timeout: DEFAULT_TIMEOUT_MS, retries: 1 });
  }
}

/**
 * Find a Grid device by scanning USB ports.
 */
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

/**
 * Open a serial port connection.
 */
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

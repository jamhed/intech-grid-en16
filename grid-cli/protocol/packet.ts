/**
 * Grid protocol packet building and parsing.
 */

import type { DecodedFrame, Packet, ConfigParams, ConfigInstruction } from "./types.js";

// Dynamically import grid-protocol
const gridProtocol = await import("@intechstudio/grid-protocol");
const { grid } = gridProtocol;

/** Frame terminator size: EOT byte + 2 checksum bytes */
const FRAME_TERMINATOR_SIZE = 3;

/** Protocol framing constants */
const PROTOCOL_CONST = {
  SOH: parseInt(grid.getProperty("CONST").SOH),
  EOT: parseInt(grid.getProperty("CONST").EOT),
} as const;

/** Protocol version from grid-protocol */
const VERSION = grid.getProperty("VERSION");

/**
 * Build a CONFIG packet for uploading or fetching scripts.
 */
export function buildConfigPacket(instruction: ConfigInstruction, params: ConfigParams): Packet {
  const actionString = params.actionString ?? "";

  const descriptor = {
    brc_parameters: { DX: 0, DY: 0 },
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

/**
 * Parse binary data into decoded frames.
 */
export function parsePacket(data: Buffer): DecodedFrame[] | null {
  const bytes = Array.from(data);

  const start = bytes.indexOf(PROTOCOL_CONST.SOH);
  if (start === -1) return null;

  let end = -1;
  for (let i = start; i < bytes.length - 2; i++) {
    if (bytes[i] === PROTOCOL_CONST.EOT) {
      end = i + FRAME_TERMINATOR_SIZE;
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

/**
 * Parse CONFIG REPORT response and extract action string.
 */
export function parseConfigReport(data: Buffer): { actionString: string } | null {
  const frames = parsePacket(data);
  if (!frames) return null;

  for (const frame of frames) {
    if (frame.class_name === "CONFIG" && frame.class_instr === "REPORT") {
      return { actionString: frame.class_parameters.ACTIONSTRING ?? "" };
    }
  }

  return null;
}

/**
 * Check if response contains an ACKNOWLEDGE frame.
 */
export function hasAcknowledge(data: Buffer): boolean {
  const frames = parsePacket(data);
  if (!frames) return false;
  return frames.some((frame) => frame.class_instr === "ACKNOWLEDGE");
}

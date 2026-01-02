/**
 * Protocol types for Grid device communication.
 */

/** Decoded frame from Grid protocol */
export interface DecodedFrame {
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

/** Encoded packet ready for transmission */
export interface Packet {
  serial: number[];
  id: number;
}

/** Options for send and wait operations */
export interface SendOptions {
  timeout: number;
  retries: number;
  debug?: boolean;
}

/** Parameters for CONFIG packet */
export interface ConfigParams {
  pageNumber: number;
  elementNumber: number;
  eventType: number;
  actionString?: string;
}

/** CONFIG instruction types */
export type ConfigInstruction = "EXECUTE" | "FETCH";

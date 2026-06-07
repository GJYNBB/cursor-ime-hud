import { DetectorLogEntry, ImeSnapshot } from "../model/types";

interface JsonRecord {
  [key: string]: unknown;
}

export const PROTOCOL_VERSION = 1;

export interface HelloMessage {
  type: "hello";
  version: number;
  capabilities: string[];
}

export function parseHelloLine(line: string): HelloMessage | undefined {
  const parsed = parseJsonRecord(line);
  if (!parsed || parsed.type !== "hello") {
    return undefined;
  }

  if (typeof parsed.version !== "number") {
    return undefined;
  }

  const capabilities = Array.isArray(parsed.capabilities)
    ? parsed.capabilities.filter((value): value is string => typeof value === "string")
    : [];

  return {
    type: "hello",
    version: parsed.version,
    capabilities
  };
}

export function parseSnapshotLine(line: string): ImeSnapshot | undefined {
  const parsed = parseJsonRecord(line);
  if (!parsed || parsed.type !== "state") {
    return undefined;
  }

  const state =
    parsed.state === "cn" || parsed.state === "en" || parsed.state === "unknown"
      ? parsed.state
      : "unknown";

  return {
    type: "state",
    state,
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    source: "native-helper",
    imeName: typeof parsed.imeName === "string" ? parsed.imeName : undefined,
    isOpen: typeof parsed.isOpen === "boolean" ? parsed.isOpen : undefined,
    layoutHex: typeof parsed.layoutHex === "string" ? parsed.layoutHex : undefined,
    threadId: typeof parsed.threadId === "number" ? parsed.threadId : undefined,
    hwnd: typeof parsed.hwnd === "string" ? parsed.hwnd : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    rawStateAvailable:
      typeof parsed.rawStateAvailable === "boolean" ? parsed.rawStateAvailable : undefined
  };
}

export function parseLogLine(line: string): DetectorLogEntry | undefined {
  const parsed = parseJsonRecord(line);
  if (!parsed || parsed.type !== "log" || typeof parsed.message !== "string") {
    return undefined;
  }

  return {
    type: "log",
    level: parsed.level === "error" || parsed.level === "warn" ? parsed.level : "info",
    message: parsed.message,
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    details: parsed.details,
    source: typeof parsed.source === "string" ? parsed.source : "native-helper"
  };
}

function parseJsonRecord(line: string): JsonRecord | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as JsonRecord;
  } catch {
    return undefined;
  }
}

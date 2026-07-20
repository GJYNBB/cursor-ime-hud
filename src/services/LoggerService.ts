import * as vscode from "vscode";
import { DetectorLogEntry, LogLevel } from "../model/types";

// Covers a typical "Show Diagnostics" session (user opens output, scrolls
// back through the last few seconds of activity) without unbounded growth.
const MAX_LOG_ENTRIES = 200;

/**
 * Application-level logger that mirrors entries to a VS Code output channel
 * and keeps a bounded in-memory ring buffer (capped at `MAX_LOG_ENTRIES`)
 * for the diagnostics command. Constructed by the composition root with the
 * `vscode.OutputChannel` already created so the service is a pure consumer
 * of the channel and can be unit tested with a fake.
 */
export class LoggerService implements vscode.Disposable {
  private readonly entries: DetectorLogEntry[] = [];

  public constructor(private readonly outputChannel: vscode.OutputChannel) {}

  public info(message: string, details?: unknown): void {
    this.append({
      type: "log",
      level: "info",
      timestamp: new Date().toISOString(),
      message,
      details,
      source: "extension"
    });
  }

  public warn(message: string, details?: unknown): void {
    this.append({
      type: "log",
      level: "warn",
      timestamp: new Date().toISOString(),
      message,
      details,
      source: "extension"
    });
  }

  public error(message: string, details?: unknown): void {
    this.append({
      type: "log",
      level: "error",
      timestamp: new Date().toISOString(),
      message,
      details,
      source: "extension"
    });
  }

  public recordDetectorLog(entry: DetectorLogEntry): void {
    this.append(entry);
  }

  public getRecentEntries(limit = 20): readonly DetectorLogEntry[] {
    return this.entries.slice(-limit);
  }

  public showReport(report: string): void {
    this.outputChannel.clear();
    this.outputChannel.append(report);
    this.outputChannel.show(true);
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }

  private append(entry: DetectorLogEntry): void {
    const safeEntry = this.sanitizeEntry(entry);
    this.entries.push(safeEntry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift();
    }

    this.outputChannel.appendLine(
      this.formatEntry(
        safeEntry.level,
        safeEntry.message,
        safeEntry.details,
        safeEntry.source,
        safeEntry.timestamp
      )
    );
  }

  private sanitizeEntry(entry: DetectorLogEntry): DetectorLogEntry {
    return {
      ...entry,
      message: this.redactPaths(entry.message),
      details: this.sanitizeDetails(entry.details)
    };
  }

  private sanitizeDetails(details: unknown): unknown {
    if (details === undefined || details === null) {
      return details;
    }

    if (typeof details === "string") {
      return this.redactPaths(details);
    }

    if (details instanceof Error) {
      return { name: details.name, message: this.redactPaths(details.message) };
    }

    return this.sanitizeDetailsValue(details, new WeakSet<object>());
  }

  private sanitizeDetailsValue(details: unknown, seen: WeakSet<object>): unknown {
    if (details === undefined || details === null) {
      return details;
    }

    if (typeof details === "string") {
      return this.redactPaths(details);
    }

    if (details instanceof Error) {
      return { name: details.name, message: this.redactPaths(details.message) };
    }

    if (typeof details !== "object") {
      return details;
    }

    if (seen.has(details)) {
      return "[Circular]";
    }
    seen.add(details);

    if (Array.isArray(details)) {
      return details.map((item) => this.sanitizeDetailsValue(item, seen));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (/path/i.test(key) && typeof value === "string") {
        sanitized[key] = "<path>";
      } else {
        sanitized[key] = this.sanitizeDetailsValue(value, seen);
      }
    }
    return sanitized;
  }

  private redactPaths(value: string): string {
    return value
      .replace(/[A-Za-z]:\\[^\r\n"'`<>|]+/g, "<path>")
      .replace(
        /\/(?:Users|home|tmp|var|opt|private|Applications|usr|etc|bin|sbin|lib|mnt|Volumes)\/[^\r\n"'`<>]*/g,
        "<path>"
      );
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    details: unknown,
    source: string | undefined,
    timestamp: string
  ): string {
    const suffix = details === undefined ? "" : ` ${this.formatDetails(details)}`;
    const prefix = source ? `${source}` : "log";
    return `[${timestamp}] [${prefix}] [${level}] ${message}${suffix}`;
  }

  private formatDetails(details: unknown): string {
    if (typeof details === "string") {
      return details;
    }

    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  }
}

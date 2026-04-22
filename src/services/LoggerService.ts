import * as vscode from "vscode";
import { DetectorLogEntry, LogLevel } from "../model/types";

const MAX_LOG_ENTRIES = 200;

export class LoggerService implements vscode.Disposable {
  private readonly outputChannel = vscode.window.createOutputChannel("Cursor IME HUD");
  private readonly entries: DetectorLogEntry[] = [];

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
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift();
    }

    this.outputChannel.appendLine(this.formatEntry(entry.level, entry.message, entry.details, entry.source, entry.timestamp));
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

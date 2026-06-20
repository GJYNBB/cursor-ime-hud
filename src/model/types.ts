/**
 * IME mode the cursor is in. `cn` = Chinese IME active, `en` = Latin
 * (English) IME active, `unknown` = detector cannot tell right now. The
 * `unknown` value is treated specially by the HUD: it triggers the grace
 * period in `HudState.resolveHudDisplayState`.
 */
export type ImeState = "cn" | "en" | "unknown";

/**
 * Where the active snapshot came from. The composition root picks one
 * detector chain; `source` records which one produced the snapshot we are
 * looking at so the diagnostics command can explain fallback decisions.
 */
export type DetectorSource = "sample" | "native-helper" | "fallback";

/** Severity for log entries, mirrors the levels VS Code's output channel understands. */
export type LogLevel = "info" | "warn" | "error";

/**
 * Snapshot of the IME state at a single point in time. Emitted by
 * `ImeDetector` and consumed by `HudController`. `state` is the only
 * field the controller treats as authoritative; everything else is
 * diagnostic metadata.
 */
export interface ImeSnapshot {
  type: "state";
  state: ImeState;
  imeName?: string;
  timestamp: string;
  source: DetectorSource;
  isOpen?: boolean;
  layoutHex?: string;
  threadId?: number;
  hwnd?: string;
  reason?: string;
  confidence?: number;
  rawStateAvailable?: boolean;
}

/**
 * A single log line produced by the detector. The extension-side
 * `LoggerService` records these verbatim and the diagnostics command
 * dumps them as JSON.
 */
export interface DetectorLogEntry {
  type: "log";
  level: LogLevel;
  timestamp: string;
  message: string;
  details?: unknown;
  source?: string;
}

/**
 * The user-configurable HUD settings, after validation. The
 * `SettingsService` is the only producer of this object; consumers
 * should treat it as a plain value object.
 */
export type LabelPreset = "custom" | "zh-en" | "en-zh";

export interface CursorImeHudSettings {
  overlayEnabled: boolean;
  labelPreset: LabelPreset;
  cnLabel: string;
  enLabel: string;
  /** CSS color used for the Chinese-mode label. */
  cnColor: string;
  /** CSS color used for the English-mode label. */
  enColor: string;
  /** Whether the label is drawn with a rounded-rectangle background mask. */
  backgroundEnabled: boolean;
  opacity: number;
  overlayMode: "text" | "text+icon";
  statusBarEnabled: boolean;
  hideWhenEditorUnfocused: boolean;
  offsetX: number;
  offsetY: number;
}

/**
 * Why the HUD is showing a particular snapshot. `direct` = detector
 * reported a real state; `grace-period` = detector is unknown but we
 * still have a recent stable snapshot within the grace window;
 * `unknown` = detector is unknown and we have nothing to show.
 */
export type HudDisplayReason = "direct" | "grace-period" | "unknown";

/**
 * Diagnostic payload returned by `ImeDetector.getDebugInfo`. Used by the
 * "Show Diagnostics" command and by the status-bar tooltip.
 */
export interface ImeDetectorDebugInfo {
  source: DetectorSource;
  backendName: string;
  helperPath?: string;
  usingFallback: boolean;
  fallbackReason?: string;
  lifecycleState?: string;
}

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
  /**
   * Whether the helper reached a platform raw IME signal. False means the
   * snapshot is a controlled fallback/probe result, not necessarily a helper
   * failure; undefined means the detector does not report this capability.
   */
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
export type LabelPreset = "zh-en" | "en-zh";

export interface CursorImeHudSettings {
  overlayEnabled: boolean;
  labelPreset: LabelPreset;
  cnLabel: string;
  enLabel: string;
  /** CSS color used for the Chinese-mode label. */
  cnColor: string;
  /** CSS color used for the English-mode label. */
  enColor: string;
  /** Whether text mode draws a rounded-rectangle background mask. */
  backgroundEnabled: boolean;
  /** Alpha channel used by the icon tile fill or text-mode background mask. */
  backgroundOpacity: number;
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
  helperPathExists?: boolean;
  helperPlatformKey?: string;
  helperSha256Path?: string;
  helperSha256PathExists?: boolean;
  helperHashStatus?:
    | "not-checked"
    | "missing-sidecar"
    | "invalid-sidecar"
    | "match"
    | "mismatch"
    | "error";
  helperProtocolVersion?: number;
  usingFallback: boolean;
  fallbackReason?: string;
  /**
   * When usingFallback is true, whether a user refresh may recreate the native
   * helper (temporary spawn/timeout/protocol failures). Permanent packaging
   * integrity failures leave this false.
   */
  fallbackRecoverable?: boolean;
  /**
   * Lifecycle of the active detector (native helper or sample/fallback).
   * Callers should not treat this as the SampleOrNativeDetector wrapper state.
   */
  lifecycleState?: string;
  /**
   * Lifecycle of the SampleOrNativeDetector wrapper itself (idle/starting/
   * running/disposed). Only set when a wrapper sits above the active detector.
   */
  wrapperLifecycleState?: string;
  /** Number of helper restart failures currently retained in the rolling window. */
  restartAttempts?: number;
  /** True after the helper restart circuit breaker has opened. */
  circuitOpen?: boolean;
}

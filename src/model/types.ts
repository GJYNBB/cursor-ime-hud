export type ImeState = "cn" | "en" | "unknown";

export type DetectorSource = "sample" | "native-helper" | "fallback";

export type LogLevel = "info" | "warn" | "error";

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

export interface DetectorLogEntry {
  type: "log";
  level: LogLevel;
  timestamp: string;
  message: string;
  details?: unknown;
  source?: string;
}

export interface CursorImeHudSettings {
  overlayEnabled: boolean;
  cnLabel: string;
  enLabel: string;
  opacity: number;
  overlayMode: "text" | "text+icon";
  statusBarEnabled: boolean;
  hideWhenEditorUnfocused: boolean;
  offsetX: number;
  offsetY: number;
}

export type HudDisplayReason = "direct" | "grace-period" | "unknown";

export interface ImeDetectorDebugInfo {
  source: DetectorSource;
  backendName: string;
  helperPath?: string;
  usingFallback: boolean;
  fallbackReason?: string;
  lifecycleState?: string;
}

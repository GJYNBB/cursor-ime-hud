import * as vscode from "vscode";
import { HudDisplayReason, ImeState } from "../model/types";

/**
 * Render payload handed to `StatusBarPresenterContract.render`. The presenter
 * does not own IME detection or HUD state — it only formats the data the
 * controller gives it into a status-bar item.
 */
export interface StatusBarRenderInput {
  enabled: boolean;
  /** Whether the caret-adjacent overlay/icon is currently enabled. */
  overlayEnabled: boolean;
  label: string;
  imeName?: string;
  source: string;
  isFallback: boolean;
  detectedState: ImeState;
  displayReason: HudDisplayReason;
  reason?: string;
  confidence?: number;
}

/**
 * Public surface the controller depends on. `StatusBarPresenter` is the
 * default production implementation; tests can supply their own.
 */
export interface StatusBarPresenterContract extends vscode.Disposable {
  render(input: StatusBarRenderInput): void;
}

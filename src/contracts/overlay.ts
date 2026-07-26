import * as vscode from "vscode";
import { CursorImeHudSettings, ImeState } from "../model/types";

/**
 * Where a decoration should be attached and which character range it
 * covers. The renderer treats the range as a zero-width caret anchor and
 * paints the HUD attachment after that anchor.
 */
export interface OverlayPlacement {
  /** Document range the decoration is anchored to. */
  range: vscode.Range;
  /** Side of the range the decoration renders on. */
  attachment: "before" | "after";
}

/**
 * The payload that a `ContentProvider` produces for a given overlay render.
 * Providers decide the text/tooltip content; `CursorOverlayRenderer` still owns
 * the mode-specific attachment styling and placement.
 */
export interface OverlayContent {
  /** Text that should appear inside the decoration chip. */
  contentText: string;
  /** Optional tooltip text to surface when the user hovers the chip. */
  hoverMessage?: vscode.MarkdownString | vscode.MarkdownString[];
  /** Free-form passthrough that advanced renderers can attach decoration data to. */
  extras?: Record<string, unknown>;
}

/**
 * Render input handed to the renderer. This is the same shape that
 * `CursorOverlayRenderer` has historically accepted, lifted to a contract so
 * the renderer is no longer the only place the shape is defined.
 */
export interface OverlayRenderInput {
  editor: vscode.TextEditor;
  label: string;
  settings: CursorImeHudSettings;
  placement: OverlayPlacement;
  /**
   * IME state the label represents. Drives the per-state label color and lets
   * icon mode suppress stale caller-supplied text for unknown states.
   */
  state: ImeState;
}

/**
 * Pluggable content strategy. Providers can normalize the displayed text for a
 * mode (for example, `text+icon` suppresses unknown-state text), while
 * `CursorOverlayRenderer` owns the visual style for each mode.
 */
export interface ContentProvider {
  /**
   * Resolve the content to display for the given render state. The
   * `placement` is supplied so providers that need it (e.g. for alignment
   * heuristics) can read the attachment side without an extra call.
   */
  resolveContent(input: OverlayRenderInput, label: string): OverlayContent;
}

/**
 * Abstraction over the render surface. Implemented by `CursorOverlayRenderer`
 * so the controller and tests can depend on the contract instead of the
 * concrete class. The `getStyleKey` method exists so the controller can
 * short-circuit renders when only transient selection/visible-range events
 * fire and the style has not actually changed.
 */
export interface OverlayRenderer extends vscode.Disposable {
  /** A stable hash of the visual style. Used to skip no-op renders. */
  getStyleKey(settings: CursorImeHudSettings): string;
  /** Resolve where the decoration should be placed for the given editor. */
  resolvePlacement(editor: vscode.TextEditor): OverlayPlacement | undefined;
  /** Apply a render. Implementations are expected to be idempotent. */
  render(input: OverlayRenderInput): void;
  /** Remove the active render from every editor that ever saw it. */
  clearCurrentRender(): void;
}

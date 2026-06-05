import * as vscode from "vscode";
import { CursorImeHudSettings } from "../model/types";
import { OverlayPlacement } from "./PositionStrategy";

/**
 * The payload that any concrete `ContentProvider` must produce for a given
 * overlay render. Keeping the content as a plain data object (rather than a
 * fully-realized decoration) lets new rendering modes (icons, mixed text+icon,
 * or completely new visualizations) be added without modifying the
 * `CursorOverlayRenderer` class itself.
 */
export interface OverlayContent {
  /** Text that should appear inside the decoration chip. */
  contentText: string;
  /**
   * Optional margin override (in pixels) applied on top of the user's
   * `offsetX` / `offsetY` settings. Useful for icon-first renderers that need
   * extra breathing room around the cursor.
   */
  margin?: string;
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
}

/**
 * Pluggable content strategy. A new overlay mode (e.g. an icon provider, a
 * mixed text+icon provider, or a non-Latin provider) only needs to implement
 * this interface and be passed into `CursorOverlayRenderer` — the renderer
 * class itself does not need to be edited. See `TextContentProvider` for the
 * default text-only behavior that preserves the original visual design.
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
 * Default content provider. Mirrors the historical text-only HUD: returns the
 * supplied `label` as `contentText` and does not touch margins or tooltips.
 * New modes should compose with (or replace) this provider rather than
 * editing `CursorOverlayRenderer`.
 */
export class TextContentProvider implements ContentProvider {
  public resolveContent(_input: OverlayRenderInput, label: string): OverlayContent {
    return { contentText: label };
  }
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

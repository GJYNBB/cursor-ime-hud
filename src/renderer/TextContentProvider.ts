import { ContentProvider, OverlayContent, OverlayRenderInput } from "../contracts/overlay";

/**
 * Default content provider. Mirrors the historical text-only HUD: returns the
 * supplied `label` as `contentText` and does not touch margins or tooltips.
 * New modes should compose with (or replace) this provider rather than
 * editing `CursorOverlayRenderer`.
 */
export class TextContentProvider implements ContentProvider {
  public resolveContent(input: OverlayRenderInput, label: string): OverlayContent {
    if (input.settings.overlayMode === "text+icon" && input.state === "unknown") {
      return { contentText: "" };
    }

    return { contentText: label };
  }
}

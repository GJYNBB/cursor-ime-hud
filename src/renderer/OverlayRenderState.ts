import { OverlayPlacement } from "./PositionStrategy";

/**
 * Compact value-object that describes everything that can change about the
 * HUD overlay. The controller compares successive instances to skip
 * no-op renders and to decide whether to call `clearCurrentRender`.
 */
export interface OverlayRenderState {
  /** Document URI of the editor being rendered into, or `null` if none. */
  editorUri: string | null;
  /** Label string the renderer is currently showing, or `null` if hidden. */
  label: string | null;
  /** Whether the overlay is currently visible. */
  visible: boolean;
  /** Hash of the current visual style; see `OverlayRenderer.getStyleKey`. */
  styleKey: string;
  /**
   * Stable key for the placement. Two different `OverlayPlacement`
   * objects with the same attachment + range collapse to the same key so
   * transient jitter in the resolved range does not re-trigger a render.
   */
  placementKey: string | null;
}

interface CreateOverlayRenderStateInput {
  editorUri: string | null;
  label: string | null;
  visible: boolean;
  styleKey: string;
  placement?: OverlayPlacement;
}

/**
 * Build an `OverlayRenderState` from the controller's render input. The
 * placement, when supplied, is collapsed into a string key via
 * `getOverlayPlacementKey` so callers do not have to keep the original
 * `vscode.Range` object around for equality checks.
 */
export function createOverlayRenderState(input: CreateOverlayRenderStateInput): OverlayRenderState {
  return {
    editorUri: input.editorUri,
    label: input.label,
    visible: input.visible,
    styleKey: input.styleKey,
    placementKey: input.placement ? getOverlayPlacementKey(input.placement) : null
  };
}

/**
 * Structural equality for `OverlayRenderState`. `undefined` arguments are
 * treated as "no prior state" so the first render after construction
 * always counts as a change.
 */
export function overlayRenderStateEquals(
  left: OverlayRenderState | undefined,
  right: OverlayRenderState | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.editorUri === right.editorUri &&
    left.label === right.label &&
    left.visible === right.visible &&
    left.styleKey === right.styleKey &&
    left.placementKey === right.placementKey
  );
}

/**
 * Serialize a placement into a stable string key. Used so the controller
 * can compare successive placements without retaining the original
 * `vscode.Range` object across renders.
 */
export function getOverlayPlacementKey(placement: OverlayPlacement): string {
  return [
    placement.attachment,
    placement.range.start.line,
    placement.range.start.character,
    placement.range.end.line,
    placement.range.end.character
  ].join(":");
}

import { OverlayPlacement } from "./PositionStrategy";

export interface OverlayRenderState {
  editorUri: string | null;
  label: string | null;
  visible: boolean;
  styleKey: string;
  placementKey: string | null;
}

interface CreateOverlayRenderStateInput {
  editorUri: string | null;
  label: string | null;
  visible: boolean;
  styleKey: string;
  placement?: OverlayPlacement;
}

export function createOverlayRenderState(input: CreateOverlayRenderStateInput): OverlayRenderState {
  return {
    editorUri: input.editorUri,
    label: input.label,
    visible: input.visible,
    styleKey: input.styleKey,
    placementKey: input.placement ? getOverlayPlacementKey(input.placement) : null
  };
}

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

export function getOverlayPlacementKey(placement: OverlayPlacement): string {
  return [
    placement.attachment,
    placement.range.start.line,
    placement.range.start.character,
    placement.range.end.line,
    placement.range.end.character
  ].join(":");
}

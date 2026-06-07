import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  createOverlayRenderState,
  getOverlayPlacementKey,
  overlayRenderStateEquals
} from "../../renderer/OverlayRenderState";

suite("OverlayRenderState", () => {
  test("treats identical render states as equal", () => {
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 1)
    };

    const left = createOverlayRenderState({
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      visible: true,
      styleKey: "style",
      placement
    });
    const right = createOverlayRenderState({
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      visible: true,
      styleKey: "style",
      placement
    });

    assert.equal(overlayRenderStateEquals(left, right), true);
  });

  test("detects label and placement changes", () => {
    const beforePlacement = {
      attachment: "before" as const,
      range: new vscode.Range(0, 0, 0, 1)
    };
    const afterPlacement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 1)
    };

    const left = createOverlayRenderState({
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      visible: true,
      styleKey: "style",
      placement: beforePlacement
    });
    const right = createOverlayRenderState({
      editorUri: "file:///a.ts",
      label: "\u82f1",
      visible: true,
      styleKey: "style",
      placement: afterPlacement
    });

    assert.equal(overlayRenderStateEquals(left, right), false);
    assert.notEqual(
      getOverlayPlacementKey(beforePlacement),
      getOverlayPlacementKey(afterPlacement)
    );
  });
});

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
      editorId: 1,
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      state: "cn",
      visible: true,
      styleKey: "style",
      placement
    });
    const right = createOverlayRenderState({
      editorId: 1,
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      state: "cn",
      visible: true,
      styleKey: "style",
      placement
    });

    assert.equal(overlayRenderStateEquals(left, right), true);
  });

  test("detects editor instance changes even when the URI is the same", () => {
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 1)
    };

    const left = createOverlayRenderState({
      editorId: 1,
      editorUri: "file:///a.ts",
      label: "中",
      state: "cn",
      visible: true,
      styleKey: "style",
      placement
    });
    const right = createOverlayRenderState({
      editorId: 2,
      editorUri: "file:///a.ts",
      label: "中",
      state: "cn",
      visible: true,
      styleKey: "style",
      placement
    });

    assert.equal(overlayRenderStateEquals(left, right), false);
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
      editorId: 1,
      editorUri: "file:///a.ts",
      label: "\u4e2d",
      state: "cn",
      visible: true,
      styleKey: "style",
      placement: beforePlacement
    });
    const right = createOverlayRenderState({
      editorId: 1,
      editorUri: "file:///a.ts",
      label: "\u82f1",
      state: "en",
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

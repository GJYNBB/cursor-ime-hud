import * as assert from "node:assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { CursorImeHudSettings } from "../../model/types";
import { CursorOverlayRenderer } from "../../renderer/CursorOverlayRenderer";
import { PositionStrategy } from "../../renderer/PositionStrategy";

suite("CursorOverlayRenderer", () => {
  let createDecorationTypeStub: sinon.SinonStub;
  let setDecorationsSpy: sinon.SinonSpy;

  function buildSettings(overrides: Partial<CursorImeHudSettings> = {}): CursorImeHudSettings {
    return {
      overlayEnabled: true,
      labelPreset: "custom",
      cnLabel: "中",
      enLabel: "英",
      cnColor: "#4FA6FF",
      enColor: "#FF6B6B",
      backgroundEnabled: true,
      backgroundOpacity: 0.72,
      opacity: 0.78,
      overlayMode: "text",
      statusBarEnabled: true,
      hideWhenEditorUnfocused: false,
      offsetX: 6,
      offsetY: 20,
      ...overrides
    };
  }

  function buildEditor(): vscode.TextEditor {
    const document = {
      uri: vscode.Uri.parse("file:///cursor-overlay-renderer.test.ts")
    } as vscode.TextDocument;

    return {
      document,
      selection: {
        active: new vscode.Position(0, 0),
        anchor: new vscode.Position(0, 0),
        activeSelection: new vscode.Selection(0, 0, 0, 0),
        isEmpty: true,
        start: new vscode.Position(0, 0),
        end: new vscode.Position(0, 0)
      } as unknown as vscode.Selection,
      setDecorations: setDecorationsSpy,
      revealRange: () => undefined,
      edit: async () => true,
      insertSnippet: async () => true,
      options: {},
      viewColumn: vscode.ViewColumn.One,
      documentColumn: vscode.ViewColumn.One,
      visibleRanges: [new vscode.Range(0, 0, 0, 0)],
      selections: [new vscode.Selection(0, 0, 0, 0)],
      show: async () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
      id: "cursor-overlay-renderer-test"
    } as unknown as vscode.TextEditor;
  }

  setup(() => {
    setDecorationsSpy = sinon.spy();
    const windowWithDecorationType = vscode.window as unknown as {
      createTextEditorDecorationType: (
        options: vscode.DecorationRenderOptions
      ) => vscode.TextEditorDecorationType;
    };
    createDecorationTypeStub = sinon.stub(
      windowWithDecorationType,
      "createTextEditorDecorationType"
    );
    createDecorationTypeStub.callsFake(() => {
      return { dispose: () => undefined } as vscode.TextEditorDecorationType;
    });
  });

  teardown(() => {
    sinon.restore();
  });

  test("renders a rounded background mask by default", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "中",
      settings: buildSettings(),
      placement,
      state: "cn"
    });

    assert.equal(
      createDecorationTypeStub.callCount,
      2,
      "renderer should create before/after types once"
    );
    const beforeOptions = createDecorationTypeStub.firstCall
      .args[0] as vscode.DecorationRenderOptions;
    const afterOptions = createDecorationTypeStub.secondCall
      .args[0] as vscode.DecorationRenderOptions;

    for (const attachment of [beforeOptions.before, afterOptions.after]) {
      assert.ok(attachment, "attachment styles should exist");
      assert.equal(
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).backgroundColor,
        "rgba(17, 24, 39, 0.72)"
      );
      assert.equal(
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).border,
        "1px solid rgba(255, 255, 255, 0.16)"
      );
      const textDecoration =
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).textDecoration ?? "";
      assert.ok(textDecoration.includes("position: absolute"));
      assert.ok(textDecoration.includes("transform: translate(6px, 20px)"));
      assert.ok(textDecoration.includes("pointer-events: none"));
      assert.ok(textDecoration.includes("white-space: nowrap"));
      assert.ok(textDecoration.includes("opacity: 0.78"));
      assert.ok(textDecoration.includes("line-height: 1"));
      assert.ok(textDecoration.includes("padding: 0 2px"));
      assert.ok(textDecoration.includes("border-radius: 3px"));
    }

    assert.equal(setDecorationsSpy.callCount, 2);
    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].renderOptions?.after?.contentText, "中");
    assert.equal(rendered[0].renderOptions?.after?.color, "#4FA6FF");
  });

  test("applies offsets with transform instead of attachment margin", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "中",
      settings: buildSettings({ offsetX: 3, offsetY: 12 }),
      placement,
      state: "cn"
    });

    const afterOptions = createDecorationTypeStub.secondCall
      .args[0] as vscode.DecorationRenderOptions;
    const attachment = afterOptions.after as vscode.ThemableDecorationAttachmentRenderOptions;
    const textDecoration = attachment.textDecoration ?? "";

    assert.ok(textDecoration.includes("transform: translate(3px, 12px)"));
    assert.equal(attachment.margin, undefined);
  });

  test("uses the configured background mask opacity", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "中",
      settings: buildSettings({ backgroundOpacity: 0.35 }),
      placement,
      state: "cn"
    });

    const afterOptions = createDecorationTypeStub.secondCall
      .args[0] as vscode.DecorationRenderOptions;
    assert.equal(
      afterOptions.after?.backgroundColor,
      "rgba(17, 24, 39, 0.35)",
      "background opacity should control only the mask alpha"
    );
  });

  test("renders bare text when the background mask is disabled", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "中",
      settings: buildSettings({ backgroundEnabled: false }),
      placement,
      state: "cn"
    });

    const beforeOptions = createDecorationTypeStub.firstCall
      .args[0] as vscode.DecorationRenderOptions;
    const afterOptions = createDecorationTypeStub.secondCall
      .args[0] as vscode.DecorationRenderOptions;

    for (const attachment of [beforeOptions.before, afterOptions.after]) {
      assert.ok(attachment, "attachment styles should exist");
      assert.equal(
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).backgroundColor,
        undefined
      );
      assert.equal(
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).border,
        undefined
      );
      const textDecoration =
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).textDecoration ?? "";
      assert.ok(!textDecoration.includes("padding:"));
      assert.ok(!textDecoration.includes("border-radius"));
    }
  });

  test("applies different colors for cn and en states without rebuilding styles", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };
    const settings = buildSettings();

    renderer.render({
      editor,
      label: "中",
      settings,
      placement,
      state: "cn"
    });
    renderer.render({
      editor,
      label: "英",
      settings,
      placement,
      state: "en"
    });

    assert.equal(
      createDecorationTypeStub.callCount,
      2,
      "state-only changes should reuse cached decoration types"
    );
    assert.equal(setDecorationsSpy.callCount, 4);

    const cnRendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    const enRendered = setDecorationsSpy.getCall(3).args[1] as vscode.DecorationOptions[];

    assert.equal(cnRendered[0].renderOptions?.after?.color, "#4FA6FF");
    assert.equal(enRendered[0].renderOptions?.after?.color, "#FF6B6B");
    assert.equal(cnRendered[0].renderOptions?.after?.contentText, "中");
    assert.equal(enRendered[0].renderOptions?.after?.contentText, "英");
  });

  test("includes visual style settings in the style key", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const base = buildSettings();
    const cnChanged = buildSettings({ cnColor: "#123456" });
    const enChanged = buildSettings({ enColor: "#abcdef" });
    const backgroundChanged = buildSettings({ backgroundEnabled: false });
    const backgroundOpacityChanged = buildSettings({ backgroundOpacity: 0.35 });

    assert.notEqual(renderer.getStyleKey(base), renderer.getStyleKey(cnChanged));
    assert.notEqual(renderer.getStyleKey(base), renderer.getStyleKey(enChanged));
    assert.notEqual(renderer.getStyleKey(base), renderer.getStyleKey(backgroundChanged));
    assert.notEqual(renderer.getStyleKey(base), renderer.getStyleKey(backgroundOpacityChanged));
  });
});

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
      labelPreset: "zh-en",
      cnLabel: "中",
      enLabel: "英",
      cnColor: "#FF5252",
      enColor: "#1E90FF",
      backgroundEnabled: true,
      backgroundOpacity: 0.72,
      opacity: 0.78,
      overlayMode: "text+icon",
      statusBarEnabled: true,
      hideWhenEditorUnfocused: false,
      offsetX: 6,
      offsetY: 20,
      ...overrides
    };
  }

  function buildEditor(
    uri = "file:///cursor-overlay-renderer.test.ts",
    decorationsSpy: sinon.SinonSpy = setDecorationsSpy
  ): vscode.TextEditor {
    const document = {
      uri: vscode.Uri.parse(uri)
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
      setDecorations: decorationsSpy,
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

  function expectedHudEm(offsetPxAtDefaultZoom: number): string {
    const defaultEditorFontSizePx = 14;
    const hudFontScale = 0.85;

    return `${(offsetPxAtDefaultZoom / (defaultEditorFontSizePx * hudFontScale)).toFixed(4)}em`;
  }

  function expectedTranslate(offsetX: number, offsetY: number): string {
    return `transform: translate(${expectedHudEm(offsetX)}, ${expectedHudEm(offsetY)})`;
  }

  function assertNoPixelTranslate(textDecoration: string): void {
    assert.ok(!/transform:\s*[^;]*\d(?:\.\d+)?px(?:\b|[, )])/.test(textDecoration));
  }

  function afterAttachmentFromDecorationCall(
    call: sinon.SinonSpyCall
  ): vscode.ThemableDecorationAttachmentRenderOptions {
    const options = call.args[0] as vscode.DecorationRenderOptions;
    assert.ok(options.after, "after attachment styles should exist");
    return options.after as vscode.ThemableDecorationAttachmentRenderOptions;
  }

  function renderAndGetAfterTextDecoration(
    renderer: CursorOverlayRenderer,
    editor: vscode.TextEditor,
    placement: { attachment: "after"; range: vscode.Range },
    settings: CursorImeHudSettings
  ): string {
    const initialCallCount = createDecorationTypeStub.callCount;

    renderer.render({
      editor,
      label: "中",
      settings,
      placement,
      state: "cn"
    });

    const afterDecorationCall = createDecorationTypeStub
      .getCalls()
      .slice(initialCallCount)
      .find((call) => (call.args[0] as vscode.DecorationRenderOptions).after !== undefined);

    assert.ok(afterDecorationCall, "render should create after attachment styles");
    const afterAttachment = afterAttachmentFromDecorationCall(afterDecorationCall);
    return afterAttachment.textDecoration ?? "";
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

  test("renders a square icon tile by default", () => {
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
      const textDecoration =
        (attachment as vscode.ThemableDecorationAttachmentRenderOptions).textDecoration ?? "";
      assert.ok(textDecoration.includes("display: inline-flex"));
      assert.ok(textDecoration.includes("min-width: 1.34em"));
      assert.ok(textDecoration.includes("height: 1.34em"));
      assert.ok(textDecoration.includes("padding: 0 0.16em"));
      assert.ok(textDecoration.includes("border-radius: 0.26em"));
      assert.ok(textDecoration.includes("position: absolute"));
      assert.ok(textDecoration.includes(expectedTranslate(6, 20)));
      assert.ok(textDecoration.includes("pointer-events: none"));
      assert.ok(textDecoration.includes("white-space: nowrap"));
      assert.ok(textDecoration.includes("opacity: 0.78"));
      assert.ok(textDecoration.includes("line-height: 1"));
      assert.ok(textDecoration.includes("box-shadow:"));
    }

    assert.equal(setDecorationsSpy.callCount, 2);
    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].renderOptions?.after?.contentText, "中");
    assert.equal(rendered[0].renderOptions?.after?.color, "#F7FAFC");
    assert.equal(rendered[0].renderOptions?.after?.backgroundColor, "rgba(255, 82, 82, 0.72)");
    assert.equal(rendered[0].renderOptions?.after?.border, "1px solid rgba(255, 82, 82, 0.62)");
  });

  test("clears the previous split editor when rendering the same document URI", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const firstEditorSpy = sinon.spy();
    const secondEditorSpy = sinon.spy();
    const firstEditor = buildEditor("file:///same.ts", firstEditorSpy);
    const secondEditor = buildEditor("file:///same.ts", secondEditorSpy);
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor: firstEditor,
      label: "中",
      settings: buildSettings(),
      placement,
      state: "cn"
    });
    renderer.render({
      editor: secondEditor,
      label: "英",
      settings: buildSettings(),
      placement,
      state: "en"
    });

    assert.ok(
      firstEditorSpy.calledWith(sinon.match.any, []),
      "previous split editor should be cleared even when the URI matches"
    );
    const secondRenderCall = secondEditorSpy
      .getCalls()
      .find((call) => (call.args[1] as vscode.DecorationOptions[]).length === 1);
    assert.ok(secondRenderCall, "new split editor should receive a visible decoration");
  });

  test("keeps the current editor cached after clearing a prior render", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const firstEditorSpy = sinon.spy();
    const secondEditorSpy = sinon.spy();
    const firstEditor = buildEditor("file:///first.ts", firstEditorSpy);
    const secondEditor = buildEditor("file:///second.ts", secondEditorSpy);
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor: firstEditor,
      label: "中",
      settings: buildSettings(),
      placement,
      state: "cn"
    });
    renderer.render({
      editor: secondEditor,
      label: "英",
      settings: buildSettings(),
      placement,
      state: "en"
    });

    const visibleEditorsStub = sinon.stub(vscode.window, "visibleTextEditors").get(() => []);
    renderer.clearCurrentRender();
    visibleEditorsStub.restore();

    assert.ok(
      secondEditorSpy.calledWith(sinon.match.any, []),
      "current editor should still be scrubbed after it leaves visibleTextEditors"
    );
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

    assert.ok(textDecoration.includes(expectedTranslate(3, 12)));
    assertNoPixelTranslate(textDecoration);
    assert.equal(attachment.margin, undefined);
  });

  test("scales zero, negative, and boundary offsets as em values", () => {
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };
    const cases = [
      { offsetX: -50, offsetY: -50 },
      { offsetX: 50, offsetY: 50 }
    ];

    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();

    for (const { offsetX, offsetY } of cases) {
      const textDecoration = renderAndGetAfterTextDecoration(
        renderer,
        editor,
        placement,
        buildSettings({ offsetX, offsetY })
      );

      assert.ok(textDecoration.includes(expectedTranslate(offsetX, offsetY)));
      assertNoPixelTranslate(textDecoration);
    }
  });

  test("uses preset labels in icon mode", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };
    const settings = buildSettings({ labelPreset: "en-zh", cnLabel: "ZH", enLabel: "EN" });

    renderer.render({
      editor,
      label: settings.cnLabel,
      settings,
      placement,
      state: "cn"
    });
    renderer.render({
      editor,
      label: settings.enLabel,
      settings,
      placement,
      state: "en"
    });

    const cnRendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    const enRendered = setDecorationsSpy.getCall(3).args[1] as vscode.DecorationOptions[];
    assert.equal(cnRendered[0].renderOptions?.after?.contentText, "ZH");
    assert.equal(enRendered[0].renderOptions?.after?.contentText, "EN");
  });

  test("does not fall back to configured labels for unknown icon state", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };
    const settings = buildSettings();

    renderer.render({
      editor,
      label: settings.cnLabel,
      settings,
      placement,
      state: "unknown"
    });

    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(rendered[0].renderOptions?.after?.contentText, "");
  });

  test("keeps preset labels in text mode", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };
    const settings = buildSettings({
      overlayMode: "text",
      labelPreset: "en-zh",
      cnLabel: "ZH",
      enLabel: "EN"
    });

    renderer.render({
      editor,
      label: settings.cnLabel,
      settings,
      placement,
      state: "cn"
    });

    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(rendered[0].renderOptions?.after?.contentText, "ZH");
  });

  test("keeps non-rgb CSS colors in icon mode", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "英",
      settings: buildSettings({ enColor: "tomato", backgroundOpacity: 0.5 }),
      placement,
      state: "en"
    });

    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(
      rendered[0].renderOptions?.after?.backgroundColor,
      "color-mix(in srgb, tomato 50%, transparent)"
    );
    assert.equal(
      rendered[0].renderOptions?.after?.border,
      "1px solid color-mix(in srgb, tomato 62%, transparent)"
    );
  });

  test("uses the configured icon tile fill opacity", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "英",
      settings: buildSettings({ backgroundOpacity: 1 }),
      placement,
      state: "en"
    });

    const rendered = setDecorationsSpy.secondCall.args[1] as vscode.DecorationOptions[];
    assert.equal(
      rendered[0].renderOptions?.after?.backgroundColor,
      "rgba(30, 144, 255, 1.00)",
      "background opacity should control the icon tile fill alpha"
    );
  });

  test("uses the configured text-mode background mask opacity", () => {
    const renderer = new CursorOverlayRenderer(new PositionStrategy());
    const editor = buildEditor();
    const placement = {
      attachment: "after" as const,
      range: new vscode.Range(0, 0, 0, 0)
    };

    renderer.render({
      editor,
      label: "中",
      settings: buildSettings({ overlayMode: "text", backgroundOpacity: 0.35 }),
      placement,
      state: "cn"
    });

    const afterOptions = createDecorationTypeStub.secondCall
      .args[0] as vscode.DecorationRenderOptions;
    assert.equal(
      afterOptions.after?.backgroundColor,
      "rgba(17, 24, 39, 0.35)",
      "background opacity should control the text-mode mask alpha"
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
      settings: buildSettings({ overlayMode: "text", backgroundEnabled: false }),
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

    assert.equal(cnRendered[0].renderOptions?.after?.color, "#F7FAFC");
    assert.equal(enRendered[0].renderOptions?.after?.color, "#F7FAFC");
    assert.equal(cnRendered[0].renderOptions?.after?.backgroundColor, "rgba(255, 82, 82, 0.72)");
    assert.equal(enRendered[0].renderOptions?.after?.backgroundColor, "rgba(30, 144, 255, 0.72)");
    assert.equal(cnRendered[0].renderOptions?.after?.border, "1px solid rgba(255, 82, 82, 0.62)");
    assert.equal(enRendered[0].renderOptions?.after?.border, "1px solid rgba(30, 144, 255, 0.62)");
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

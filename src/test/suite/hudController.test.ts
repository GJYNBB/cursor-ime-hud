import * as assert from "node:assert";
import * as vscode from "vscode";
import { HudController } from "../../controller/HudController";
import { UNKNOWN_GRACE_PERIOD_MS } from "../../controller/HudState";
import { ImeDetector } from "../../detector/ImeDetector";
import { DetectorLogEntry, ImeSnapshot } from "../../model/types";
import { OverlayRenderer } from "../../renderer/CursorOverlayRenderer";
import { OverlayPlacement } from "../../renderer/PositionStrategy";

class TestDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  private snapshot: ImeSnapshot;

  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;
  public readonly onDidLog = this.logEmitter.event;

  public constructor(initialSnapshot: ImeSnapshot) {
    this.snapshot = initialSnapshot;
  }

  public async start(): Promise<void> {
    this.snapshotEmitter.fire(this.snapshot);
  }

  public refresh(): void {
    this.snapshotEmitter.fire(this.snapshot);
  }

  public getSnapshot(): ImeSnapshot {
    return this.snapshot;
  }

  public getDebugInfo() {
    return {
      source: "fallback" as const,
      backendName: "TestDetector",
      usingFallback: true,
      fallbackReason: "test",
      lifecycleState: "running"
    };
  }

  public emitSnapshot(snapshot: ImeSnapshot): void {
    this.snapshot = snapshot;
    this.snapshotEmitter.fire(snapshot);
  }

  public dispose(): void {
    this.snapshotEmitter.dispose();
    this.logEmitter.dispose();
  }
}

class FakeOverlayRenderer implements OverlayRenderer {
  public renderCalls = 0;
  public clearCalls = 0;
  public lastLabel?: string;

  public getStyleKey(): string {
    return "style";
  }

  public resolvePlacement(editor: vscode.TextEditor): OverlayPlacement {
    return {
      attachment: "after",
      range: new vscode.Range(editor.selection.active, editor.selection.active.translate(0, 1))
    };
  }

  public render(input: { label: string }): void {
    this.renderCalls += 1;
    this.lastLabel = input.label;
  }

  public clearCurrentRender(): void {
    this.clearCalls += 1;
  }

  public dispose(): void {
    // no-op
  }
}

class FakeStatusBarPresenter {
  public renderCalls = 0;
  public lastInput?: {
    label: string;
    displayReason: string;
    detectedState: string;
  };

  public render(input: { label: string; displayReason: string; detectedState: string }): void {
    this.renderCalls += 1;
    this.lastInput = input;
  }

  public dispose(): void {
    // no-op
  }
}

suite("HudController", () => {
  async function showTestDocument(content = "abc"): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({ content });
    return vscode.window.showTextDocument(document);
  }

  function createUnknownSnapshot(reason = "unknown"): ImeSnapshot {
    return {
      type: "state",
      state: "unknown",
      timestamp: new Date().toISOString(),
      source: "fallback",
      reason,
      confidence: 0,
      rawStateAvailable: false
    };
  }

  function createStableSnapshot(state: "cn" | "en"): ImeSnapshot {
    return {
      type: "state",
      state,
      timestamp: new Date().toISOString(),
      source: "native-helper",
      reason: `stable-${state}`,
      confidence: 1,
      rawStateAvailable: true
    };
  }

  test("hides overlay and shows ? in the status bar when state is unknown", async () => {
    await showTestDocument();
    const detector = new TestDetector(createUnknownSnapshot("probe-unknown"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const controller = new HudController({
      detector,
      settingsService: {
        onDidChange: new vscode.EventEmitter<unknown>().event,
        getSettings: () => ({
          overlayEnabled: true,
          cnLabel: "\u4e2d",
          enLabel: "\u82f1",
          opacity: 0.78,
          overlayMode: "text" as const,
          statusBarEnabled: true,
          hideWhenEditorUnfocused: false,
          offsetX: 6,
          offsetY: 0
        }),
        getLabelForState: (state: "cn" | "en" | "unknown") => (state === "cn" ? "\u4e2d" : state === "en" ? "\u82f1" : undefined),
        toggleOverlay: async () => undefined,
        dispose: () => undefined
      } as never,
      logger: {
        info: () => undefined,
        recordDetectorLog: () => undefined,
        getRecentEntries: () => [],
        showReport: () => undefined
      } as never,
      overlayRenderer,
      statusBarPresenter: statusBarPresenter as never
    });

    await controller.start();

    assert.equal(overlayRenderer.renderCalls, 0);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
  });

  test("uses a short grace window for unknown before clearing the overlay", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const controller = new HudController({
      detector,
      settingsService: {
        onDidChange: new vscode.EventEmitter<unknown>().event,
        getSettings: () => ({
          overlayEnabled: true,
          cnLabel: "\u4e2d",
          enLabel: "\u82f1",
          opacity: 0.78,
          overlayMode: "text" as const,
          statusBarEnabled: true,
          hideWhenEditorUnfocused: false,
          offsetX: 6,
          offsetY: 0
        }),
        getLabelForState: (state: "cn" | "en" | "unknown") => (state === "cn" ? "\u4e2d" : state === "en" ? "\u82f1" : undefined),
        toggleOverlay: async () => undefined,
        dispose: () => undefined
      } as never,
      logger: {
        info: () => undefined,
        recordDetectorLog: () => undefined,
        getRecentEntries: () => [],
        showReport: () => undefined
      } as never,
      overlayRenderer,
      statusBarPresenter: statusBarPresenter as never
    });

    await controller.start();
    assert.equal(overlayRenderer.renderCalls, 1);
    assert.equal(statusBarPresenter.lastInput?.label, "\u4e2d");

    detector.emitSnapshot(createUnknownSnapshot("temporary-unknown"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(overlayRenderer.renderCalls, 1, "grace-period state should not trigger a redundant render");
    assert.equal(statusBarPresenter.lastInput?.label, "\u4e2d");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "grace-period");

    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_GRACE_PERIOD_MS + 80));

    assert.equal(overlayRenderer.clearCalls, 1);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
  });
});

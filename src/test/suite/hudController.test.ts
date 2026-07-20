import * as assert from "node:assert";
import * as sinon from "sinon";
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
      helperPath: "/Users/secret/project/resources/bin/win32-x64/ImeWatcher.exe",
      helperPathExists: true,
      helperPlatformKey: "win-x64",
      helperSha256Path: "/Users/secret/project/resources/bin/win32-x64/ImeWatcher.exe.sha256",
      helperSha256PathExists: true,
      helperHashStatus: "match" as const,
      helperProtocolVersion: 1,
      usingFallback: true,
      fallbackReason: "test /Users/secret/project/native-helper",
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
  public styleKey = "style";

  public getStyleKey(): string {
    return this.styleKey;
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
    enabled?: boolean;
    label: string;
    displayReason: string;
    detectedState: string;
    reason?: string;
  };

  public render(input: {
    enabled?: boolean;
    label: string;
    displayReason: string;
    detectedState: string;
    reason?: string;
  }): void {
    this.renderCalls += 1;
    this.lastInput = input;
  }

  public dispose(): void {
    // no-op
  }
}

interface FakeSettingsOptions {
  overlayEnabled?: boolean;
  onDidChangeEmitter?: vscode.EventEmitter<unknown>;
  toggleCalls?: { count: number };
}

class FakeSettingsService {
  public readonly onDidChangeEmitter: vscode.EventEmitter<unknown>;
  public readonly onDidChange: vscode.Event<unknown>;
  public readonly toggleCalls: { count: number };

  public constructor(private readonly options: FakeSettingsOptions = {}) {
    this.onDidChangeEmitter = options.onDidChangeEmitter ?? new vscode.EventEmitter<unknown>();
    this.onDidChange = this.onDidChangeEmitter.event;
    this.toggleCalls = options.toggleCalls ?? { count: 0 };
  }

  public getSettings() {
    return {
      overlayEnabled: this.options.overlayEnabled ?? true,
      labelPreset: "zh-en" as const,
      cnLabel: "中",
      enLabel: "英",
      cnColor: "#FF5252",
      enColor: "#1E90FF",
      backgroundEnabled: true,
      backgroundOpacity: 0.72,
      opacity: 0.78,
      overlayMode: "text+icon" as const,
      statusBarEnabled: true,
      hideWhenEditorUnfocused: false,
      offsetX: 6,
      offsetY: 20
    };
  }

  public getLabelForState(state: "cn" | "en" | "unknown") {
    if (state === "cn") {
      return "中";
    }
    if (state === "en") {
      return "英";
    }
    return undefined;
  }

  public async toggleOverlay(): Promise<void> {
    this.toggleCalls.count += 1;
  }

  public async updateSetting(_key: string, _value: boolean | number | string): Promise<void> {
    // no-op in unit tests
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

class FakeLogger {
  public infos: string[] = [];
  public warnings: string[] = [];
  public errors: string[] = [];
  public lastReport?: string;
  public recentEntries: DetectorLogEntry[] = [];

  public info(message: string): void {
    this.infos.push(message);
  }
  public warn(message: string): void {
    this.warnings.push(message);
  }
  public error(message: string): void {
    this.errors.push(message);
  }
  public recordDetectorLog(): void {
    // no-op
  }
  public getRecentEntries(): readonly DetectorLogEntry[] {
    return this.recentEntries;
  }
  public showReport(report: string): void {
    this.lastReport = report;
  }
  public dispose(): void {
    // no-op
  }
}

function buildControllerOptions({
  detector,
  overlayRenderer,
  statusBarPresenter,
  settingsService,
  logger,
  now
}: {
  detector: ImeDetector;
  overlayRenderer: OverlayRenderer;
  statusBarPresenter: FakeStatusBarPresenter;
  settingsService: FakeSettingsService;
  logger: FakeLogger;
  now?: () => number;
}): ConstructorParameters<typeof HudController>[0] {
  return {
    detector,
    settingsService: settingsService as never,
    logger: logger as never,
    overlayRenderer,
    statusBarPresenter: statusBarPresenter as never,
    now
  };
}

suite("HudController", () => {
  let clock: sinon.SinonFakeTimers;

  setup(() => {
    clock = sinon.useFakeTimers();
  });

  teardown(() => {
    clock.restore();
  });

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
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();

    assert.equal(overlayRenderer.renderCalls, 0);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("uses a short grace window for unknown before clearing the overlay", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    assert.equal(overlayRenderer.renderCalls, 1);
    assert.equal(statusBarPresenter.lastInput?.label, "中");

    detector.emitSnapshot(createUnknownSnapshot("temporary-unknown"));

    assert.equal(overlayRenderer.renderCalls, 1, "snapshot change itself does not double-render");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "grace-period");

    await clock.tickAsync(UNKNOWN_GRACE_PERIOD_MS + 50);

    assert.equal(overlayRenderer.clearCalls, 1);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("graces the first unknown even when the stable state is old", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    await clock.tickAsync(UNKNOWN_GRACE_PERIOD_MS + 100);

    detector.emitSnapshot(createUnknownSnapshot("temporary-unknown"));

    assert.equal(statusBarPresenter.lastInput?.label, "中");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "grace-period");

    await clock.tickAsync(UNKNOWN_GRACE_PERIOD_MS - 1);
    assert.equal(statusBarPresenter.lastInput?.label, "中");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "grace-period");

    await clock.tickAsync(2);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("does not extend grace for consecutive unknown snapshots", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    detector.emitSnapshot(createUnknownSnapshot("temporary-unknown"));
    await clock.tickAsync(UNKNOWN_GRACE_PERIOD_MS - 100);
    detector.emitSnapshot(createUnknownSnapshot("still-unknown"));

    assert.equal(statusBarPresenter.lastInput?.label, "中");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "grace-period");

    await clock.tickAsync(101);
    assert.equal(statusBarPresenter.lastInput?.label, "?");
    assert.equal(statusBarPresenter.lastInput?.displayReason, "unknown");

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("settings change triggers an immediate render", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    const renderCallsAfterStart = overlayRenderer.renderCalls;
    assert.ok(renderCallsAfterStart >= 1, "start() must trigger a render");

    // Fire a settings-change event; the controller should re-render
    // synchronously (requestRender(true)) so the user sees the new
    // style without waiting on the debounce timer.
    overlayRenderer.styleKey = "style-after-settings-change";
    settingsService.onDidChangeEmitter.fire(undefined);
    assert.equal(
      overlayRenderer.renderCalls,
      renderCallsAfterStart + 1,
      "settings change must trigger a render"
    );

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("toggleOverlay delegates to the settings service and persists the change", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const toggleCalls = { count: 0 };
    const settingsService = new FakeSettingsService({ toggleCalls });
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    await controller.toggleOverlay();
    await controller.toggleOverlay();

    assert.equal(toggleCalls.count, 2, "controller must delegate toggle to settings service");
    // After toggling, the user-facing `overlayEnabled` value would flip;
    // we don't model that here, but we do verify the controller did
    // not swallow the call.

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("dispose during the grace timer cancels the scheduled re-render", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    detector.emitSnapshot(createUnknownSnapshot("transient"));

    // The grace timer is scheduled. Dispose the controller before it
    // fires, then advance the fake clock. The controller must NOT
    // schedule a re-render (which would call the fake status bar
    // presenter again).
    const renderCallsAfterSnapshot = statusBarPresenter.renderCalls;
    controller.dispose();
    await clock.tickAsync(UNKNOWN_GRACE_PERIOD_MS + 100);

    assert.equal(
      statusBarPresenter.renderCalls,
      renderCallsAfterSnapshot,
      "no render should fire after dispose"
    );

    detector.dispose();
    settingsService.dispose();
  });

  test("diagnostics do not expose file contents or full document URIs", async () => {
    await showTestDocument("very-secret-line-content");
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    logger.recentEntries = [
      {
        type: "log",
        level: "warn",
        timestamp: new Date().toISOString(),
        message: "helper log raw=state=2 name=Sensitive IME Name",
        details: { raw: "raw=state=2 name=Sensitive IME Name" },
        source: "native-helper"
      }
    ];
    detector.emitSnapshot({
      ...createStableSnapshot("cn"),
      imeName: "Sensitive IME Name",
      layoutHex: "0404",
      threadId: 12345,
      hwnd: "0xSECRET",
      reason: "failed at /Users/secret/project;private/helper; raw=state=2 name=Sensitive IME Name"
    });
    controller.showDiagnostics();

    assert.ok(logger.lastReport, "diagnostics report should be produced");
    assert.ok(!logger.lastReport.includes("very-secret-line-content"));
    assert.ok(!logger.lastReport.includes("Active line length:"));
    assert.ok(logger.lastReport.includes("当前编辑器：已打开（URI scheme=untitled）"));
    assert.ok(!logger.lastReport.includes("untitled:"));
    assert.ok(logger.lastReport.includes("辅助程序路径：已提供"));
    assert.ok(logger.lastReport.includes("辅助程序文件是否存在：是"));
    assert.ok(logger.lastReport.includes("SHA-256 校验文件路径：已提供"));
    assert.ok(logger.lastReport.includes("SHA-256 校验文件是否存在：是"));
    assert.ok(logger.lastReport.includes("辅助程序哈希状态：match"));
    assert.ok(logger.lastReport.includes("辅助程序协议版本：1"));
    assert.ok(!logger.lastReport.includes("/Users/secret/project"));
    assert.ok(!logger.lastReport.includes("private/helper"));
    assert.ok(!logger.lastReport.includes("ImeWatcher.exe.sha256"));
    assert.ok(!logger.lastReport.includes("Sensitive IME Name"));
    assert.ok(!logger.lastReport.includes("raw=state=2"));
    assert.ok(logger.lastReport.includes("raw=<redacted>"));
    assert.ok(!statusBarPresenter.lastInput?.reason?.includes("/Users/secret/project"));
    assert.ok(!statusBarPresenter.lastInput?.reason?.includes("private/helper"));
    assert.ok(!statusBarPresenter.lastInput?.reason?.includes("Sensitive IME Name"));
    assert.ok(!statusBarPresenter.lastInput?.reason?.includes("raw=state=2"));
    assert.ok(statusBarPresenter.lastInput?.reason?.includes("raw=<redacted>"));
    assert.ok(!logger.lastReport.includes("0xSECRET"));
    assert.ok(logger.lastReport.includes("imeNameAvailable"));
    assert.ok(logger.lastReport.includes("hwndAvailable"));

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("diagnostics redact circular recent log details", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    const circularArray: unknown[] = [];
    circularArray.push(circularArray);
    const details: Record<string, unknown> = {
      raw: "raw=state=2 name=Sensitive IME Name",
      circularArray
    };
    details.self = details;
    logger.recentEntries = [
      {
        type: "log",
        level: "warn",
        timestamp: new Date().toISOString(),
        message: "circular details",
        details,
        source: "native-helper"
      }
    ];

    assert.doesNotThrow(() => controller.showDiagnostics());
    assert.ok(logger.lastReport?.includes('"self": "[Circular]"'));
    assert.ok(logger.lastReport?.includes('"circularArray": [\n        "[Circular]"'));
    assert.ok(logger.lastReport?.includes("raw=<redacted>"));
    assert.ok(!logger.lastReport?.includes("Sensitive IME Name"));

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });

  test("snapshot change updates the render (label flips cn -> en)", async () => {
    await showTestDocument();
    const detector = new TestDetector(createStableSnapshot("cn"));
    const overlayRenderer = new FakeOverlayRenderer();
    const statusBarPresenter = new FakeStatusBarPresenter();
    const settingsService = new FakeSettingsService();
    const logger = new FakeLogger();
    const controller = new HudController(
      buildControllerOptions({
        detector,
        overlayRenderer,
        statusBarPresenter,
        settingsService,
        logger
      })
    );

    await controller.start();
    assert.equal(statusBarPresenter.lastInput?.label, "中");

    detector.emitSnapshot(createStableSnapshot("en"));
    assert.equal(overlayRenderer.lastLabel, "英", "label should flip to en on the next render");
    assert.equal(statusBarPresenter.lastInput?.label, "英");
    assert.equal(statusBarPresenter.lastInput?.detectedState, "en");

    controller.dispose();
    detector.dispose();
    settingsService.dispose();
  });
});

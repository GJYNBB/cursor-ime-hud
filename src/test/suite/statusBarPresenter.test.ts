import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  buildStatusBarText,
  buildStatusBarTooltip,
  formatDetectedStateForUi,
  StatusBarPresenter,
  StatusBarRenderInput
} from "../../presenters/StatusBarPresenter";
import { buildSettingsMenuItems, buildStatusBarMenuItems } from "../../presenters/statusBarMenu";
import { CursorImeHudSettings } from "../../model/types";

class FakeStatusBarItem implements vscode.StatusBarItem {
  public accessibilityInformation: vscode.AccessibilityInformation | undefined;
  public alignment: vscode.StatusBarAlignment = vscode.StatusBarAlignment.Right;
  public backgroundColor: vscode.ThemeColor | undefined;
  public color: string | vscode.ThemeColor | undefined;
  public command: string | vscode.Command | undefined;
  public name: string | undefined;
  public priority: number | undefined = 100;
  public text = "";
  public tooltip: string | vscode.MarkdownString | undefined;
  public id = "fake-status-bar";
  public showCalls = 0;
  public hideCalls = 0;
  public disposeCalls = 0;

  public show(): void {
    this.showCalls += 1;
  }

  public hide(): void {
    this.hideCalls += 1;
  }

  public dispose(): void {
    this.disposeCalls += 1;
  }
}

function baseInput(overrides: Partial<StatusBarRenderInput> = {}): StatusBarRenderInput {
  return {
    enabled: true,
    overlayEnabled: true,
    label: "中",
    source: "ime-watcher",
    isFallback: false,
    detectedState: "cn",
    displayReason: "direct",
    ...overrides
  };
}

function baseSettings(overrides: Partial<CursorImeHudSettings> = {}): CursorImeHudSettings {
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
    hideWhenEditorUnfocused: true,
    offsetX: 6,
    offsetY: 20,
    ...overrides
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("StatusBarPresenter", () => {
  test("maps detected states for Chinese UI", () => {
    assert.equal(formatDetectedStateForUi("cn"), "中文");
    assert.equal(formatDetectedStateForUi("en"), "英文");
    assert.equal(formatDetectedStateForUi("unknown"), "未知");
  });

  test("status bar text reflects live overlay eye state", () => {
    assert.equal(buildStatusBarText({ label: "中", overlayEnabled: true }), "$(eye) 输入法：中");
    assert.equal(
      buildStatusBarText({ label: "英", overlayEnabled: false }),
      "$(eye-closed) 输入法：英"
    );
  });

  test("hover tooltip exposes toggle and settings command links", () => {
    const item = new FakeStatusBarItem();
    const presenter = new StatusBarPresenter(item);

    presenter.render(
      baseInput({
        label: "中",
        overlayEnabled: true,
        detectedState: "cn"
      })
    );

    assert.equal(item.name, "输入法状态提示");
    assert.equal(item.text, "$(eye) 输入法：中");
    assert.equal(item.showCalls, 1);
    assert.equal(item.command, undefined);
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    const tooltip = item.tooltip as vscode.MarkdownString;
    assert.ok(tooltip.value.includes("当前显示"));
    assert.ok(tooltip.value.includes("检测状态"));
    assert.ok(!tooltip.value.includes("光标旁图标："));
    assert.ok(tooltip.value.includes("command:cursorImeHud.toggleOverlay"));
    assert.ok(tooltip.value.includes("点击关闭光标旁图标"));
    assert.ok(tooltip.value.includes("command:workbench.action.openSettings"));
    assert.ok(tooltip.value.includes("打开设置"));
    assert.ok(tooltip.isTrusted);
  });

  test("tooltip toggle label flips with overlay state", () => {
    const off = buildStatusBarTooltip(baseInput({ overlayEnabled: false }));
    assert.ok(off.value.includes("点击开启光标旁图标"));
    assert.ok(!off.value.includes("点击关闭光标旁图标"));

    const on = buildStatusBarTooltip(baseInput({ overlayEnabled: true }));
    assert.ok(on.value.includes("点击关闭光标旁图标"));
    assert.ok(!on.value.includes("点击开启光标旁图标"));
  });

  test("hide/shows status bar item when overlay state flips so hover can refresh", async () => {
    const item = new FakeStatusBarItem();
    const presenter = new StatusBarPresenter(item);

    presenter.render(baseInput({ overlayEnabled: true }));
    assert.equal(item.showCalls, 1);
    assert.equal(item.hideCalls, 0);
    assert.equal(item.text, "$(eye) 输入法：中");

    presenter.render(baseInput({ overlayEnabled: false }));
    assert.equal(item.hideCalls, 1);
    // show is deferred to the next macrotask so an open hover is dismissed first
    assert.equal(item.showCalls, 1);
    assert.equal(item.text, "$(eye-closed) 输入法：中");

    await delay(10);
    assert.equal(item.showCalls, 2);
    assert.equal(item.text, "$(eye-closed) 输入法：中");
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.ok((item.tooltip as vscode.MarkdownString).value.includes("点击开启光标旁图标"));

    presenter.dispose();
  });

  test("hides the status bar item when disabled", () => {
    const item = new FakeStatusBarItem();
    const presenter = new StatusBarPresenter(item);

    presenter.render(baseInput({ enabled: false }));
    assert.equal(item.hideCalls, 1);
    assert.equal(item.showCalls, 0);
  });
});

suite("statusBarMenu", () => {
  test("includes toggle, refresh, diagnostics, and popup settings", () => {
    const enabled = buildStatusBarMenuItems(true);
    assert.deepEqual(
      enabled.map((item) => item.action),
      ["toggleOverlay", "refreshImeState", "showDiagnostics", "openSettingsMenu"]
    );
    assert.equal(enabled[0]?.label, "$(eye-closed) 关闭光标旁图标");
    assert.equal(enabled[0]?.description, "当前：已开启");
    assert.equal(enabled[3]?.label, "$(gear) 设置…");

    const disabled = buildStatusBarMenuItems(false);
    assert.equal(disabled[0]?.label, "$(eye) 开启光标旁图标");
    assert.equal(disabled[0]?.description, "当前：已关闭");
  });

  test("settings menu exposes common options and full settings escape hatch", () => {
    const items = buildSettingsMenuItems(baseSettings());
    assert.deepEqual(
      items.map((item) => item.action),
      [
        "setLabelPreset",
        "setOverlayMode",
        "setCnColor",
        "setEnColor",
        "setOpacity",
        "setBackgroundOpacity",
        "toggleBackgroundEnabled",
        "setOffsetX",
        "setOffsetY",
        "toggleHideWhenUnfocused",
        "toggleStatusBar",
        "openFullSettings"
      ]
    );
    assert.equal(items[0]?.description, "中 / 英");
    assert.equal(items[1]?.description, "图标 + 文字");
    assert.equal(items[2]?.description, "#FF5252");
  });
});

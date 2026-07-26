/**
 * Pure menu model for the status-bar QuickPick. Kept free of `vscode` so
 * item labels / actions can be unit-tested without a host window.
 */
import { CursorImeHudSettings } from "../model/types";

export type StatusBarMenuAction =
  | "toggleOverlay"
  | "refreshImeState"
  | "showDiagnostics"
  | "openSettingsMenu";

export interface StatusBarMenuItem {
  label: string;
  description?: string;
  action: StatusBarMenuAction;
}

export type SettingsMenuAction =
  | "setLabelPreset"
  | "setOverlayMode"
  | "setCnColor"
  | "setEnColor"
  | "setOpacity"
  | "setBackgroundOpacity"
  | "toggleBackgroundEnabled"
  | "setOffsetX"
  | "setOffsetY"
  | "toggleHideWhenUnfocused"
  | "toggleStatusBar"
  | "openFullSettings";

export interface SettingsMenuItem {
  label: string;
  description?: string;
  detail?: string;
  action: SettingsMenuAction;
}

export function buildStatusBarMenuItems(overlayEnabled: boolean): StatusBarMenuItem[] {
  return [
    {
      label: overlayEnabled ? "$(eye-closed) 关闭光标旁图标" : "$(eye) 开启光标旁图标",
      description: overlayEnabled ? "当前：已开启" : "当前：已关闭",
      action: "toggleOverlay"
    },
    {
      label: "$(refresh) 刷新输入法状态",
      action: "refreshImeState"
    },
    {
      label: "$(info) 显示诊断信息",
      action: "showDiagnostics"
    },
    {
      label: "$(gear) 设置…",
      description: "在弹窗中调整常用选项",
      action: "openSettingsMenu"
    }
  ];
}

export function buildSettingsMenuItems(settings: CursorImeHudSettings): SettingsMenuItem[] {
  const labelPresetText = settings.labelPreset === "en-zh" ? "ZH / EN" : "中 / 英";
  const modeText = settings.overlayMode === "text" ? "纯文字" : "图标 + 文字";

  return [
    {
      label: "$(symbol-text) 标签样式",
      description: labelPresetText,
      detail: "点击切换 中/英 与 ZH/EN",
      action: "setLabelPreset"
    },
    {
      label: "$(symbol-color) 显示模式",
      description: modeText,
      detail: "点击切换 图标+文字 / 纯文字",
      action: "setOverlayMode"
    },
    {
      label: "$(paintcan) 中文颜色",
      description: settings.cnColor,
      action: "setCnColor"
    },
    {
      label: "$(paintcan) 英文颜色",
      description: settings.enColor,
      action: "setEnColor"
    },
    {
      label: "$(eye) 整体透明度",
      description: String(settings.opacity),
      detail: "范围 0.15 ~ 1",
      action: "setOpacity"
    },
    {
      label: "$(color-mode) 背景透明度",
      description: String(settings.backgroundOpacity),
      detail: "范围 0 ~ 1",
      action: "setBackgroundOpacity"
    },
    {
      label: settings.backgroundEnabled
        ? "$(check) 纯文字背景：开"
        : "$(circle-slash) 纯文字背景：关",
      action: "toggleBackgroundEnabled"
    },
    {
      label: "$(arrow-both) 水平偏移",
      description: String(settings.offsetX),
      detail: "范围 -50 ~ 50",
      action: "setOffsetX"
    },
    {
      label: "$(arrow-up) 垂直偏移",
      description: String(settings.offsetY),
      detail: "范围 -50 ~ 50",
      action: "setOffsetY"
    },
    {
      label: settings.hideWhenEditorUnfocused
        ? "$(check) 失焦隐藏：开"
        : "$(circle-slash) 失焦隐藏：关",
      action: "toggleHideWhenUnfocused"
    },
    {
      label: settings.statusBarEnabled ? "$(check) 状态栏：开" : "$(circle-slash) 状态栏：关",
      action: "toggleStatusBar"
    },
    {
      label: "$(link-external) 打开完整设置页…",
      description: "跳转到扩展设置",
      action: "openFullSettings"
    }
  ];
}

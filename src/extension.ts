import * as path from "node:path";
import * as vscode from "vscode";
import { registerCommands } from "./commands/registerCommands";
import { HudController } from "./controller/HudController";
import { SampleOrNativeDetector } from "./detector/SampleOrNativeDetector";
import { StatusBarPresenter } from "./presenters/StatusBarPresenter";
import { CursorOverlayRenderer } from "./renderer/CursorOverlayRenderer";
import { PositionStrategy } from "./renderer/PositionStrategy";
import { LoggerService } from "./services/LoggerService";
import { SettingsService } from "./services/SettingsService";

let controller: HudController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new LoggerService();
  const settingsService = new SettingsService();
  const helperPath = context.asAbsolutePath(path.join("resources", "bin", "win-x64", "WinImeWatcher.exe"));
  const detector = new SampleOrNativeDetector(helperPath);
  const overlayRenderer = new CursorOverlayRenderer(new PositionStrategy());
  const statusBarPresenter = new StatusBarPresenter();

  context.subscriptions.push(logger, settingsService, detector, overlayRenderer, statusBarPresenter);

  controller = new HudController({
    detector,
    settingsService,
    logger,
    overlayRenderer,
    statusBarPresenter
  });

  context.subscriptions.push(controller);
  registerCommands(context, controller);

  if (process.platform !== "win32") {
    logger.warn("Cursor IME HUD is optimized for Windows and will run in fallback mode on this platform.");
  }

  await controller.start();
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}

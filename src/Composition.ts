import * as path from "node:path";
import * as vscode from "vscode";
import { registerCommands } from "./commands/registerCommands";
import { HudController } from "./controller/HudController";
import { VSCodeEditorHost } from "./controller/EditorHost";
import { SampleOrNativeDetector } from "./detector/SampleOrNativeDetector";
import { StatusBarPresenter } from "./presenters/StatusBarPresenter";
import { CursorOverlayRenderer } from "./renderer/CursorOverlayRenderer";
import { PositionStrategy } from "./renderer/PositionStrategy";
import { LoggerService } from "./services/LoggerService";
import { SettingsService } from "./services/SettingsService";

/**
 * Result of wiring the extension. `dispose` releases every singleton
 * allocated by `buildController` (output channel, status bar item, the
 * controller itself). The composition root owns these lifetimes; callers
 * should push `dispose` into `context.subscriptions`. The logger is also
 * exposed so the entry point can log platform-specific startup warnings
 * without re-creating an `OutputChannel`.
 */
export interface Composition {
  controller: HudController;
  logger: LoggerService;
  dispose: () => void;
}

/**
 * Composition root. Constructs the entire dependency graph for the
 * extension, wires it into `context.subscriptions`, returns the live
 * `Composition` for `extension.ts` to use.
 *
 * Lifted out of `extension.ts` so:
 *   - the wiring is unit-testable (you can call `buildController` from a
 *     test fake context),
 *   - the entry point stays a one-liner, and
 *   - adding a new collaborator does not require editing `extension.ts`.
 */
export function buildController(context: vscode.ExtensionContext): Composition {
  // Allocate vscode singletons once, at the root, and inject them. This
  // stops the individual services from reaching into the `vscode`
  // namespace on construction (see arch-07).
  const outputChannel = vscode.window.createOutputChannel("Cursor IME HUD");
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  const logger = new LoggerService(outputChannel);
  const settingsService = new SettingsService();
  const helperPath = context.asAbsolutePath(
    path.join("resources", "bin", "win-x64", "WinImeWatcher.exe")
  );
  const detector = new SampleOrNativeDetector(helperPath);
  const overlayRenderer = new CursorOverlayRenderer(new PositionStrategy());
  const statusBarPresenter = new StatusBarPresenter(statusBarItem);
  const editorHost = new VSCodeEditorHost();

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    logger,
    settingsService,
    detector,
    overlayRenderer,
    statusBarPresenter,
    editorHost
  );

  const controller = new HudController({
    detector,
    settingsService,
    logger,
    overlayRenderer,
    statusBarPresenter,
    editorHost
  });

  context.subscriptions.push(controller);
  registerCommands(context, controller);

  return {
    controller,
    logger,
    dispose: () => {
      // The individual disposables are owned by `context.subscriptions`,
      // so we only need to make sure the controller (which holds the
      // detector subscription) and the editor host are torn down here.
      // `context.subscriptions.dispose()` will sweep the rest on
      // extension deactivation.
      controller.dispose();
      editorHost.dispose();
    }
  };
}

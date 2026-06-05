import * as vscode from "vscode";
import { HudController } from "../controller/HudController";

/**
 * Register every user-facing command the extension exposes. The commands
 * are thin wrappers that delegate to the controller so the actual logic
 * stays in one place and is testable in isolation. Callers are expected
 * to push the returned `Disposable` chain into `context.subscriptions`
 * (this is what the composition root does).
 */
export function registerCommands(context: vscode.ExtensionContext, controller: HudController): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursorImeHud.toggleOverlay", async () => controller.toggleOverlay()),
    vscode.commands.registerCommand("cursorImeHud.refreshImeState", () => controller.refreshImeState()),
    vscode.commands.registerCommand("cursorImeHud.showDiagnostics", () => controller.showDiagnostics())
  );
}

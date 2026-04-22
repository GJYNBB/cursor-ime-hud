import * as vscode from "vscode";
import { HudController } from "../controller/HudController";

export function registerCommands(context: vscode.ExtensionContext, controller: HudController): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursorImeHud.toggleOverlay", async () => controller.toggleOverlay()),
    vscode.commands.registerCommand("cursorImeHud.refreshImeState", () => controller.refreshImeState()),
    vscode.commands.registerCommand("cursorImeHud.showDiagnostics", () => controller.showDiagnostics())
  );
}

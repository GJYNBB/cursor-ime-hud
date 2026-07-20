import * as vscode from "vscode";
import { Composition, buildController } from "./Composition";

let composition: Composition | undefined;

/**
 * Extension entry point. The actual wiring lives in
 * `buildController` (see `./Composition.ts`) so this file stays a thin
 * shell: it constructs the composition, surfaces a friendly error if the
 * controller fails to start, and exposes the dispose hook to VS Code.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  composition = buildController(context);

  try {
    await composition.controller.start();
  } catch (error) {
    // Activation must not abort because the controller failed to start.
    // The controller already catches its own recoverable failures (see
    // `HudController.start`); this catch covers the unexpected
    // programmer-error case where `start` itself throws.
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Cursor IME HUD 启动失败：${message}`);
  }
}

export function deactivate(): void {
  composition?.dispose();
  composition = undefined;
}

import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Cursor IME HUD Extension", () => {
  test("activates and registers commands", async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === "cursor-ime-hud"
    );
    assert.ok(extension, "Extension should be discoverable in the extension host.");

    await extension?.activate();
    assert.equal(extension?.isActive, true, "Extension should activate.");

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("cursorImeHud.toggleOverlay"));
    assert.ok(commands.includes("cursorImeHud.refreshImeState"));
    assert.ok(commands.includes("cursorImeHud.showDiagnostics"));
    assert.ok(commands.includes("cursorImeHud.showStatusBarMenu"));
  });
});

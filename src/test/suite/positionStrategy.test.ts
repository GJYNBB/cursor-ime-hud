import * as assert from "node:assert";
import * as vscode from "vscode";
import { PositionStrategy } from "../../renderer/PositionStrategy";

suite("PositionStrategy", () => {
  const strategy = new PositionStrategy();

  test("uses before attachment at line start", async () => {
    const document = await vscode.workspace.openTextDocument({ content: "abc" });
    const placement = strategy.resolve(document, new vscode.Position(0, 0));

    assert.ok(placement);
    assert.equal(placement?.attachment, "before");
    assert.equal(placement?.range.start.character, 0);
    assert.equal(placement?.range.end.character, 1);
  });

  test("uses previous character for mid-line cursor", async () => {
    const document = await vscode.workspace.openTextDocument({ content: "abcd" });
    const placement = strategy.resolve(document, new vscode.Position(0, 2));

    assert.ok(placement);
    assert.equal(placement?.attachment, "after");
    assert.equal(placement?.range.start.character, 1);
    assert.equal(placement?.range.end.character, 2);
  });

  test("uses previous character for line end cursor", async () => {
    const document = await vscode.workspace.openTextDocument({ content: "abcd" });
    const placement = strategy.resolve(document, new vscode.Position(0, 4));

    assert.ok(placement);
    assert.equal(placement?.attachment, "after");
    assert.equal(placement?.range.start.character, 3);
    assert.equal(placement?.range.end.character, 4);
  });

  test("returns undefined on empty lines", async () => {
    const document = await vscode.workspace.openTextDocument({ content: "\n" });
    const placement = strategy.resolve(document, new vscode.Position(0, 0));

    assert.equal(placement, undefined);
  });
});

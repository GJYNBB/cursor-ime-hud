import * as path from "node:path";
import Mocha from "mocha";
import * as vscode from "vscode";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true
  });

  const testsRoot = __dirname;
  mocha.addFile(path.resolve(testsRoot, "./extension.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./positionStrategy.test.js"));

  return new Promise((resolve, reject) => {
    mocha.run(async (failures: number) => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");

      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}

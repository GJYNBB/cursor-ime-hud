import * as path from "node:path";
import Mocha from "mocha";
import * as vscode from "vscode";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 10000
  });

  const grep = process.env.VSCODE_TEST_GREP;
  if (grep) {
    mocha.grep(new RegExp(grep));
  }

  const testsRoot = __dirname;
  mocha.addFile(path.resolve(testsRoot, "./extension.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./hudController.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./renderState.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./detectorLifecycle.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./helperProtocol.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./positionStrategy.test.js"));
  mocha.addFile(path.resolve(testsRoot, "./services.test.js"));

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

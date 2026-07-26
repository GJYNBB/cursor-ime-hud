import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";
import * as vscode from "vscode";

/**
 * Recursively collect every compiled `*.test.js` file under `root`. The
 * result is sorted so the suite order is deterministic across platforms
 * (readdir order is filesystem-dependent).
 */
function collectTestFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

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
  const testFiles = collectTestFiles(testsRoot);
  if (testFiles.length === 0) {
    // An empty suite would "pass" silently; fail loudly instead so a broken
    // compile output path cannot masquerade as a green run.
    return Promise.reject(new Error(`No *.test.js files found under ${testsRoot}.`));
  }
  for (const file of testFiles) {
    mocha.addFile(file);
  }

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

// NOTE: Alternative runner. Canonical entry is scripts/run-extension-tests.js. Use this only if you need to pin VS Code version.
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath
    });
  } catch (error) {
    console.error("Failed to run extension tests.");
    console.error(error);
    process.exit(1);
  }
}

void main();

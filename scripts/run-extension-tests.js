const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

function readGrepArgument() {
  const grepIndex = process.argv.indexOf("--grep");
  if (grepIndex >= 0) {
    return process.argv[grepIndex + 1];
  }

  return undefined;
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.join(
    extensionDevelopmentPath,
    "out",
    "test",
    "suite",
    "index.js"
  );
  const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  const grep = readGrepArgument();

  // VS Code must launch as Electron, not as plain Node. Some parent test
  // harnesses set ELECTRON_RUN_AS_NODE=1, so preserve the old runner's
  // invariant and scrub it before @vscode/test-electron spawns Code.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || process.env.VSCODE_CLI,
      extensionTestsEnv: grep ? { VSCODE_TEST_GREP: grep } : undefined,
      launchArgs: [
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        extensionDevelopmentPath
      ]
    });
  } finally {
    if (electronRunAsNode === undefined) {
      delete process.env.ELECTRON_RUN_AS_NODE;
    } else {
      process.env.ELECTRON_RUN_AS_NODE = electronRunAsNode;
    }
  }
}

main().catch((error) => {
  console.error("Failed to run extension tests.");
  console.error(error);
  process.exit(1);
});

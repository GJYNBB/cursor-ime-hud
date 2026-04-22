const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

function resolveCodeCommand() {
  if (process.env.VSCODE_EXECUTABLE_PATH) {
    return process.env.VSCODE_EXECUTABLE_PATH;
  }

  if (process.env.VSCODE_CLI) {
    return process.env.VSCODE_CLI;
  }

  if (process.platform === "win32") {
    const output = execFileSync("where.exe", ["code.cmd"], { encoding: "utf8" }).trim();
    const firstMatch = output.split(/\r?\n/).find(Boolean);
    if (firstMatch) {
      return path.resolve(path.dirname(firstMatch), "..", "Code.exe");
    }
  }

  return "code";
}

function makeTempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const workspaceRoot = path.resolve(__dirname, "..");
const extensionTestsPath = path.join(workspaceRoot, "out", "test", "suite", "index.js");

if (!fs.existsSync(extensionTestsPath)) {
  console.error(`Compiled extension tests not found: ${extensionTestsPath}`);
  process.exit(1);
}

const userDataDir = makeTempDirectory("cursor-ime-hud-user-");
const extensionsDir = makeTempDirectory("cursor-ime-hud-extensions-");
const codeCommand = resolveCodeCommand();
const args = [
  "--skip-welcome",
  "--skip-release-notes",
  "--disable-workspace-trust",
  "--user-data-dir",
  userDataDir,
  "--extensions-dir",
  extensionsDir,
  "--extensionDevelopmentPath",
  workspaceRoot,
  "--extensionTestsPath",
  extensionTestsPath,
  workspaceRoot
];

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(codeCommand, args, {
  stdio: "inherit",
  shell: false,
  env: environment
});

const cleanup = () => {
  for (const directory of [userDataDir, extensionsDir]) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Cleanup warning for ${directory}: ${error.message}`);
    }
  }
};

child.on("error", (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 1);
});

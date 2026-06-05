const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// The Windows native helper only ships as a .exe, so a meaningful
// "spawn the helper once and parse a JSONL line" smoke test can only
// run on win32. On other platforms we skip with a clear message so the
// cross-platform `npm run test:integration` script does not fail.
if (process.platform !== "win32") {
  console.log("[skip] assert-helper-once requires Windows; current platform is " + process.platform);
  process.exit(0);
}

const helperPath = path.join(__dirname, "..", "resources", "bin", "win-x64", "WinImeWatcher.exe");

if (!fs.existsSync(helperPath)) {
  console.error(`Helper not found: ${helperPath}`);
  process.exit(1);
}

const child = spawn(helperPath, ["--once"], {
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => {
  if (code !== 0) {
    console.error(stderr || `Helper exited with code ${code}`);
    process.exit(code || 1);
  }

  const line = stdout.trim().split(/\r?\n/).find(Boolean);
  if (!line) {
    console.error("Helper did not emit a JSON line.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    console.error(`Invalid JSON from helper: ${line}`);
    console.error(error);
    process.exit(1);
  }

  const allowedStates = new Set(["cn", "en", "unknown"]);
  if (!allowedStates.has(parsed.state)) {
    console.error(`Unexpected state: ${parsed.state}`);
    process.exit(1);
  }

  if (!parsed.timestamp) {
    console.error("Missing timestamp in helper output.");
    process.exit(1);
  }

  if (parsed.reason !== undefined && typeof parsed.reason !== "string") {
    console.error(`Unexpected reason type: ${typeof parsed.reason}`);
    process.exit(1);
  }

  if (parsed.confidence !== undefined && typeof parsed.confidence !== "number") {
    console.error(`Unexpected confidence type: ${typeof parsed.confidence}`);
    process.exit(1);
  }

  if (parsed.rawStateAvailable !== undefined && typeof parsed.rawStateAvailable !== "boolean") {
    console.error(`Unexpected rawStateAvailable type: ${typeof parsed.rawStateAvailable}`);
    process.exit(1);
  }

  if (parsed.state === "unknown" && typeof parsed.reason !== "string") {
    console.error("Unknown helper states must include a reason.");
    process.exit(1);
  }

  process.stdout.write(`helper-once ok: ${parsed.state}\n`);
});

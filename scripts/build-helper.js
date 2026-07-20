#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  HELPERS,
  cargoBinaryPath,
  resourceDir,
  resourcePath,
  sha256Path,
  selectedHelper
} = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "native", "ime-watcher", "Cargo.toml");
const requestedTarget = process.env.CURSOR_IME_HELPER_TARGET;
const helper = selectedHelper();

if (!helper) {
  if (requestedTarget) {
    console.error(
      `[build-helper] Unknown helper target '${requestedTarget}'. Supported targets: ${Object.keys(HELPERS).join(", ")}`
    );
    process.exit(1);
  }
  console.log(
    `[build-helper] No native helper target for ${process.platform}/${process.arch}; skipping.`
  );
  process.exit(0);
}

function helperEnv() {
  return {
    ...process.env,
    ...(helper.cargoEnv ?? {})
  };
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: helperEnv()
  });

  if (result.error) {
    const hint =
      result.error.code === "ENOENT"
        ? `Command '${command}' was not found. Install Rust stable and ensure cargo/rustup are on PATH before building the native helper.`
        : result.error.message;
    console.error(`[build-helper] ${hint}`);
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    throw new Error(`${command} terminated with signal ${result.signal}`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toLowerCase();
}

console.log(`[build-helper] Building ${helper.targetKey} (${helper.cargoTarget}).`);

const rustupCheck = spawnSync("rustup", ["--version"], {
  cwd: repoRoot,
  stdio: "ignore",
  shell: process.platform === "win32",
  env: helperEnv()
});
if (!rustupCheck.error && rustupCheck.status === 0) {
  run("rustup", ["target", "add", helper.cargoTarget]);
}

run("cargo", [
  "build",
  "--manifest-path",
  manifestPath,
  "--release",
  "--target",
  helper.cargoTarget
]);

const builtPath = cargoBinaryPath(repoRoot, helper);
if (!fs.existsSync(builtPath)) {
  throw new Error(`Expected Rust helper at ${builtPath} after cargo build.`);
}

const outputDir = resourceDir(repoRoot, helper);
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const outputPath = resourcePath(repoRoot, helper);
fs.copyFileSync(builtPath, outputPath);
if (helper.platform !== "win32") {
  fs.chmodSync(outputPath, 0o755);
}

const hash = sha256(outputPath);
const outputHashPath = sha256Path(repoRoot, helper);
fs.mkdirSync(path.dirname(outputHashPath), { recursive: true });
fs.writeFileSync(outputHashPath, hash, "ascii");
console.log(`Wrote helper: ${outputPath}`);
console.log(`Wrote helper hash sidecar: ${outputHashPath}`);
console.log(hash);

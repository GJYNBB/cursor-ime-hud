#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listFiles, PackageManager } = require("@vscode/vsce");
const { allHelpers, helperForTarget, resourcePath, sha256Path } = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const vsceCli = path.join(repoRoot, "node_modules", "@vscode", "vsce", "vsce");

function usage() {
  return [
    "Usage:",
    "  node scripts/package-vsix.js --target <target> [--out-dir <directory>]",
    "  node scripts/package-vsix.js --all [--out-dir <directory>]",
    "",
    `Targets: ${allHelpers()
      .map((helper) => helper.targetKey)
      .join(", ")}`
  ].join("\n");
}

function parseArgs(args) {
  let target;
  let all = false;
  let outDir = repoRoot;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--target") {
      target = args[++index];
      if (!target) throw new Error("--target requires a value.");
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else if (arg === "--out-dir") {
      const value = args[++index];
      if (!value) throw new Error("--out-dir requires a value.");
      outDir = path.resolve(repoRoot, value);
    } else if (arg.startsWith("--out-dir=")) {
      outDir = path.resolve(repoRoot, arg.slice("--out-dir=".length));
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (all && target) throw new Error("Use either --all or --target, not both.");
  if (!all && !target) {
    target = process.env.CURSOR_IME_HELPER_TARGET;
  }
  if (!all && !target) throw new Error("Specify --target <target> or --all.");

  return {
    targets: all ? allHelpers().map((helper) => helper.targetKey) : [target],
    outDir
  };
}

function assertTargetLayout(helper) {
  const resourceFolder = path.posix.basename(path.posix.dirname(helper.resourcePath));
  if (resourceFolder !== helper.targetKey) {
    throw new Error(
      `Helper '${helper.targetKey}' must live in a directory named '${helper.targetKey}' so ` +
        "platform package staging can identify the selected native binary."
    );
  }
}

function assertHelperResources(helper) {
  const binary = resourcePath(repoRoot, helper);
  const hash = sha256Path(repoRoot, helper);
  for (const file of [binary, hash]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing helper resource for ${helper.targetKey}: ${file}`);
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
  if (result.signal) throw new Error(`${command} was terminated by signal ${result.signal}.`);
}

function verifyHelper(helper) {
  run(process.execPath, [path.join(repoRoot, "scripts", "verify-helper-resources.js")], {
    env: {
      ...process.env,
      CURSOR_IME_HELPER_TARGET: helper.targetKey,
      CURSOR_IME_VERIFY_ALL_HELPERS: "0"
    }
  });
}

function copyPackageFiles(files, helper, stageRoot) {
  const selectedHelperFiles = new Set([helper.resourcePath, helper.sha256Path]);
  for (const relativePath of files) {
    const normalized = relativePath.split(path.sep).join("/");
    if (normalized.startsWith("resources/bin/") && !selectedHelperFiles.has(normalized)) {
      continue;
    }

    const source = path.join(repoRoot, ...normalized.split("/"));
    const target = path.join(stageRoot, ...normalized.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  const stagedManifestPath = path.join(stageRoot, "resources", "helper-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(stagedManifestPath, "utf8"));
  manifest.helpers = manifest.helpers.filter((entry) => entry.targetKey === helper.targetKey);
  if (manifest.helpers.length !== 1) {
    throw new Error(`Unable to stage a single manifest entry for '${helper.targetKey}'.`);
  }
  fs.writeFileSync(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const stagedPackageJsonPath = path.join(stageRoot, "package.json");
  const stagedPackageJson = JSON.parse(fs.readFileSync(stagedPackageJsonPath, "utf8"));
  if (stagedPackageJson.scripts) {
    delete stagedPackageJson.scripts["vscode:prepublish"];
  }
  fs.writeFileSync(
    stagedPackageJsonPath,
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    "utf8"
  );

  if (helper.platform !== "win32") {
    fs.chmodSync(path.join(stageRoot, ...helper.resourcePath.split("/")), 0o755);
  }
}

function packageTarget(target, outDir, packageFiles) {
  const helper = helperForTarget(target);
  if (!helper) {
    throw new Error(`Unsupported VSIX target '${target}'.\n${usage()}`);
  }

  assertTargetLayout(helper);
  assertHelperResources(helper);
  verifyHelper(helper);
  fs.mkdirSync(outDir, { recursive: true });

  const outputPath = path.join(
    outDir,
    `${packageJson.name}-${packageJson.version}-${helper.targetKey}.vsix`
  );
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cursor-ime-hud-${helper.targetKey}-`));
  try {
    copyPackageFiles(packageFiles, helper, stageRoot);
    run(
      process.execPath,
      [vsceCli, "package", "--target", helper.targetKey, "--no-dependencies", "--out", outputPath],
      {
        cwd: stageRoot,
        env: {
          ...process.env,
          CURSOR_IME_HELPER_TARGET: helper.targetKey,
          CURSOR_IME_VERIFY_ALL_HELPERS: "0"
        }
      }
    );
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
  if (!fs.existsSync(outputPath)) throw new Error(`vsce did not produce ${outputPath}.`);

  const size = fs.statSync(outputPath).size;
  console.log(`[package-vsix] ${helper.targetKey}: ${outputPath} (${size} bytes)`);
  return outputPath;
}

async function main() {
  const { targets, outDir } = parseArgs(process.argv.slice(2));
  run(process.execPath, [path.join(repoRoot, "scripts", "check-publisher.js")]);
  run(process.execPath, [
    path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    repoRoot
  ]);
  const packageFiles = await listFiles({
    cwd: repoRoot,
    packageManager: PackageManager.None
  });
  const outputs = targets.map((target) => packageTarget(target, outDir, packageFiles));
  console.log(`[package-vsix] Produced ${outputs.length} platform-specific VSIX package(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

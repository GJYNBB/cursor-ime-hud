"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "resources", "helper-manifest.json");
const SUPPORTED_MANIFEST_VERSION = 1;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
  throw new Error(`Unsupported helper-manifest.json version '${manifest.version}'`);
}
if (!Array.isArray(manifest.helpers)) {
  throw new Error("Invalid helper manifest: helpers must be an array");
}

const HELPERS = Object.fromEntries(manifest.helpers.map((helper) => [helper.targetKey, helper]));

function normalizeArch(platform = process.platform, arch = process.arch) {
  if (platform === "linux" && arch === "arm") {
    return "armhf";
  }
  return arch;
}

function hostKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${normalizeArch(platform, arch)}`;
}

function helperForTarget(targetKey = process.env.CURSOR_IME_HELPER_TARGET) {
  if (!targetKey) {
    return undefined;
  }
  return HELPERS[targetKey];
}

function helperForHost(platform = process.platform, arch = process.arch) {
  return HELPERS[hostKey(platform, arch)];
}

function selectedHelper(platform = process.platform, arch = process.arch) {
  if (process.env.CURSOR_IME_HELPER_TARGET) {
    return helperForTarget();
  }
  return helperForHost(platform, arch);
}

function canRunOnHost(helper, platform = process.platform, arch = process.arch) {
  return helper.platform === platform && helper.arch === normalizeArch(platform, arch);
}

function resourceDir(repoRoot, helper) {
  return path.dirname(resourcePath(repoRoot, helper));
}

function resourcePath(repoRoot, helper) {
  return path.join(repoRoot, ...helper.resourcePath.split("/"));
}

function sha256Path(repoRoot, helper) {
  return path.join(repoRoot, ...helper.sha256Path.split("/"));
}

function cargoBinaryPath(repoRoot, helper) {
  return path.join(
    repoRoot,
    "native",
    "ime-watcher",
    "target",
    helper.cargoTarget,
    "release",
    helper.binaryName
  );
}

function allHelpers() {
  return Object.values(HELPERS);
}

module.exports = {
  HELPERS,
  allHelpers,
  canRunOnHost,
  cargoBinaryPath,
  helperForHost,
  helperForTarget,
  resourceDir,
  resourcePath,
  selectedHelper,
  sha256Path
};

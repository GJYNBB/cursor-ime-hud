#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  allHelpers,
  helperForHost,
  helperForTarget,
  resourcePath,
  sha256Path
} = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");

function shouldVerifyAllHelpers() {
  return process.env.CURSOR_IME_VERIFY_ALL_HELPERS === "1" || process.argv.includes("--all");
}

function helpersToVerify() {
  if (process.env.CURSOR_IME_HELPER_TARGET) {
    const helper = helperForTarget();
    if (!helper) {
      throw new Error(`Unsupported helper target: ${process.env.CURSOR_IME_HELPER_TARGET}`);
    }
    return [helper];
  }
  if (shouldVerifyAllHelpers()) {
    return allHelpers();
  }
  const helper = helperForHost();
  return helper ? [helper] : [];
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toLowerCase();
}

function main() {
  const helpers = helpersToVerify();
  if (helpers.length === 0) {
    console.log("No helper resource applies to this host; skipped helper resource verification.");
    return;
  }

  for (const helper of helpers) {
    const file = resourcePath(repoRoot, helper);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing helper resource: ${relativePath(file)}`);
    }

    const hashPath = sha256Path(repoRoot, helper);
    if (!fs.existsSync(hashPath)) {
      throw new Error(`Missing helper hash sidecar: ${relativePath(hashPath)}`);
    }

    const expected = fs.readFileSync(hashPath, "utf8").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`Invalid helper hash sidecar: ${relativePath(hashPath)}`);
    }

    const actual = sha256(file);
    if (actual !== expected) {
      throw new Error(
        `SHA-256 mismatch for ${relativePath(file)}: expected=${expected} actual=${actual}`
      );
    }
  }

  console.log(`Verified ${helpers.length} helper resource(s) from resources/helper-manifest.json.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

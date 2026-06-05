#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Print the SHA-256 of the bundled WinImeWatcher.exe so the maintainer
 * can paste it into `src/detector/NativeHelperImeDetector.ts`
 * (EXPECTED_HELPER_SHA256).
 *
 * Usage:
 *   1. Build the helper: `npm run build:helper`  (Windows-only, needs .NET 8)
 *   2. From the repo root: `node scripts/hash-helper.js`
 *   3. Copy the printed hash into NativeHelperImeDetector.ts.
 *
 * Cross-platform: works on macOS/Linux too, so you can verify a hash on
 * a Windows-built binary without rebuilding.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const candidates = [
  path.resolve(__dirname, "..", "resources", "bin", "win-x64", "WinImeWatcher.exe"),
  path.resolve(__dirname, "..", "native", "WinImeWatcher", "bin", "Release", "net8.0", "win-x64", "publish", "WinImeWatcher.exe"),
  path.resolve(__dirname, "..", "native", "WinImeWatcher", "bin", "Release", "net8.0", "win-x64", "WinImeWatcher.exe")
];

const existing = candidates.filter((p) => fs.existsSync(p));
if (existing.length === 0) {
  console.error("[hash-helper] WinImeWatcher.exe not found. Tried:");
  for (const c of candidates) {
    console.error("  - " + c);
  }
  console.error("");
  console.error("Build it first with `npm run build:helper` (Windows + .NET 8 SDK).");
  process.exit(1);
}

for (const exePath of existing) {
  const fileBuffer = fs.readFileSync(exePath);
  const sha = crypto.createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();
  console.log(sha + "  " + exePath);
}

#!/usr/bin/env node
/**
 * Print the SHA-256 for the bundled WinImeWatcher.exe.
 *
 * Prefer the generated `.sha256` sidecar when it exists; otherwise fall back
 * to computing the hash from the executable itself.
 *
 * Usage:
 *   1. Build the helper: `npm run build:helper`  (Windows-only, needs .NET 8)
 *   2. From the repo root: `node scripts/hash-helper.js`
 *   3. Compare the printed hash with the generated sidecar or use it for
 *      verification in a release pipeline.
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

const sidecarPath = candidates.map((exePath) => `${exePath}.sha256`).find((p) => fs.existsSync(p));
if (sidecarPath) {
  const hash = fs.readFileSync(sidecarPath, "utf8").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    console.error(`[hash-helper] Invalid SHA-256 sidecar: ${sidecarPath}`);
    process.exit(1);
  }

  const exePath = sidecarPath.slice(0, -7);
  if (!fs.existsSync(exePath)) {
    console.error(`[hash-helper] Found sidecar but not executable: ${exePath}`);
    process.exit(1);
  }

  console.log(hash + "  " + exePath);
  process.exit(0);
}

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

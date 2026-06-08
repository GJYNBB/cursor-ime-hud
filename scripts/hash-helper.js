#!/usr/bin/env node
/**
 * Print and verify the SHA-256 for the bundled WinImeWatcher.exe.
 *
 * When a generated `.sha256` sidecar exists, this script verifies that the
 * sidecar matches the executable before printing it. Without a sidecar, it
 * computes the hash from the executable so release tooling can create one.
 *
 * Usage:
 *   1. Build the helper: `npm run build:helper`  (Windows-only, needs Rust stable)
 *   2. From the repo root: `node scripts/hash-helper.js`
 *   3. Use the printed hash for release verification or sidecar generation.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const candidates = [
  path.resolve(__dirname, "..", "resources", "bin", "win-x64", "WinImeWatcher.exe"),
  path.resolve(
    __dirname,
    "..",
    "native",
    "WinImeWatcher",
    "target",
    "x86_64-pc-windows-msvc",
    "release",
    "WinImeWatcher.exe"
  ),
  path.resolve(__dirname, "..", "native", "WinImeWatcher", "target", "release", "WinImeWatcher.exe")
];

function computeSha256(exePath) {
  const fileBuffer = fs.readFileSync(exePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();
}

const existing = candidates.filter((p) => fs.existsSync(p));
if (existing.length === 0) {
  console.error("[hash-helper] WinImeWatcher.exe not found. Tried:");
  for (const c of candidates) {
    console.error("  - " + c);
  }
  console.error("");
  console.error("Build it first with `npm run build:helper` (Windows + Rust stable toolchain).");
  process.exit(1);
}

let printed = false;
for (const exePath of existing) {
  const actual = computeSha256(exePath);
  const sidecarPath = `${exePath}.sha256`;

  if (fs.existsSync(sidecarPath)) {
    const expected = fs.readFileSync(sidecarPath, "utf8").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      console.error(`[hash-helper] Invalid SHA-256 sidecar: ${sidecarPath}`);
      process.exit(1);
    }

    if (actual !== expected) {
      console.error(`[hash-helper] SHA-256 sidecar mismatch: ${sidecarPath}`);
      console.error(`  expected=${expected}`);
      console.error(`  actual=${actual}`);
      process.exit(1);
    }
  }

  console.log(actual + "  " + exePath);
  printed = true;
}

if (!printed) {
  process.exit(1);
}

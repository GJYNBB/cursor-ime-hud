#!/usr/bin/env node
/**
 * Print and verify SHA-256 sidecars for bundled IME helper binaries.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { allHelpers, cargoBinaryPath, resourcePath } = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");

function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();
}

const candidates = [];
for (const helper of allHelpers()) {
  candidates.push(resourcePath(repoRoot, helper));
  candidates.push(cargoBinaryPath(repoRoot, helper));
}

const existing = [...new Set(candidates)].filter((candidate) => fs.existsSync(candidate));
if (existing.length === 0) {
  console.error("[hash-helper] No IME helper binary found. Tried:");
  for (const candidate of candidates) {
    console.error("  - " + candidate);
  }
  console.error("");
  console.error("Build one first with `npm run build:helper` on a supported host.");
  process.exit(1);
}

for (const helperPath of existing) {
  const actual = computeSha256(helperPath);
  const sidecarPath = `${helperPath}.sha256`;

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

  console.log(actual + "  " + helperPath);
}

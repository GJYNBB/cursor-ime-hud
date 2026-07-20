#!/usr/bin/env node
"use strict";

/**
 * Enforce branch coverage for the protocol and helper lifecycle modules.
 *
 * The repository-wide c8 threshold protects the aggregate number, but a
 * well-covered renderer can otherwise hide an untested lifecycle regression.
 * Keep these limits in a small, dependency-free script so the same check is
 * used locally and in CI on Windows, macOS, and Linux.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const summaryPath = path.join(repoRoot, "coverage", "coverage-summary.json");

// NativeHelper has a few platform-specific process/error branches which are
// difficult to exercise in a headless extension host. Keep the floor at 70%
// after covering deterministic startup, integrity, protocol, buffer, and
// lifecycle failures; protocol/path parsing have stricter floors because
// their branches are deterministic and fully testable.
const thresholds = {
  "src/detector/NativeHelperImeDetector.ts": 70,
  "src/detector/helperProtocol.ts": 90,
  "src/detector/nativeHelperPath.ts": 85,
  "src/detector/SampleOrNativeDetector.ts": 70
};

function normalize(filePath) {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

function findSummaryEntry(summary, relativePath) {
  const expected = normalize(relativePath);
  for (const [filePath, entry] of Object.entries(summary)) {
    const normalized = normalize(filePath);
    // c8 normally writes absolute keys, but older versions can emit paths
    // relative to the working directory. Accept either representation and
    // avoid path.relative() turning a relative key into an unrelated `..`
    // path on Windows.
    if (normalized === expected || normalized.endsWith(`/${expected}`)) {
      return entry;
    }
  }
  return undefined;
}

function main() {
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Coverage summary not found: ${summaryPath}`);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const failures = [];

  for (const [relativePath, minimum] of Object.entries(thresholds)) {
    const entry = findSummaryEntry(summary, relativePath);
    if (!entry || !entry.branches) {
      failures.push(`${relativePath}: no branch coverage entry`);
      continue;
    }

    const actual = Number(entry.branches.pct);
    if (!Number.isFinite(actual) || actual < minimum) {
      failures.push(`${relativePath}: ${actual}% < ${minimum}% branch coverage`);
      continue;
    }

    console.log(`${relativePath}: ${actual}% branches (minimum ${minimum}%)`);
  }

  if (failures.length > 0) {
    throw new Error(`Core branch coverage gate failed:\n- ${failures.join("\n- ")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

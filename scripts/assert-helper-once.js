#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { canRunOnHost, resourcePath, selectedHelper } = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");
const helper = selectedHelper();
const timeoutMs = Number.parseInt(process.env.CURSOR_IME_HELPER_TEST_TIMEOUT_MS ?? "8000", 10);

if (!helper) {
  console.log(
    `[skip] assert-helper-once has no helper target for ${process.platform}/${process.arch}`
  );
  process.exit(0);
}

if (!canRunOnHost(helper)) {
  const message = `${helper.targetKey} helper cannot be executed on ${process.platform}/${process.arch}`;
  if (process.env.CURSOR_IME_HELPER_ALLOW_SKIP === "1") {
    console.log(`[skip] ${message}`);
    process.exit(0);
  }
  console.error(`[fail] ${message}`);
  process.exit(1);
}

const helperPath = resourcePath(repoRoot, helper);
if (!fs.existsSync(helperPath)) {
  console.error(`Helper not found: ${helperPath}`);
  process.exit(1);
}

const child = spawn(helperPath, ["--once"], {
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let finished = false;

const timeout = setTimeout(() => {
  if (finished) {
    return;
  }
  finished = true;
  try {
    child.kill();
  } catch {
    // Ignore process-exit races.
  }
  console.error(`Helper timed out after ${timeoutMs}ms: ${helperPath}`);
  process.exit(1);
}, timeoutMs);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("error", (error) => {
  if (finished) {
    return;
  }
  finished = true;
  clearTimeout(timeout);
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => {
  if (finished) {
    return;
  }
  finished = true;
  clearTimeout(timeout);

  if (code !== 0) {
    console.error(stderr || `Helper exited with code ${code}`);
    process.exit(code || 1);
  }

  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    console.error("Helper did not emit JSON lines.");
    process.exit(1);
  }

  const records = [];
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      console.error(`Invalid JSON from helper on line ${index + 1}: ${line}`);
      console.error(error);
      process.exit(1);
    }
  }

  const hello = records.find((record) => record.type === "hello");
  if (!hello) {
    console.error("Helper did not emit the required hello record.");
    console.error(stdout);
    process.exit(1);
  }

  if (hello.version !== 1) {
    console.error(`Unexpected helper protocol version: ${hello.version}`);
    process.exit(1);
  }

  const parsed = records.find((record) => record.type === "state");
  if (!parsed) {
    console.error("Helper did not emit a state record.");
    console.error(stdout);
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

  process.stdout.write(`helper-once ok (${helper.platformKey}): ${parsed.state}\n`);
});

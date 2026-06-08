#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

if (process.platform !== "win32") {
  console.log(
    "[test:integration] Skipping Windows helper integration tests on non-Windows platform."
  );
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    console.error(`${command} terminated with signal ${result.signal}`);
    process.exit(1);
  }
}

run("npm", ["run", "build:helper"]);
run("npm", ["run", "test:helper"]);

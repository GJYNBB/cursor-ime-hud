#!/usr/bin/env node
/**
 * Guard script run by `prepublishOnly` and the release workflow.
 *
 * Refuses to publish when the `publisher` field is still the
 * `publisher-placeholder` value shipped in the upstream template. The user
 * must register a publisher id on the VS Code Marketplace and replace the
 * placeholder before their first release. See
 * https://aka.ms/vscode-publishers for instructions.
 *
 * Exits with a non-zero status and a clear error message if the
 * placeholder is still in place, so npm / CI / vsce all see the failure.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER = "publisher-placeholder";
const packageJsonPath = path.resolve(__dirname, "..", "package.json");

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
} catch (error) {
  console.error(`[check-publisher] Failed to read package.json: ${error.message}`);
  process.exit(1);
}

if (!packageJson || typeof packageJson !== "object") {
  console.error("[check-publisher] package.json is malformed.");
  process.exit(1);
}

if (packageJson.publisher === PLACEHOLDER) {
  console.error(
    [
      "[check-publisher] Refusing to publish: package.json#publisher is still",
      "  \"publisher-placeholder\".",
      "",
      "  Replace it with your VS Code Marketplace publisher id before the",
      "  first release. Register one at https://aka.ms/vscode-publishers",
      "  and update the `publisher` field in package.json."
    ].join("\n")
  );
  process.exit(1);
}

console.log(`[check-publisher] publisher=${packageJson.publisher} (ok)`);

#!/usr/bin/env node
"use strict";

/**
 * Optionally sign the native helper produced by build-helper.js.
 *
 * Signing is intentionally opt-in: release jobs provide the platform signing
 * secrets only on a tag.  When the credentials are absent the script leaves
 * the binary untouched and records that the artifact is unsigned.  A partial
 * credential set is an error, because silently producing a mixed release is
 * unsafe.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { helperForTarget, resourcePath, sha256Path } = require("./helper-platforms");

const repoRoot = path.resolve(__dirname, "..");
const target = process.env.CURSOR_IME_HELPER_TARGET;
const helper = helperForTarget(target);

if (!helper) {
  throw new Error(`Unsupported native helper target '${target ?? ""}'.`);
}

const binaryPath = resourcePath(repoRoot, helper);
const hashPath = sha256Path(repoRoot, helper);

function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...spawnOptions
  });
  if (result.error && !allowFailure) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
  }
  return result;
}

function hashAndWriteSidecar() {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(binaryPath)).digest("hex");
  fs.writeFileSync(hashPath, `${digest}\n`, "ascii");
  console.log(`[sign-native-helper] Rewrote SHA-256 sidecar for ${target}: ${digest}`);
}

function decodeCertificate(prefix, suffix) {
  const encoded = process.env[`${prefix}_CERTIFICATE_BASE64`] ?? "";
  if (!encoded) return undefined;
  const certificatePath = path.join(
    os.tmpdir(),
    `cursor-ime-hud-${prefix.toLowerCase()}-${process.pid}-${suffix}`
  );
  fs.writeFileSync(certificatePath, Buffer.from(encoded, "base64"));
  return certificatePath;
}

function findSignTool() {
  const configured = process.env.WINDOWS_SIGNTOOL_PATH;
  if (configured && fs.existsSync(configured)) return configured;

  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    const kitsRoot = path.join(root, "Windows Kits", "10", "bin");
    if (!fs.existsSync(kitsRoot)) continue;
    for (const version of fs.readdirSync(kitsRoot)) {
      for (const architecture of ["x64", "arm64"]) {
        const candidate = path.join(kitsRoot, version, architecture, "signtool.exe");
        if (fs.existsSync(candidate)) candidates.push(candidate);
      }
    }
  }
  candidates.sort();
  return candidates.at(-1);
}

function validateSigningCredentialSets() {
  const windowsCertificate = process.env.WINDOWS_SIGNING_CERTIFICATE_BASE64 ?? "";
  const windowsPassword = process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD ?? "";
  const windowsTimestamp = process.env.WINDOWS_SIGNING_TIMESTAMP_URL ?? "";
  const macCertificate = process.env.MACOS_SIGNING_CERTIFICATE_BASE64 ?? "";
  const macPassword = process.env.MACOS_SIGNING_CERTIFICATE_PASSWORD ?? "";
  const macIdentity = process.env.MACOS_SIGNING_IDENTITY ?? "";
  const anyCredential =
    windowsCertificate ||
    windowsPassword ||
    windowsTimestamp ||
    macCertificate ||
    macPassword ||
    macIdentity;
  if (!anyCredential) return false;

  // A release is either fully unsigned or has a verifiable signature path for
  // both desktop operating systems.  This prevents a tag from silently
  // shipping a mixture of signed and unsigned native helpers.
  if (!windowsCertificate) {
    throw new Error(
      "Windows native signing is incomplete: WINDOWS_SIGNING_CERTIFICATE_BASE64 is required when native signing is enabled."
    );
  }
  if (!macCertificate || !macIdentity) {
    throw new Error(
      "macOS native signing is incomplete: MACOS_SIGNING_CERTIFICATE_BASE64 and MACOS_SIGNING_IDENTITY are required when native signing is enabled."
    );
  }
  return true;
}

function signWindows() {
  const certificate = process.env.WINDOWS_SIGNING_CERTIFICATE_BASE64 ?? "";
  const password = process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD ?? "";
  if (!certificate) throw new Error("Windows native signing credentials are incomplete.");

  const signtool = findSignTool();
  if (!signtool) {
    throw new Error("signtool.exe was not found on the Windows runner.");
  }
  const certificatePath = decodeCertificate("WINDOWS_SIGNING", "certificate.pfx");
  try {
    const args = [
      "sign",
      "/fd",
      "SHA256",
      "/tr",
      process.env.WINDOWS_SIGNING_TIMESTAMP_URL || "http://timestamp.digicert.com",
      "/td",
      "SHA256",
      "/f",
      certificatePath,
      "/a"
    ];
    if (password) args.push("/p", password);
    args.push(binaryPath);
    run(signtool, args);
    run(signtool, ["verify", "/pa", "/all", "/tw", binaryPath]);
  } finally {
    if (certificatePath) fs.rmSync(certificatePath, { force: true });
  }
  hashAndWriteSidecar();
  return true;
}

function signMacOS() {
  const certificate = process.env.MACOS_SIGNING_CERTIFICATE_BASE64 ?? "";
  const password = process.env.MACOS_SIGNING_CERTIFICATE_PASSWORD ?? "";
  const identity = process.env.MACOS_SIGNING_IDENTITY ?? "";
  if (!certificate || !identity)
    throw new Error("macOS native signing credentials are incomplete.");

  const certificatePath = decodeCertificate("MACOS_SIGNING", "certificate.p12");
  const keychainPath = path.join(os.tmpdir(), `cursor-ime-hud-signing-${process.pid}.keychain-db`);
  const keychainPassword = crypto.randomBytes(24).toString("base64url");
  try {
    run("security", ["create-keychain", "-p", keychainPassword, keychainPath]);
    run("security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
    run("security", ["unlock-keychain", "-p", keychainPassword, keychainPath]);
    run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign"
    ]);
    run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath
    ]);
    run("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--keychain",
      keychainPath,
      "--sign",
      identity,
      binaryPath
    ]);
    run("codesign", [
      "--verify",
      "--strict",
      "--verbose=2",
      "--keychain",
      keychainPath,
      binaryPath
    ]);
  } finally {
    run("security", ["delete-keychain", keychainPath], { stdio: "ignore", allowFailure: true });
    if (certificatePath) fs.rmSync(certificatePath, { force: true });
  }
  hashAndWriteSidecar();
  return true;
}

if (!fs.existsSync(binaryPath)) {
  throw new Error(`Native helper does not exist: ${binaryPath}`);
}

let signed = false;
const signingEnabled = validateSigningCredentialSets();
if (!signingEnabled) {
  console.log(
    "::notice::Native helper signing credentials are not configured; publishing unsigned Windows/macOS helpers."
  );
}
if (helper.platform === "win32") {
  if (process.platform !== "win32") throw new Error("Windows helper signing must run on Windows.");
  signed = signingEnabled ? signWindows() : false;
} else if (helper.platform === "darwin") {
  if (process.platform !== "darwin") throw new Error("macOS helper signing must run on macOS.");
  signed = signingEnabled ? signMacOS() : false;
} else {
  console.log(
    `[sign-native-helper] No OS signing step is configured for ${target}; leaving helper unchanged.`
  );
}

if (signed) {
  console.log(`[sign-native-helper] Signed native helper: ${target}`);
}

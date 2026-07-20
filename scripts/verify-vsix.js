#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const zlib = require("node:zlib");
const { helperForTarget } = require("./helper-platforms");

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function usage() {
  return "Usage: node scripts/verify-vsix.js --target <target> <package.vsix>";
}

function parseArgs(args) {
  let target;
  let packagePath;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--target") {
      target = args[++index];
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else if (!packagePath) {
      packagePath = arg;
    } else {
      throw new Error(`Unexpected argument '${arg}'.\n${usage()}`);
    }
  }
  if (!target || !packagePath) throw new Error(usage());
  return { target, packagePath: path.resolve(packagePath) };
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error("VSIX does not contain a ZIP end-of-central-directory record.");
}

function readEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`Invalid ZIP central-directory entry at offset ${offset}.`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (entries.has(name)) throw new Error(`VSIX contains a duplicate ZIP entry '${name}'.`);
    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP local-file entry for '${entry.name}'.`);
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  let contents;
  if (entry.compressionMethod === 0) {
    contents = compressed;
  } else if (entry.compressionMethod === 8) {
    contents = zlib.inflateRawSync(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}.`);
  }
  if (contents.length !== entry.uncompressedSize) {
    throw new Error(`Unexpected uncompressed size for '${entry.name}'.`);
  }
  return contents;
}

function requireEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`VSIX is missing '${name}'.`);
  return entry;
}

function main() {
  const { target, packagePath } = parseArgs(process.argv.slice(2));
  const helper = helperForTarget(target);
  if (!helper) throw new Error(`Unsupported target '${target}'.`);

  const buffer = fs.readFileSync(packagePath);
  const entries = readEntries(buffer);
  const helperEntries = [...entries.keys()]
    .filter((name) => name.startsWith("extension/resources/bin/") && !name.endsWith("/"))
    .sort();
  const expectedHelperEntries = [
    `extension/${helper.resourcePath}`,
    `extension/${helper.sha256Path}`
  ].sort();
  if (JSON.stringify(helperEntries) !== JSON.stringify(expectedHelperEntries)) {
    throw new Error(
      `VSIX helper entries do not match ${target}.\n` +
        `Expected: ${expectedHelperEntries.join(", ")}\n` +
        `Actual: ${helperEntries.join(", ")}`
    );
  }

  const binaryEntry = requireEntry(entries, `extension/${helper.resourcePath}`);
  const hashEntry = requireEntry(entries, `extension/${helper.sha256Path}`);
  const expectedHash = readEntry(buffer, hashEntry).toString("ascii").trim().toLowerCase();
  const actualHash = crypto
    .createHash("sha256")
    .update(readEntry(buffer, binaryEntry))
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || expectedHash !== actualHash) {
    throw new Error(`VSIX helper SHA-256 verification failed for '${target}'.`);
  }

  const manifestEntry = requireEntry(entries, "extension/resources/helper-manifest.json");
  const manifest = JSON.parse(readEntry(buffer, manifestEntry).toString("utf8"));
  if (manifest.helpers?.length !== 1 || manifest.helpers[0]?.targetKey !== target) {
    throw new Error(`VSIX helper manifest is not restricted to '${target}'.`);
  }
  const manifestHelper = manifest.helpers[0];
  for (const field of [
    "platform",
    "arch",
    "platformKey",
    "resourcePath",
    "sha256Path",
    "resourceBinaryName",
    "backendName"
  ]) {
    if (manifestHelper[field] !== helper[field]) {
      throw new Error(`VSIX helper manifest field '${field}' does not match target '${target}'.`);
    }
  }

  const vsixManifestEntry = requireEntry(entries, "extension.vsixmanifest");
  const vsixManifest = readEntry(buffer, vsixManifestEntry).toString("utf8");
  if (!vsixManifest.includes(`TargetPlatform=\"${target}\"`)) {
    throw new Error(`VSIX metadata does not declare TargetPlatform='${target}'.`);
  }

  console.log(
    `[verify-vsix] ${path.basename(packagePath)}: target=${target}, ` +
      `entries=${entries.size}, size=${buffer.length} bytes`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

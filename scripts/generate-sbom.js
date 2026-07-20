"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error(
    "Usage: node scripts/generate-sbom.js --output <file> --artifact-glob <glob> [--artifact-glob <glob> ...]"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
let output;
const artifactGlobs = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--output") {
    output = args[++index];
  } else if (argument === "--artifact-glob") {
    artifactGlobs.push(args[++index]);
  } else {
    usage(`Unknown argument '${argument}'.`);
  }
}

if (!output) usage("An output path is required.");
if (artifactGlobs.length === 0) usage("At least one artifact glob is required.");
if (artifactGlobs.some((value) => !value)) usage("Artifact globs must not be empty.");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmArguments = [
  "sbom",
  "--sbom-format=cyclonedx",
  "--sbom-type=application",
  "--package-lock-only"
];
const spawnCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : npmCommand;
const spawnArguments =
  process.platform === "win32" ? ["/d", "/s", "/c", npmCommand, ...npmArguments] : npmArguments;
const npmResult = spawnSync(spawnCommand, spawnArguments, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});
if (npmResult.error) throw npmResult.error;
if (npmResult.status !== 0) {
  process.exit(npmResult.status ?? 1);
}

let bom;
try {
  bom = JSON.parse(npmResult.stdout);
} catch (error) {
  throw new Error(`npm sbom did not return valid JSON: ${error.message}`);
}

const artifactPaths = [
  ...new Set(
    artifactGlobs.flatMap((pattern) => {
      const matches =
        typeof fs.globSync === "function" ? fs.globSync(pattern, { nodir: true }) : [];
      if (matches.length > 0) return matches;
      if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) return [pattern];
      throw new Error(`Artifact glob did not match any file: ${pattern}`);
    })
  )
].sort();

const artifactComponents = artifactPaths.map((filePath) => {
  const relativePath = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return {
    type: "file",
    name: relativePath,
    "bom-ref": `artifact:${relativePath}`,
    hashes: [{ alg: "SHA-256", content: digest }],
    properties: [{ name: "build:artifact", value: "true" }]
  };
});

bom.components = [...(bom.components ?? []), ...artifactComponents];
bom.metadata = bom.metadata ?? {};
bom.metadata.properties = [
  ...(bom.metadata.properties ?? []),
  { name: "build:artifact-count", value: String(artifactComponents.length) },
  ...artifactComponents.map((component) => ({
    name: "build:artifact-sha256",
    value: `${component.name}=${component.hashes[0].content}`
  }))
];

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
console.log(
  `Wrote CycloneDX SBOM with ${artifactComponents.length} artifact subject(s): ${output}`
);

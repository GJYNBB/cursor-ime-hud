import * as fs from "node:fs";
import * as nativePath from "node:path";
import { posix as posixPath } from "node:path";

export interface NativeHelperDescriptor {
  helperPath: string;
  relativePath: string;
  backendName: string;
  platformKey: string;
  sha256Path: string;
  sha256RelativePath: string;
}

export interface NativeHelperUnavailable {
  helperPath?: undefined;
  relativePath?: undefined;
  backendName?: undefined;
  platformKey?: undefined;
  sha256Path?: undefined;
  sha256RelativePath?: undefined;
  reason: string;
}

export type NativeHelperResolution = NativeHelperDescriptor | NativeHelperUnavailable;

export interface ResolveNativeHelperOptions {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  asAbsolutePath: (relativePath: string) => string;
  manifestPath?: string;
}

interface HelperManifestEntry {
  platform: string;
  arch: string;
  platformKey: string;
  backendName: string;
  resourcePath: string;
  sha256Path: string;
}

interface HelperManifest {
  version: number;
  helpers: HelperManifestEntry[];
}

let cachedManifest: HelperManifest | undefined;
const DEFAULT_MANIFEST_PATH = nativePath.join(
  __dirname,
  "..",
  "..",
  "resources",
  "helper-manifest.json"
);

function loadHelperManifest(manifestPath = DEFAULT_MANIFEST_PATH): HelperManifest {
  if (!cachedManifest || manifestPath !== DEFAULT_MANIFEST_PATH) {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as HelperManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.helpers)) {
      throw new Error("原生输入法辅助程序清单无效。");
    }
    if (manifestPath === DEFAULT_MANIFEST_PATH) {
      cachedManifest = parsed;
    }
    return parsed;
  }
  return cachedManifest;
}

function normalizeArch(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  if (platform === "linux" && arch === "arm") {
    return "armhf";
  }
  return arch;
}

function manifestHelperForHost(
  manifest: HelperManifest,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): HelperManifestEntry | undefined {
  const normalizedArch = normalizeArch(platform, arch);
  return manifest.helpers.find(
    (helper) => helper.platform === platform && helper.arch === normalizedArch
  );
}

export function helperManifestEntries(manifestPath?: string): HelperManifestEntry[] {
  return loadHelperManifest(manifestPath).helpers;
}

export function resolveNativeHelper(options: ResolveNativeHelperOptions): NativeHelperResolution {
  let manifest: HelperManifest;
  try {
    manifest = loadHelperManifest(options.manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reason: `原生输入法辅助程序清单无法加载：${message}` };
  }

  const helper = manifestHelperForHost(manifest, options.platform, options.arch);
  if (!helper) {
    const platformSupported = manifest.helpers.some((entry) => entry.platform === options.platform);
    return {
      reason: platformSupported
        ? `当前平台没有可用的原生输入法辅助程序：${options.platform}/${options.arch}。`
        : `平台“${options.platform}”没有可用的原生输入法辅助程序。`
    };
  }

  const relativePath = posixPath.join(...helper.resourcePath.split("/"));
  const sha256RelativePath = posixPath.join(...helper.sha256Path.split("/"));
  return {
    helperPath: options.asAbsolutePath(relativePath),
    relativePath,
    backendName: helper.backendName,
    platformKey: helper.platformKey,
    sha256Path: options.asAbsolutePath(sha256RelativePath),
    sha256RelativePath
  };
}

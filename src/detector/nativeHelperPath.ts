import { posix as path } from "node:path";

export interface NativeHelperDescriptor {
  helperPath: string;
  relativePath: string;
  backendName: string;
  platformKey: string;
}

export interface NativeHelperUnavailable {
  helperPath?: undefined;
  relativePath?: undefined;
  backendName?: undefined;
  platformKey?: undefined;
  reason: string;
}

export type NativeHelperResolution = NativeHelperDescriptor | NativeHelperUnavailable;

export interface ResolveNativeHelperOptions {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  experimentalEnabled: boolean;
  asAbsolutePath: (relativePath: string) => string;
}

interface HelperMapping {
  relativeSegments: string[];
  backendName: string;
  platformKey: string;
  experimental: boolean;
}

const PLATFORM_HELPERS: Partial<
  Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, HelperMapping>>>
> = {
  win32: {
    x64: {
      relativeSegments: ["resources", "bin", "win-x64", "WinImeWatcher.exe"],
      backendName: "WinImeWatcher",
      platformKey: "win-x64",
      experimental: false
    }
  },
  darwin: {
    arm64: {
      relativeSegments: ["resources", "bin", "darwin-arm64", "MacImeWatcher"],
      backendName: "MacImeWatcher",
      platformKey: "darwin-arm64",
      experimental: true
    },
    x64: {
      relativeSegments: ["resources", "bin", "darwin-x64", "MacImeWatcher"],
      backendName: "MacImeWatcher",
      platformKey: "darwin-x64",
      experimental: true
    }
  },
  linux: {
    arm64: {
      relativeSegments: ["resources", "bin", "linux-arm64", "LinuxImeWatcher"],
      backendName: "LinuxImeWatcher",
      platformKey: "linux-arm64",
      experimental: true
    },
    x64: {
      relativeSegments: ["resources", "bin", "linux-x64", "LinuxImeWatcher"],
      backendName: "LinuxImeWatcher",
      platformKey: "linux-x64",
      experimental: true
    }
  }
};

export function resolveNativeHelper(options: ResolveNativeHelperOptions): NativeHelperResolution {
  const platformMapping = PLATFORM_HELPERS[options.platform];
  if (!platformMapping) {
    return {
      reason: `No native helper is available for platform '${options.platform}'.`
    };
  }

  const mapping =
    platformMapping[options.arch] ??
    // Preserve the pre-cross-platform Windows behavior: the composition root
    // always resolved the bundled win-x64 helper path regardless of Node arch.
    // Windows on ARM can run x64 binaries through emulation, and unsupported
    // Windows setups should fail through the existing helper startup/fallback
    // path instead of being skipped before spawn.
    (options.platform === "win32" ? platformMapping.x64 : undefined);
  if (!mapping) {
    return {
      reason: `No native helper is available for ${options.platform}/${options.arch}.`
    };
  }

  if (mapping.experimental && !options.experimentalEnabled) {
    return {
      reason: `Experimental native helper for ${mapping.platformKey} is disabled.`
    };
  }

  const relativePath = path.join(...mapping.relativeSegments);
  return {
    helperPath: options.asAbsolutePath(relativePath),
    relativePath,
    backendName: mapping.backendName,
    platformKey: mapping.platformKey
  };
}

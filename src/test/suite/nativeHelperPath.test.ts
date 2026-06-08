import * as assert from "node:assert";
import { resolveNativeHelper } from "../../detector/nativeHelperPath";

suite("nativeHelperPath", () => {
  const asAbsolutePath = (relativePath: string): string => `/extension/${relativePath}`;

  test("resolves the stable Windows x64 helper path", () => {
    const resolution = resolveNativeHelper({
      platform: "win32",
      arch: "x64",
      experimentalEnabled: false,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/win-x64/WinImeWatcher.exe");
    assert.equal(resolution.relativePath, "resources/bin/win-x64/WinImeWatcher.exe");
    assert.equal(resolution.backendName, "WinImeWatcher");
    assert.equal(resolution.platformKey, "win-x64");
  });

  test("keeps macOS helpers disabled unless experimental support is enabled", () => {
    const resolution = resolveNativeHelper({
      platform: "darwin",
      arch: "arm64",
      experimentalEnabled: false,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, undefined);
    assert.ok("reason" in resolution);
    assert.match(resolution.reason, /disabled/);
  });

  test("resolves experimental macOS helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "darwin",
      arch: "arm64",
      experimentalEnabled: true,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/darwin-arm64/MacImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/darwin-arm64/MacImeWatcher");
    assert.equal(resolution.backendName, "MacImeWatcher");
    assert.equal(resolution.platformKey, "darwin-arm64");
  });

  test("resolves experimental Linux helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "linux",
      arch: "x64",
      experimentalEnabled: true,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/linux-x64/LinuxImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/linux-x64/LinuxImeWatcher");
    assert.equal(resolution.backendName, "LinuxImeWatcher");
    assert.equal(resolution.platformKey, "linux-x64");
  });

  test("keeps Windows ARM64 on the bundled win-x64 helper path", () => {
    const resolution = resolveNativeHelper({
      platform: "win32",
      arch: "arm64",
      experimentalEnabled: true,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/win-x64/WinImeWatcher.exe");
    assert.equal(resolution.platformKey, "win-x64");
  });

  test("returns an unavailable reason for unsupported architectures", () => {
    const resolution = resolveNativeHelper({
      platform: "darwin",
      arch: "ia32",
      experimentalEnabled: true,
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, undefined);
    assert.ok("reason" in resolution);
    assert.match(resolution.reason, /darwin\/ia32/);
  });
});

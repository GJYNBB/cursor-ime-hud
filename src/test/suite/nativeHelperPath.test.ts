import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { helperManifestEntries, resolveNativeHelper } from "../../detector/nativeHelperPath";

suite("nativeHelperPath", () => {
  const asAbsolutePath = (relativePath: string): string => `/extension/${relativePath}`;

  test("resolves the stable Windows x64 helper path", () => {
    const resolution = resolveNativeHelper({
      platform: "win32",
      arch: "x64",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/win32-x64/ImeWatcher.exe");
    assert.equal(resolution.relativePath, "resources/bin/win32-x64/ImeWatcher.exe");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "win-x64");
    assert.equal(resolution.sha256Path, "/extension/resources/bin/win32-x64/ImeWatcher.exe.sha256");
    assert.equal(resolution.sha256RelativePath, "resources/bin/win32-x64/ImeWatcher.exe.sha256");
  });

  test("resolves the Windows ARM64 helper path", () => {
    const resolution = resolveNativeHelper({
      platform: "win32",
      arch: "arm64",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/win32-arm64/ImeWatcher.exe");
    assert.equal(resolution.relativePath, "resources/bin/win32-arm64/ImeWatcher.exe");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "win-arm64");
  });

  test("resolves macOS helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "darwin",
      arch: "arm64",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/darwin-arm64/ImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/darwin-arm64/ImeWatcher");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "darwin-arm64");
  });

  test("resolves Linux x64 helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "linux",
      arch: "x64",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/linux-x64/ImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/linux-x64/ImeWatcher");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "linux-x64");
  });

  test("resolves Linux ARM64 helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "linux",
      arch: "arm64",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/linux-arm64/ImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/linux-arm64/ImeWatcher");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "linux-arm64");
  });

  test("resolves Linux ARM hard-float helper paths", () => {
    const resolution = resolveNativeHelper({
      platform: "linux",
      arch: "arm",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, "/extension/resources/bin/linux-armhf/ImeWatcher");
    assert.equal(resolution.relativePath, "resources/bin/linux-armhf/ImeWatcher");
    assert.equal(resolution.backendName, "ime-watcher");
    assert.equal(resolution.platformKey, "linux-armhf");
  });

  test("manifest declares resolvable helper resources and sha256 sidecars", () => {
    for (const helper of helperManifestEntries()) {
      assert.ok(helper.resourcePath.startsWith("resources/bin/"), helper.resourcePath);
      assert.ok(helper.sha256Path.startsWith("resources/bin/"), helper.sha256Path);
      assert.equal(helper.sha256Path, `${helper.resourcePath}.sha256`);
      assert.ok(helper.platformKey.length > 0);
      assert.ok(helper.backendName.length > 0);
    }
  });

  test("returns an unavailable reason when the manifest cannot be loaded", () => {
    const resolution = resolveNativeHelper({
      platform: "win32",
      arch: "x64",
      asAbsolutePath,
      manifestPath: "C:/definitely/missing/helper-manifest.json"
    });

    assert.equal(resolution.helperPath, undefined);
    assert.ok("reason" in resolution);
    assert.match(resolution.reason, /清单无法加载/);
  });

  test("rejects unsupported helper manifest versions", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-ime-hud-manifest-"));
    try {
      const manifestPath = path.join(tempDir, "helper-manifest.json");
      fs.writeFileSync(manifestPath, JSON.stringify({ version: 2, helpers: [] }), "utf8");

      const resolution = resolveNativeHelper({
        platform: "win32",
        arch: "x64",
        asAbsolutePath,
        manifestPath
      });

      assert.equal(resolution.helperPath, undefined);
      assert.ok("reason" in resolution);
      assert.match(resolution.reason, /辅助程序清单无效/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("returns an unavailable reason for unsupported architectures", () => {
    const resolution = resolveNativeHelper({
      platform: "darwin",
      arch: "ia32",
      asAbsolutePath
    });

    assert.equal(resolution.helperPath, undefined);
    assert.ok("reason" in resolution);
    assert.match(resolution.reason, /darwin\/ia32/);
  });
});

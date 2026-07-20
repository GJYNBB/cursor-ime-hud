import * as assert from "node:assert";
import * as vscode from "vscode";
import { LoggerService } from "../../services/LoggerService";
import { SettingsService } from "../../services/SettingsService";

/**
 * High-leverage unit tests for the service layer. These tests run against
 * the real VS Code Extension Host (the test runner boots a workspace) so
 * `vscode.workspace.getConfiguration` reads the configuration namespace
 * directly. The test only mutates a private copy of the config so the
 * rest of the test suite is unaffected.
 */
suite("Services", () => {
  const originalValues: Record<string, unknown> = {};

  async function readSetting<T>(key: string): Promise<T | undefined> {
    const configuration = vscode.workspace.getConfiguration("cursorImeHud");
    return configuration.get<T>(key);
  }

  async function setSetting(key: string, value: unknown): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("cursorImeHud");
    const fullKey = key.startsWith("overlay.") ? key : `overlay.${key}`;
    await configuration.update(fullKey, value, vscode.ConfigurationTarget.Global);
  }

  suiteSetup(async () => {
    // Snapshot a few settings so we can restore them at the end and not
    // pollute the user's real configuration.
    for (const key of [
      "overlay.opacity",
      "overlay.offsetX",
      "overlay.offsetY",
      "overlay.labelPreset",
      "overlay.cnColor",
      "overlay.enColor",
      "overlay.backgroundEnabled",
      "overlay.backgroundOpacity",
      "overlay.mode"
    ]) {
      originalValues[key] = await readSetting(key);
    }
  });

  suiteTeardown(async () => {
    for (const [key, value] of Object.entries(originalValues)) {
      await setSetting(key, value);
    }
  });

  suite("SettingsService.clampNumber", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("clamps out-of-range values", async () => {
      await setSetting("opacity", -1);
      assert.equal(service.getSettings().opacity, 0.15, "values below minimum clamp to minimum");

      await setSetting("opacity", 0);
      assert.equal(service.getSettings().opacity, 0.15, "values below minimum clamp to minimum");

      await setSetting("opacity", 0.149);
      assert.equal(service.getSettings().opacity, 0.15, "sub-minimum floats clamp to minimum");

      await setSetting("opacity", 0.15);
      assert.equal(service.getSettings().opacity, 0.15, "boundary value passes through");

      await setSetting("opacity", 1);
      assert.equal(service.getSettings().opacity, 1, "maximum boundary passes through");

      await setSetting("opacity", 1.5);
      assert.equal(service.getSettings().opacity, 1, "values above maximum clamp to maximum");

      await setSetting("opacity", 100);
      assert.equal(service.getSettings().opacity, 1, "huge values clamp to maximum");
    });

    test("preserves the non-boundary default", async () => {
      await setSetting("opacity", 0.78);
      assert.equal(service.getSettings().opacity, 0.78);
    });

    test("clamps background opacity independently", async () => {
      await setSetting("backgroundOpacity", undefined);
      assert.equal(service.getSettings().backgroundOpacity, 0.72);

      await setSetting("backgroundOpacity", -0.1);
      assert.equal(service.getSettings().backgroundOpacity, 0);

      await setSetting("backgroundOpacity", 0.42);
      assert.equal(service.getSettings().backgroundOpacity, 0.42);

      await setSetting("backgroundOpacity", 2);
      assert.equal(service.getSettings().backgroundOpacity, 1);
    });

    test("clamps horizontal and vertical offsets to -50..50", async () => {
      await setSetting("offsetX", 6);
      assert.equal(service.getSettings().offsetX, 6, "default horizontal offset passes through");

      await setSetting("offsetX", 50);
      assert.equal(service.getSettings().offsetX, 50, "maximum horizontal boundary passes through");

      await setSetting("offsetX", 51);
      assert.equal(service.getSettings().offsetX, 50, "horizontal values above maximum clamp");

      await setSetting("offsetX", -50);
      assert.equal(
        service.getSettings().offsetX,
        -50,
        "minimum horizontal boundary passes through"
      );

      await setSetting("offsetX", -51);
      assert.equal(service.getSettings().offsetX, -50, "horizontal values below minimum clamp");

      await setSetting("offsetY", 20);
      assert.equal(service.getSettings().offsetY, 20, "default vertical offset passes through");

      await setSetting("offsetY", 50);
      assert.equal(service.getSettings().offsetY, 50, "maximum vertical boundary passes through");

      await setSetting("offsetY", 51);
      assert.equal(service.getSettings().offsetY, 50, "vertical values above maximum clamp");

      await setSetting("offsetY", -50);
      assert.equal(service.getSettings().offsetY, -50, "minimum vertical boundary passes through");

      await setSetting("offsetY", -51);
      assert.equal(service.getSettings().offsetY, -50, "vertical values below minimum clamp");
    });
  });

  suite("SettingsService.overlayMode", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("uses the square icon mode by default", async () => {
      await setSetting("mode", undefined);
      assert.equal(service.getSettings().overlayMode, "text+icon");
    });

    test("allows switching back to compact text mode", async () => {
      await setSetting("mode", "text");
      assert.equal(service.getSettings().overlayMode, "text");
    });
  });

  suite("SettingsService.asBoolean", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("uses rounded label backgrounds by default", async () => {
      await setSetting("backgroundEnabled", undefined);
      assert.equal(service.getSettings().backgroundEnabled, true);
    });

    test("allows disabling rounded label backgrounds", async () => {
      await setSetting("backgroundEnabled", false);
      assert.equal(service.getSettings().backgroundEnabled, false);
    });
  });

  suite("SettingsService.asColor", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("uses the blue/red defaults when unset", async () => {
      await setSetting("cnColor", undefined);
      await setSetting("enColor", undefined);
      assert.equal(service.getSettings().cnColor, "#FF5252");
      assert.equal(service.getSettings().enColor, "#1E90FF");
    });

    test("accepts valid hex, rgb(), and keyword colors", async () => {
      await setSetting("cnColor", "#0af");
      assert.equal(service.getSettings().cnColor, "#0af");

      await setSetting("cnColor", "rgb(10, 20, 30)");
      assert.equal(service.getSettings().cnColor, "rgb(10, 20, 30)");

      await setSetting("enColor", "tomato");
      assert.equal(service.getSettings().enColor, "tomato");

      await setSetting("enColor", "  #1E90FF  ");
      assert.equal(service.getSettings().enColor, "#1E90FF", "surrounding whitespace is trimmed");
    });

    test("rejects malformed or CSS-breaking values", async () => {
      await setSetting("cnColor", "#12");
      assert.equal(service.getSettings().cnColor, "#FF5252", "too-short hex falls back");

      await setSetting("cnColor", "red; position: fixed");
      assert.equal(service.getSettings().cnColor, "#FF5252", "values with ';' fall back");

      await setSetting("enColor", "bleu");
      assert.equal(service.getSettings().enColor, "#1E90FF", "unknown color keywords fall back");

      await setSetting("enColor", "");
      assert.equal(service.getSettings().enColor, "#1E90FF", "empty string falls back");
    });
  });

  suite("SettingsService.labelPreset", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("resolves the built-in label presets", async () => {
      await setSetting("labelPreset", "zh-en");
      assert.equal(service.getSettings().labelPreset, "zh-en");
      assert.equal(service.getSettings().cnLabel, "中");
      assert.equal(service.getSettings().enLabel, "英");

      await setSetting("labelPreset", "en-zh");
      assert.equal(service.getSettings().labelPreset, "en-zh");
      assert.equal(service.getSettings().cnLabel, "ZH");
      assert.equal(service.getSettings().enLabel, "EN");
    });

    test("falls back to Chinese-character labels for invalid or legacy presets", async () => {
      await setSetting("labelPreset", "invalid-preset");
      assert.equal(service.getSettings().labelPreset, "zh-en");
      assert.equal(service.getSettings().cnLabel, "中");
      assert.equal(service.getSettings().enLabel, "英");

      await setSetting("labelPreset", "custom");
      assert.equal(service.getSettings().labelPreset, "zh-en");
      assert.equal(service.getSettings().cnLabel, "中");
      assert.equal(service.getSettings().enLabel, "英");
    });
  });

  suite("LoggerService", () => {
    test("caps the in-memory ring buffer at 200 entries", () => {
      const channel: vscode.OutputChannel = {
        name: "test",
        append: () => undefined,
        appendLine: () => undefined,
        replace: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined
      };
      const logger = new LoggerService(channel);

      for (let i = 0; i < 250; i += 1) {
        logger.info(`entry-${i}`);
      }

      const recent = logger.getRecentEntries(1000);
      assert.equal(recent.length, 200, "ring buffer caps at MAX_LOG_ENTRIES");
      // The oldest 50 entries should have been shifted out; the very
      // first surviving entry must therefore be entry-50.
      assert.equal((recent[0] as { message: string }).message, "entry-50");
      assert.equal((recent[recent.length - 1] as { message: string }).message, "entry-249");

      logger.dispose();
    });

    test("redacts path-like diagnostic details before storing logs", () => {
      const channel: vscode.OutputChannel = {
        name: "test",
        append: () => undefined,
        appendLine: () => undefined,
        replace: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined
      };
      const logger = new LoggerService(channel);

      logger.info("started", {
        helperPath: "/Users/secret/project/resources/bin/win32-x64/ImeWatcher.exe",
        nested: { error: "spawn C:\\Users\\secret\\ImeWatcher.exe ENOENT" }
      });

      const [entry] = logger.getRecentEntries(1);
      const serialized = JSON.stringify(entry);
      assert.equal(serialized.includes("/Users/secret/project"), false);
      assert.equal(serialized.includes("C:\\Users\\secret"), false);
      assert.equal(serialized.includes("<path>"), true);

      logger.dispose();
    });

    test("redacts path-like logs when paths contain spaces", () => {
      const outputLines: string[] = [];
      const channel: vscode.OutputChannel = {
        name: "test",
        append: () => undefined,
        appendLine: (value: string) => outputLines.push(value),
        replace: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined
      };
      const logger = new LoggerService(channel);

      logger.error("helper failed at C:\\Users\\Jane Doe\\helper.exe", {
        windowsUserPath: "spawn C:\\Users\\Jane Doe\\helper.exe ENOENT",
        windowsProgramFilesPath: "spawn C:\\Program Files\\Foo\\bar.exe ENOENT",
        posixPath: "/Users/Jane Doe/helper failed",
        nested: new Error("open /Users/Jane Doe/helper failed")
      });

      const serializedEntry = JSON.stringify(logger.getRecentEntries(1));
      const serializedOutput = outputLines.join("\n");
      for (const serialized of [serializedEntry, serializedOutput]) {
        assert.equal(serialized.includes("Jane Doe"), false);
        assert.equal(serialized.includes("Doe\\\\helper.exe"), false);
        assert.equal(serialized.includes("Program Files"), false);
        assert.equal(serialized.includes("Files\\\\Foo"), false);
        assert.equal(serialized.includes("Foo\\\\bar.exe"), false);
        assert.equal(serialized.includes("Doe/helper"), false);
        assert.equal(serialized.includes("<path>"), true);
      }

      logger.dispose();
    });

    test("tolerates circular JSON in the details payload", () => {
      const channel: vscode.OutputChannel = {
        name: "test",
        append: () => undefined,
        appendLine: () => undefined,
        replace: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined
      };
      const logger = new LoggerService(channel);

      const circular: Record<string, unknown> = { name: "circular" };
      circular.self = circular;

      // The logger must not throw on circular structures; the safe path
      // is to fall back to `String(details)` rather than crashing the
      // whole extension.
      assert.doesNotThrow(() => logger.warn("circular details", circular));

      const entries = logger.getRecentEntries(1);
      assert.equal(entries.length, 1);
      assert.equal((entries[0] as { message: string }).message, "circular details");

      logger.dispose();
    });
  });
});

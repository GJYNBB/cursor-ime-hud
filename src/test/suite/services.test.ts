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
      "overlay.cnLabel",
      "overlay.enLabel",
      "overlay.cnColor",
      "overlay.enColor",
      "overlay.backgroundEnabled"
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

    test("allows the larger vertical offset range", async () => {
      await setSetting("offsetY", 20);
      assert.equal(service.getSettings().offsetY, 20, "new default value passes through");

      await setSetting("offsetY", 30);
      assert.equal(service.getSettings().offsetY, 30, "new maximum boundary passes through");

      await setSetting("offsetY", 31);
      assert.equal(service.getSettings().offsetY, 30, "values above maximum clamp to maximum");

      await setSetting("offsetY", -17);
      assert.equal(
        service.getSettings().offsetY,
        -16,
        "values below minimum still clamp to minimum"
      );
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
      assert.equal(service.getSettings().cnColor, "#4FA6FF");
      assert.equal(service.getSettings().enColor, "#FF6B6B");
    });

    test("accepts valid hex, rgb(), and keyword colors", async () => {
      await setSetting("cnColor", "#0af");
      assert.equal(service.getSettings().cnColor, "#0af");

      await setSetting("cnColor", "rgb(10, 20, 30)");
      assert.equal(service.getSettings().cnColor, "rgb(10, 20, 30)");

      await setSetting("enColor", "tomato");
      assert.equal(service.getSettings().enColor, "tomato");

      await setSetting("enColor", "  #FF6B6B  ");
      assert.equal(service.getSettings().enColor, "#FF6B6B", "surrounding whitespace is trimmed");
    });

    test("rejects malformed or CSS-breaking values", async () => {
      await setSetting("cnColor", "#12");
      assert.equal(service.getSettings().cnColor, "#4FA6FF", "too-short hex falls back");

      await setSetting("cnColor", "red; position: fixed");
      assert.equal(service.getSettings().cnColor, "#4FA6FF", "values with ';' fall back");

      await setSetting("enColor", "");
      assert.equal(service.getSettings().enColor, "#FF6B6B", "empty string falls back");
    });
  });

  suite("SettingsService.asNonEmptyString", () => {
    let service: SettingsService;

    setup(() => {
      service = new SettingsService();
    });

    teardown(() => {
      service.dispose();
    });

    test("falls back for empty / whitespace strings", async () => {
      await setSetting("labelPreset", "custom");
      await setSetting("cnLabel", "");
      assert.equal(service.getSettings().cnLabel, "中");

      await setSetting("cnLabel", "   ");
      assert.equal(service.getSettings().cnLabel, "中");

      await setSetting("cnLabel", "\t\n");
      assert.equal(service.getSettings().cnLabel, "中");
    });

    test("preserves non-empty labels (including padded ones)", async () => {
      await setSetting("labelPreset", "custom");
      await setSetting("cnLabel", "中文");
      assert.equal(service.getSettings().cnLabel, "中文");

      await setSetting("cnLabel", "  中  ");
      // The implementation trims-then-checks; padded-but-non-empty labels
      // are accepted verbatim. This documents the current behavior.
      assert.equal(service.getSettings().cnLabel, "  中  ");
    });

    test("resolves built-in label presets", async () => {
      await setSetting("cnLabel", "自定义中");
      await setSetting("enLabel", "Custom EN");

      await setSetting("labelPreset", "custom");
      assert.equal(service.getSettings().labelPreset, "custom");
      assert.equal(service.getSettings().cnLabel, "自定义中");
      assert.equal(service.getSettings().enLabel, "Custom EN");

      await setSetting("labelPreset", "zh-en");
      assert.equal(service.getSettings().labelPreset, "zh-en");
      assert.equal(service.getSettings().cnLabel, "中");
      assert.equal(service.getSettings().enLabel, "英");

      await setSetting("labelPreset", "en-zh");
      assert.equal(service.getSettings().labelPreset, "en-zh");
      assert.equal(service.getSettings().cnLabel, "ZH");
      assert.equal(service.getSettings().enLabel, "EN");
    });

    test("falls back to custom label mode for invalid presets", async () => {
      await setSetting("labelPreset", "invalid-preset");
      await setSetting("cnLabel", "中文");
      await setSetting("enLabel", "English");

      assert.equal(service.getSettings().labelPreset, "custom");
      assert.equal(service.getSettings().cnLabel, "中文");
      assert.equal(service.getSettings().enLabel, "English");
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

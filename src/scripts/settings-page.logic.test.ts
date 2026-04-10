import { describe, expect, it } from "vitest";
import {
  buildConfigFromSettingsForm,
  haveShortcutsChanged,
  prepareSettingsSave,
  type AppConfig,
} from "./settings-page.logic";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    screenshot_shortcut: "Ctrl+Shift+A",
    record_shortcut: "Ctrl+Shift+R",
    save_path: "C:/Users/test/Pictures/Caprail",
    default_image_format: "png",
    auto_start: false,
    language: "zh",
    tray_menu_screenshot: "截图",
    tray_menu_record: "录屏",
    tray_menu_settings: "设置",
    tray_menu_quit: "退出",
    ...overrides,
  };
}

describe("settings-page save payload", () => {
  it("uses edited form values for shortcuts and save options", () => {
    const config = buildConfigFromSettingsForm(makeConfig(), {
      screenshotShortcut: "Ctrl+Alt+A",
      recordShortcut: "Ctrl+Alt+R",
      savePath: "D:/Captures",
      defaultImageFormat: "jpg",
      autoStart: true,
    });

    expect(config.screenshot_shortcut).toBe("Ctrl+Alt+A");
    expect(config.record_shortcut).toBe("Ctrl+Alt+R");
    expect(config.save_path).toBe("D:/Captures");
    expect(config.default_image_format).toBe("jpg");
    expect(config.auto_start).toBe(true);
  });

  it("preserves existing locale and tray labels when saving unrelated settings", () => {
    const existingConfig = makeConfig();

    const config = buildConfigFromSettingsForm(existingConfig, {
      screenshotShortcut: existingConfig.screenshot_shortcut,
      recordShortcut: existingConfig.record_shortcut,
      savePath: "D:/Captures",
      defaultImageFormat: existingConfig.default_image_format,
      autoStart: existingConfig.auto_start,
    });

    expect(config.language).toBe(existingConfig.language);
    expect(config.tray_menu_screenshot).toBe(existingConfig.tray_menu_screenshot);
    expect(config.tray_menu_record).toBe(existingConfig.tray_menu_record);
    expect(config.tray_menu_settings).toBe(existingConfig.tray_menu_settings);
    expect(config.tray_menu_quit).toBe(existingConfig.tray_menu_quit);
  });
});

describe("shortcut change detection", () => {
  it("only reports changes when shortcut values differ", () => {
    const existingConfig = makeConfig();
    const unchanged = makeConfig();
    const changed = makeConfig({ screenshot_shortcut: "Ctrl+Alt+A" });

    expect(haveShortcutsChanged(existingConfig, unchanged)).toBe(false);
    expect(haveShortcutsChanged(existingConfig, changed)).toBe(true);
  });
});

describe("settings save workflow", () => {
  it("keeps localized config intact when only save options change", () => {
    const existingConfig = makeConfig();

    const result = prepareSettingsSave(existingConfig, {
      screenshotShortcut: existingConfig.screenshot_shortcut,
      recordShortcut: existingConfig.record_shortcut,
      savePath: "D:/Captures",
      defaultImageFormat: "jpg",
      autoStart: true,
    });

    expect(result.config.language).toBe("zh");
    expect(result.config.tray_menu_screenshot).toBe("截图");
    expect(result.config.tray_menu_record).toBe("录屏");
    expect(result.config.tray_menu_settings).toBe("设置");
    expect(result.config.tray_menu_quit).toBe("退出");
    expect(result.shortcutsChanged).toBe(false);
    expect(result.shortcutChangePayload).toBeNull();
  });

  it("emits shortcut change payload while preserving localization", () => {
    const existingConfig = makeConfig();

    const result = prepareSettingsSave(existingConfig, {
      screenshotShortcut: "Ctrl+Alt+A",
      recordShortcut: "Ctrl+Alt+R",
      savePath: existingConfig.save_path,
      defaultImageFormat: existingConfig.default_image_format,
      autoStart: existingConfig.auto_start,
    });

    expect(result.shortcutsChanged).toBe(true);
    expect(result.shortcutChangePayload).toEqual({
      oldScreenshot: "Ctrl+Shift+A",
      oldRecord: "Ctrl+Shift+R",
      newScreenshot: "Ctrl+Alt+A",
      newRecord: "Ctrl+Alt+R",
    });
    expect(result.config.language).toBe("zh");
    expect(result.config.tray_menu_screenshot).toBe("截图");
  });
});

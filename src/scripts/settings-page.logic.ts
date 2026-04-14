export interface AppConfig {
  screenshot_shortcut: string;
  record_shortcut: string;
  save_path: string;
  default_image_format: string;
  auto_start: boolean;
  language: string;
  tray_menu_screenshot: string;
  tray_menu_record: string;
  tray_menu_settings: string;
  tray_menu_quit: string;
}

export interface SettingsFormValues {
  screenshotShortcut: string;
  recordShortcut: string;
  savePath: string;
  defaultImageFormat: string;
  autoStart: boolean;
}

export interface ShortcutChangePayload {
  oldScreenshot: string;
  oldRecord: string;
  newScreenshot: string;
  newRecord: string;
}

export interface SettingsSaveResult {
  config: AppConfig;
  shortcutsChanged: boolean;
  shortcutChangePayload: ShortcutChangePayload | null;
}

export function buildConfigFromSettingsForm(
  existingConfig: AppConfig,
  formValues: SettingsFormValues
): AppConfig {
  return {
    screenshot_shortcut: formValues.screenshotShortcut,
    record_shortcut: formValues.recordShortcut,
    save_path: formValues.savePath,
    default_image_format: formValues.defaultImageFormat,
    auto_start: formValues.autoStart,
    tray_menu_screenshot: existingConfig.tray_menu_screenshot,
    tray_menu_record: existingConfig.tray_menu_record,
    tray_menu_settings: existingConfig.tray_menu_settings,
    tray_menu_quit: existingConfig.tray_menu_quit,
    language: existingConfig.language,
  };
}

export function haveShortcutsChanged(
  existingConfig: AppConfig,
  nextConfig: AppConfig
): boolean {
  return (
    existingConfig.screenshot_shortcut !== nextConfig.screenshot_shortcut ||
    existingConfig.record_shortcut !== nextConfig.record_shortcut
  );
}

export function prepareSettingsSave(
  existingConfig: AppConfig,
  formValues: SettingsFormValues
): SettingsSaveResult {
  const config = buildConfigFromSettingsForm(existingConfig, formValues);
  const shortcutsChanged = haveShortcutsChanged(existingConfig, config);

  return {
    config,
    shortcutsChanged,
    shortcutChangePayload: shortcutsChanged
      ? {
          oldScreenshot: existingConfig.screenshot_shortcut,
          oldRecord: existingConfig.record_shortcut,
          newScreenshot: config.screenshot_shortcut,
          newRecord: config.record_shortcut,
        }
      : null,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

let settingsWindow: WebviewWindow | null = null;

function trackSettingsWindow(window: WebviewWindow) {
  settingsWindow = window;
  void window.once("tauri://destroyed", () => {
    if (settingsWindow?.label === window.label) {
      settingsWindow = null;
    }
  });
  void window.once("tauri://error", () => {
    if (settingsWindow?.label === window.label) {
      settingsWindow = null;
    }
  });
}

export async function openSettings() {
  const existingWindow = settingsWindow ?? await WebviewWindow.getByLabel("settings");
  if (existingWindow) {
    settingsWindow = existingWindow;
    try {
      await existingWindow.show();
      await existingWindow.setFocus();
      return;
    } catch {
      settingsWindow = null;
    }
  }

  const window = new WebviewWindow("settings", {
    url: "src/settings.html",
    width: 500,
    height: 450,
    center: true,
    resizable: false,
    title: "Settings",
  });

  trackSettingsWindow(window);
}

export async function saveConfig(config: {
  screenshot_shortcut: string;
  record_shortcut: string;
  save_path: string;
  default_image_format: string;
  auto_start: boolean;
  ocr_engine: string;
}) {
  await invoke("save_config", { config });
}

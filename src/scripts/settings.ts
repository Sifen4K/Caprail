import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

let settingsWindow: WebviewWindow | null = null;

export async function openSettings() {
  if (settingsWindow) {
    settingsWindow.close();
  }

  settingsWindow = new WebviewWindow("settings", {
    url: "src/settings.html",
    width: 500,
    height: 400,
    center: true,
    resizable: false,
    title: "Settings",
  });
}

export async function saveConfig(config: {
  screenshot_shortcut: string;
  record_shortcut: string;
  save_path: string;
  default_image_format: string;
  auto_start: boolean;
}) {
  await invoke("save_config", { config });
}

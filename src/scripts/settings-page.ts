import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { loadLocale } from "./i18n.ts";
import {
  prepareSettingsSave,
  type AppConfig,
} from "./settings-page.logic.ts";

loadLocale("en");

const screenshotInput = document.getElementById("screenshot-shortcut") as HTMLInputElement;
const recordInput = document.getElementById("record-shortcut") as HTMLInputElement;

// Store original shortcuts to detect changes
let originalScreenshotShortcut = "";
let originalRecordShortcut = "";
let loadedConfig: AppConfig | null = null;

// Load config
invoke<AppConfig>("load_config").then((config) => {
  loadedConfig = config;
  originalScreenshotShortcut = config.screenshot_shortcut;
  originalRecordShortcut = config.record_shortcut;
  screenshotInput.value = config.screenshot_shortcut;
  recordInput.value = config.record_shortcut;
  (document.getElementById("save-path") as HTMLInputElement).value = config.save_path;
  (document.getElementById("default-format") as HTMLSelectElement).value = config.default_image_format;
  (document.getElementById("auto-start") as HTMLInputElement).checked = config.auto_start;
});

// Shortcut key capture
function setupShortcutCapture(input: HTMLInputElement) {
  input.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    // Map key to display name
    const key = e.key;
    if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
      const keyName = key.length === 1 ? key.toUpperCase() : key;
      parts.push(keyName);
      input.value = parts.join("+");
    }
  });

  input.addEventListener("focus", () => {
    input.style.borderColor = "#4CAF50";
    input.placeholder = "Press shortcut...";
  });

  input.addEventListener("blur", () => {
    input.style.borderColor = "#444";
    input.placeholder = "";
  });
}

setupShortcutCapture(screenshotInput);
setupShortcutCapture(recordInput);

// Save button
document.getElementById("save")!.onclick = async () => {
  const existingConfig = loadedConfig ?? await invoke<AppConfig>("load_config").catch(() => ({
    screenshot_shortcut: originalScreenshotShortcut,
    record_shortcut: originalRecordShortcut,
    save_path: "",
    default_image_format: "png",
    auto_start: false,
    language: "en",
    tray_menu_screenshot: "Screenshot",
    tray_menu_record: "Record",
    tray_menu_settings: "Settings",
    tray_menu_quit: "Quit",
  }));

  const saveResult = prepareSettingsSave(existingConfig, {
    screenshotShortcut: screenshotInput.value,
    recordShortcut: recordInput.value,
    savePath: (document.getElementById("save-path") as HTMLInputElement).value,
    defaultImageFormat: (document.getElementById("default-format") as HTMLSelectElement).value,
    autoStart: (document.getElementById("auto-start") as HTMLInputElement).checked,
  });
  const { config } = saveResult;

  // Validate shortcuts
  if (!config.screenshot_shortcut || !config.record_shortcut) {
    alert("Both shortcuts must be set!");
    return;
  }

  // Check shortcut format: should have at least one modifier + one key
  const validateShortcut = (shortcut: string, name: string): boolean => {
    const parts = shortcut.split("+");
    if (parts.length < 2) {
      alert(`${name} must include at least one modifier (Ctrl/Shift/Alt) and one key`);
      return false;
    }
    const modifiers = ["Ctrl", "Shift", "Alt"];
    const hasModifier = parts.some(p => modifiers.includes(p));
    if (!hasModifier) {
      alert(`${name} must include at least one modifier (Ctrl/Shift/Alt)`);
      return false;
    }
    return true;
  };

  if (!validateShortcut(config.screenshot_shortcut, "Screenshot shortcut")) return;
  if (!validateShortcut(config.record_shortcut, "Record shortcut")) return;

  // Basic conflict detection
  if (config.screenshot_shortcut === config.record_shortcut) {
    alert("Screenshot and record shortcuts cannot be the same!");
    return;
  }

  // Check if shortcuts changed
  await invoke("save_config", { config });

  // Notify main window to re-register shortcuts if they changed
  if (saveResult.shortcutsChanged && saveResult.shortcutChangePayload) {
    await emit("shortcuts-changed", saveResult.shortcutChangePayload);
  }

  window.close();
};

import { invoke } from "@tauri-apps/api/core";

interface AppConfig {
  screenshot_shortcut: string;
  record_shortcut: string;
  save_path: string;
  default_image_format: string;
  auto_start: boolean;
}

const screenshotInput = document.getElementById("screenshot-shortcut") as HTMLInputElement;
const recordInput = document.getElementById("record-shortcut") as HTMLInputElement;

// Load config
invoke<AppConfig>("load_config").then((config) => {
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
  const config: AppConfig = {
    screenshot_shortcut: screenshotInput.value,
    record_shortcut: recordInput.value,
    save_path: (document.getElementById("save-path") as HTMLInputElement).value,
    default_image_format: (document.getElementById("default-format") as HTMLSelectElement).value,
    auto_start: (document.getElementById("auto-start") as HTMLInputElement).checked,
  };

  // Basic conflict detection
  if (config.screenshot_shortcut === config.record_shortcut) {
    alert("Screenshot and record shortcuts cannot be the same!");
    return;
  }

  await invoke("save_config", { config });
  window.close();
};

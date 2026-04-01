import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const status = document.getElementById("status")!;

let isCapturing = false;
let editorCounter = 0;

function updateStatus(msg: string) {
  status.textContent = msg;
}

// Convert "Ctrl+Shift+A" to "CommandOrControl+Shift+A" for Tauri
function toTauriShortcut(shortcut: string): string {
  return shortcut.replace(/Ctrl/gi, "CommandOrControl");
}

async function registerShortcuts() {
  try {
    const config = await invoke<{
      screenshot_shortcut: string;
      record_shortcut: string;
    }>("load_config");

    const screenshotKey = toTauriShortcut(config.screenshot_shortcut);
    const recordKey = toTauriShortcut(config.record_shortcut);

    await register(screenshotKey, async (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      if (isCapturing) return;
      isCapturing = true;
      updateStatus("Screenshot shortcut triggered");
      const { createScreenCaptureWindow } = await import("./screenshots");
      await createScreenCaptureWindow();
    });

    await register(recordKey, async (event: ShortcutEvent) => {
      if (event.state !== "Pressed") return;
      if (isCapturing) return;
      isCapturing = true;
      updateStatus("Record shortcut triggered");
      const { createRecordingCaptureWindow } = await import("./recording");
      await createRecordingCaptureWindow();
    });

    updateStatus(`Shortcuts registered: ${screenshotKey}, ${recordKey}`);
  } catch (e) {
    updateStatus(`Shortcut error: ${e}`);
  }
}

async function openEditorWindow(data: { path: string; width: number; height: number }) {
  // Entered editor — allow shortcuts again
  isCapturing = false;

  const encodedPath = encodeURIComponent(data.path);
  new WebviewWindow(`editor-${++editorCounter}`, {
    url: `src/editor.html?path=${encodedPath}`,
    width: Math.min(data.width + 40, 1600),
    height: Math.min(data.height + 80, 1000),
    center: true,
    title: "Screenshot Editor",
    resizable: true,
  });
}

let pinCounter = 0;

async function openPinWindow(data: { path: string; width: number; height: number }) {
  // Pinned to screen — allow shortcuts again
  isCapturing = false;

  const id = `pin-${++pinCounter}`;
  const encodedPath = encodeURIComponent(data.path);
  new WebviewWindow(id, {
    url: `src/pin.html?path=${encodedPath}`,
    width: Math.min(data.width, 800),
    height: Math.min(data.height, 600),
    center: true,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: "Pin",
  });
}

async function openClipEditor(videoPath: string) {
  isCapturing = false;

  const encodedPath = encodeURIComponent(videoPath);
  new WebviewWindow("clip-editor", {
    url: `src/clip-editor.html?path=${encodedPath}`,
    width: 900,
    height: 650,
    center: true,
    title: "Recording Editor",
    resizable: true,
  });
}

async function setup() {
  // Listen for screenshot captured from overlay
  await listen<{ path: string; width: number; height: number }>(
    "screenshot-captured",
    (event) => {
      updateStatus("Screenshot captured, opening editor...");
      openEditorWindow(event.payload);
    }
  );

  // Listen for pin requests from editor
  await listen<{ path: string; width: number; height: number }>(
    "pin-screenshot",
    (event) => {
      updateStatus("Pinning screenshot...");
      openPinWindow(event.payload);
    }
  );

  // Listen for overlay cancelled (Escape or closed without capture)
  await listen("screenshot-cancelled", () => {
    isCapturing = false;
    updateStatus("Ready");
  });

  await listen("recording-cancelled", () => {
    isCapturing = false;
    updateStatus("Ready");
  });

  // Listen for recording area selection
  await listen<{ x: number; y: number; width: number; height: number }>(
    "recording-area-selected",
    async (event) => {
      const { x, y, width, height } = event.payload;
      updateStatus("Starting recording...");

      const config = await invoke<{ save_path: string }>("load_config");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const outputPath = `${config.save_path}\\recording-${timestamp}.mp4`;

      try {
        await invoke("start_recording", {
          config: { x, y, width, height, fps: 30, outputPath },
        });

        // Open recording control bar
        new WebviewWindow("record-control", {
          url: "src/record-control.html",
          width: 220,
          height: 52,
          x: Math.round(x + width / 2 - 110),
          y: y + height + 10,
          decorations: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          title: "Recording",
        });
      } catch (err) {
        updateStatus(`Recording error: ${err}`);
        isCapturing = false;
      }
    }
  );

  // Listen for recording stopped
  await listen<{ path: string }>("recording-stopped", (event) => {
    updateStatus(`Recording saved: ${event.payload.path}`);
    openClipEditor(event.payload.path);
  });

  await listen("tray-screenshot", () => {
    if (isCapturing) return;
    isCapturing = true;
    updateStatus("Screenshot from tray");
    import("./screenshots").then(({ createScreenCaptureWindow }) =>
      createScreenCaptureWindow()
    );
  });

  await listen("tray-record", () => {
    if (isCapturing) return;
    isCapturing = true;
    updateStatus("Record from tray");
    import("./recording").then(({ createRecordingCaptureWindow }) =>
      createRecordingCaptureWindow()
    );
  });

  await listen("tray-settings", () => {
    updateStatus("Opening settings...");
    import("./settings").then(({ openSettings }) => openSettings());
  });

  await registerShortcuts();
  updateStatus("Ready");
}

setup();

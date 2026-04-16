import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { register, unregister, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { resolution, type PhysicalPixel } from "./resolution-context";
import { computeCenteredRect, computeControlWindowGeometry } from "./physical-capture.logic";
import { t } from "./i18n";

const status = document.getElementById("status")!;

let isCapturing = false;
let editorCounter = 0;
let registeredShortcuts: string[] = []; // Track registered shortcuts for cleanup
let startupWarningShown = false;

function updateStatus(msg: string) {
  status.textContent = msg;
}

// Convert "Ctrl+Shift+A" to "CommandOrControl+Shift+A" for Tauri
function toTauriShortcut(shortcut: string): string {
  return shortcut.replace(/Ctrl/gi, "CommandOrControl");
}

// Cleanup shortcuts on exit
async function cleanupShortcuts() {
  console.log("Cleaning up shortcuts:", registeredShortcuts);
  for (const shortcut of registeredShortcuts) {
    try {
      await unregister(shortcut);
    } catch (e) {
      console.log("Failed to unregister", shortcut, e);
    }
  }
  registeredShortcuts = [];
}

async function registerShortcuts() {
  try {
    const config = await invoke<{
      screenshot_shortcut: string;
      record_shortcut: string;
    }>("load_config");

    const screenshotKey = toTauriShortcut(config.screenshot_shortcut);
    const recordKey = toTauriShortcut(config.record_shortcut);

    console.log("Registering shortcuts:", screenshotKey, recordKey);

    // Unregister shortcuts first (in case previous instance didn't clean up)
    try {
      await unregister(screenshotKey);
      await unregister(recordKey);
      console.log("Unregistered existing shortcuts");
    } catch (e) {
      // Ignore errors - shortcuts may not have been registered
      console.log("Unregister skipped:", e);
    }

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

    // Save registered shortcuts for cleanup
    registeredShortcuts = [screenshotKey, recordKey];

    console.log("Shortcuts registered successfully");
    updateStatus(`Shortcuts registered: ${screenshotKey}, ${recordKey}`);
  } catch (e) {
    console.error("Shortcut registration error:", e);
    updateStatus(`Shortcut error: ${e}`);

    // Show notification for error
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      if (granted) {
        sendNotification({
          title: "Caprail Shortcut Error",
          body: `Failed to register shortcuts: ${e}`,
        });
      }
    } catch (notifError) {
      console.error("Notification error:", notifError);
    }
  }
}

async function canSendStartupToast() {
  try {
    return await isPermissionGranted();
  } catch (error) {
    console.error("Notification permission error:", error);
    return false;
  }
}

async function showStartupToast(titleKey: string, bodyKey: string) {
  if (!(await canSendStartupToast())) {
    return;
  }

  try {
    sendNotification({
      title: t(titleKey),
      body: t(bodyKey),
    });
  } catch (error) {
    console.error("Startup notification error:", error);
  }
}

async function openEditorWindow(data: { id: number; width: number; height: number }) {
  // Entered editor — allow shortcuts again
  isCapturing = false;

  new WebviewWindow(`editor-${++editorCounter}`, {
    url: `src/editor.html?id=${data.id}&width=${data.width}&height=${data.height}`,
    width: Math.min(data.width + 40, 1600),
    height: Math.min(data.height + 80, 1000),
    center: true,
    title: "Caprail Editor",
    resizable: true,
  });
}

let pinCounter = 0;

async function openPinWindow(data: { id: number; width: number; height: number }) {
  // Pinned to screen — allow shortcuts again
  isCapturing = false;

  const id = `pin-${++pinCounter}`;

  await resolution.refresh().catch(() => {});
  const desktopBounds = resolution.getVirtualDesktopBounds();
  const pinRect = computeCenteredRect(data.width, data.height, desktopBounds);

  const pinWindow = new WebviewWindow(id, {
    url: `src/pin.html?pinId=${data.id}&width=${data.width}&height=${data.height}`,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: "Pin",
  });

  pinWindow.once("tauri://created", async () => {
    try {
      await pinWindow.setSize(new PhysicalSize(pinRect.width, pinRect.height));
      await pinWindow.setPosition(new PhysicalPosition(pinRect.x, pinRect.y));
    } catch (e) {
      console.error("Failed to apply pin window physical geometry:", e);
    }
  });
}

async function showClipEditor() {
  isCapturing = false;
  const clipEditor = await WebviewWindow.getByLabel("clip-editor");

  if (clipEditor) {
    await clipEditor.show();
    await clipEditor.center();
    await emit("recording-data-ready", {});
    return;
  }

  new WebviewWindow("clip-editor", {
    url: "src/clip-editor.html",
    width: 900,
    height: 650,
    center: true,
    title: "Recording Editor",
    resizable: true,
  });
}

function withArch(templateKey: string, arch: string) {
  return t(templateKey).replace("%ARCH%", arch);
}

function getOcrEngineLabel(engine: string) {
  switch (engine) {
    case "paddle":
      return t("settings.ocrEngineOptions.paddle");
    case "tesseract":
      return t("settings.ocrEngineOptions.tesseract");
    case "windows":
    default:
      return t("settings.ocrEngineOptions.windows");
  }
}

function withEngine(templateKey: string, engine: string) {
  return t(templateKey).replace("%ENGINE%", getOcrEngineLabel(engine));
}

async function runStartupDiagnostics() {
  try {
    const config = await invoke<{
      ocr_engine?: string;
    }>("load_config");
    const selectedEngine = (config.ocr_engine ?? "windows").toLowerCase();

    if (selectedEngine === "paddle") {
      await showStartupToast("appShell.startup.ocrInitTitle", "appShell.startup.ocrInitBody");
    }

    const diagnostics = await invoke<{
      arch: string;
      selectedOcrEngine: string;
      ocrAvailable: boolean;
      ffmpegAvailable: boolean;
    }>("startup_diagnostics");

    if (diagnostics.ocrAvailable && diagnostics.selectedOcrEngine === "paddle") {
      await showStartupToast("appShell.startup.ocrReadyTitle", "appShell.startup.ocrReadyBody");
    }

    const warnings: string[] = [];
    if (!diagnostics.ocrAvailable) {
      warnings.push(withEngine("appShell.startup.ocrMissing", diagnostics.selectedOcrEngine));
    }
    if (!diagnostics.ffmpegAvailable) {
      warnings.push(withArch("appShell.startup.ffmpegMissing", diagnostics.arch));
    }

    if (warnings.length > 0 && !startupWarningShown) {
      startupWarningShown = true;
      await message(
        `${warnings.join("\n\n")}\n\n${t("appShell.startup.footer")}`,
        {
          title: t("appShell.startup.title"),
          kind: "warning",
        }
      );
    }
  } catch (error) {
    console.error("Startup diagnostics failed:", error);
  }
}

async function setup() {
  // Initialise resolution context once at startup so monitor info is available
  // for pin window sizing and other operations before overlays are created.
  try {
    await resolution.init();
  } catch {
    // Non-fatal: resolution context falls back to defaults
  }

  // Listen for screenshot captured from overlay
  await listen<{ id: number; width: number; height: number }>(
    "screenshot-captured",
    (event) => {
      updateStatus("Screenshot captured, opening editor...");
      openEditorWindow(event.payload);
    }
  );

  // Listen for pin requests from editor
  await listen<{ id: number; width: number; height: number }>(
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

  await listen("recording-cancelled", async () => {
    isCapturing = false;
    updateStatus("Ready");
  });

  // Listen for recording area selection
  await listen<{
    x: number; y: number; width: number; height: number;
  }>(
    "recording-area-selected",
    async (event) => {
      const { x, y, width, height } = event.payload;
      updateStatus("Starting recording...");

      // Step 1: Close the record-overlay (red selection border) and wait
      // for it to be fully destroyed before proceeding.  This avoids a
      // race condition where the overlay is still on-screen when the
      // first recording frames are captured.
      const overlayWindow = await WebviewWindow.getByLabel("record-overlay");
      if (overlayWindow) {
        // Set up a promise that resolves when the window is destroyed,
        // with a safety timeout so we never block forever.
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };

          overlayWindow.once("tauri://destroyed", done);

          // Safety timeout: if the destroyed event never arrives (e.g.
          // the window was already gone or the reference is stale),
          // continue after 2 seconds to avoid hanging.
          setTimeout(done, 2000);

          // Initiate the close — the promise above will wait for the
          // actual destruction event.
          overlayWindow.close();
        });
      }

      try {
        await resolution.refresh().catch(() => {});
        const selectionCenterX = x + width / 2;
        const selectionCenterY = y + height / 2;
        const controlScale = resolution.getScaleFactorAtPhysical(
          selectionCenterX as PhysicalPixel,
          selectionCenterY as PhysicalPixel,
        );
        const desktopBounds = resolution.getVirtualDesktopBounds();
        const controlRect = computeControlWindowGeometry(
          { x, y, width, height },
          desktopBounds,
          controlScale,
        );
        await invoke("start_recording_workflow", {
          workflow: {
            recording: { x, y, width, height, fps: 30 },
            control: controlRect,
          },
        });
      } catch (err) {
        updateStatus(`Recording error: ${err}`);
        isCapturing = false;
      }
    }
  );

  // Listen for recording stopped
  await listen("recording-stopped", async () => {
    updateStatus("Recording stopped, opening editor...");
    showClipEditor();
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

  // Listen for quit event and cleanup before exit
  await listen("tray-quit", async () => {
    updateStatus("Exiting...");
    await cleanupShortcuts();
  });

  // Listen for shortcut changes from settings
  await listen<{
    oldScreenshot: string;
    oldRecord: string;
    newScreenshot: string;
    newRecord: string;
  }>("shortcuts-changed", async (event) => {
    const { oldScreenshot, oldRecord, newScreenshot, newRecord } = event.payload;
    console.log("Shortcuts changed, re-registering...");

    // Validate new shortcuts
    if (!newScreenshot || !newRecord) {
      console.error("Empty shortcut received");
      return;
    }

    const newScreenshotKey = toTauriShortcut(newScreenshot);
    const newRecordKey = toTauriShortcut(newRecord);

    // Try to register new shortcuts first (before unregistering old ones)
    // This way we can rollback if registration fails
    let screenshotRegistered = false;
    let recordRegistered = false;

    try {
      await register(newScreenshotKey, async (e: ShortcutEvent) => {
        if (e.state !== "Pressed") return;
        if (isCapturing) return;
        isCapturing = true;
        updateStatus("Screenshot shortcut triggered");
        const { createScreenCaptureWindow } = await import("./screenshots");
        await createScreenCaptureWindow();
      });
      screenshotRegistered = true;

      await register(newRecordKey, async (e: ShortcutEvent) => {
        if (e.state !== "Pressed") return;
        if (isCapturing) return;
        isCapturing = true;
        updateStatus("Record shortcut triggered");
        const { createRecordingCaptureWindow } = await import("./recording");
        await createRecordingCaptureWindow();
      });
      recordRegistered = true;

      // New shortcuts registered successfully, now unregister old ones
      const oldScreenshotKey = toTauriShortcut(oldScreenshot);
      const oldRecordKey = toTauriShortcut(oldRecord);
      try {
        await unregister(oldScreenshotKey);
        await unregister(oldRecordKey);
      } catch (e) {
        console.log("Failed to unregister old shortcuts:", e);
      }

      registeredShortcuts = [newScreenshotKey, newRecordKey];
      console.log("New shortcuts registered:", newScreenshotKey, newRecordKey);
      updateStatus(`Shortcuts updated: ${newScreenshotKey}, ${newRecordKey}`);
    } catch (e) {
      console.error("Failed to register new shortcuts:", e);
      updateStatus(`Shortcut update error: ${e}`);

      // Rollback: unregister any newly registered shortcuts
      if (screenshotRegistered) {
        try { await unregister(newScreenshotKey); } catch {}
      }
      if (recordRegistered) {
        try { await unregister(newRecordKey); } catch {}
      }

      // Show error notification
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          sendNotification({
            title: "Shortcut Update Failed",
            body: `Failed to register new shortcuts: ${e}. Old shortcuts still active.`,
          });
        }
      } catch (notifError) {
        console.error("Notification error:", notifError);
      }
    }
  });

  await registerShortcuts();
  updateStatus("Ready");
  void runStartupDiagnostics();
}

// Cleanup on page unload (backup cleanup - use synchronous unregister via plugin API)
// Note: async cleanup in beforeunload is unreliable, but we try our best
window.addEventListener("beforeunload", () => {
  // Fire and forget - we can't await in beforeunload
  // The shortcuts will be cleaned up by the OS when the process exits
  // This is mainly for the case where the window is closed but app keeps running
  for (const shortcut of registeredShortcuts) {
    unregister(shortcut).catch(() => {});
  }
});

setup();

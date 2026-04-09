import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { register, unregister, ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const status = document.getElementById("status")!;

let isCapturing = false;
let editorCounter = 0;
let registeredShortcuts: string[] = []; // Track registered shortcuts for cleanup

function updateStatus(msg: string) {
  status.textContent = msg;
}

/**
 * Exclude a window from screen capture using SetWindowDisplayAffinity.
 * Retries up to `maxRetries` times with increasing delay on failure.
 */
async function excludeWindowFromCapture(label: string, maxRetries: number): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await invoke("set_window_exclude_from_capture", { label });
      console.log(`Window '${label}' excluded from capture (attempt ${i + 1})`);
      return;
    } catch (e) {
      console.warn(`Failed to exclude '${label}' (attempt ${i + 1}/${maxRetries}):`, e);
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
      } else {
        console.error(`Failed to exclude '${label}' from capture after ${maxRetries} retries`);
      }
    }
  }
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
let preCreatedClipEditor: WebviewWindow | null = null;

async function openPinWindow(data: { id: number; width: number; height: number }) {
  // Pinned to screen — allow shortcuts again
  isCapturing = false;

  const id = `pin-${++pinCounter}`;

  // Pass pin ID and dimensions to pin window
  new WebviewWindow(id, {
    url: `src/pin.html?pinId=${data.id}&width=${data.width}&height=${data.height}`,
    width: Math.min(Math.round(data.width / window.devicePixelRatio), 800),
    height: Math.min(Math.round(data.height / window.devicePixelRatio), 600),
    center: true,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: "Pin",
  });
}

async function showClipEditor() {
  isCapturing = false;

  if (preCreatedClipEditor) {
    // Window already pre-created during recording — just show it
    await preCreatedClipEditor.show();
    await preCreatedClipEditor.center();
    await emit("recording-data-ready", {});
  } else {
    // Fallback: create window on the spot
    preCreatedClipEditor = new WebviewWindow("clip-editor", {
      url: `src/clip-editor.html`,
      width: 900,
      height: 650,
      center: true,
      title: "Recording Editor",
      resizable: true,
    });
    // Data is already in memory, editor will load on init
  }
}

async function setup() {
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
    logicalX: number; logicalY: number; logicalWidth: number; logicalHeight: number;
  }>(
    "recording-area-selected",
    async (event) => {
      // Physical pixel coords for the recording backend
      const { x, y, width, height } = event.payload;
      // Logical pixel coords for window positioning (Tauri window API uses logical coords)
      const { logicalX, logicalY, logicalWidth, logicalHeight } = event.payload;
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
        // Pre-create clip editor window (hidden) to warm up WebView2
        preCreatedClipEditor = new WebviewWindow("clip-editor", {
          url: "src/clip-editor.html",
          width: 900,
          height: 650,
          center: true,
          title: "Recording Editor",
          resizable: true,
          visible: false,
        });
        preCreatedClipEditor.once("tauri://destroyed", () => {
          preCreatedClipEditor = null;
        });
        preCreatedClipEditor.once("tauri://error", (error) => {
          console.error("Clip editor window creation failed:", error);
          preCreatedClipEditor = null;
        });

        // Create the record-indicator overlay window to show green border
        // around the selected recording area. The window is excluded from
        // screen capture via SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
        // with robust retry and verification logic in Rust.
        // We MUST wait for the exclusion to complete before starting recording,
        // otherwise the green border will appear in the captured video.
        const indicatorWindow = new WebviewWindow("record-indicator", {
          url: "src/record-indicator.html",
          width: Math.round(logicalWidth),
          height: Math.round(logicalHeight),
          x: Math.round(logicalX),
          y: Math.round(logicalY),
          decorations: false,
          transparent: true,
          shadow: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          title: "Recording Indicator",
        });

        // Wait for indicator window to be created AND excluded from capture
        // before starting recording, so the green border never appears in the video.
        await new Promise<void>((resolve) => {
          let resolved = false;
          const safeResolve = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          // Safety timeout: if tauri://created never fires, resolve anyway
          // so recording can still proceed (indicator may appear in capture briefly).
          const timeout = setTimeout(() => {
            console.warn("Indicator window creation timed out, proceeding with recording");
            safeResolve();
          }, 5000);

          indicatorWindow.once("tauri://error", (e) => {
            clearTimeout(timeout);
            console.warn("Indicator window creation failed, proceeding with recording:", e);
            safeResolve();
          });

          indicatorWindow.once("tauri://created", async () => {
            // Small delay to ensure the window is fully initialized by the OS
            await new Promise(r => setTimeout(r, 100));
            // Compensate for any invisible frame offset so the green border
            // aligns exactly with the recording region on screen
            try {
              await invoke("lock_window_position", { label: "record-indicator" });
            } catch (e) {
              console.warn("Failed to lock indicator window position:", e);
            }
            await excludeWindowFromCapture("record-indicator", 5);
            clearTimeout(timeout);
            safeResolve();
          });
        });

        // Now start recording — green indicator is already excluded from capture
        await invoke("start_recording", {
          config: { x, y, width, height, fps: 30 },
        });

        // Open recording control bar below the selected area
        const controlWindow = new WebviewWindow("record-control", {
          url: "src/record-control.html",
          width: 220,
          height: 52,
          x: Math.round(logicalX + logicalWidth / 2 - 110),
          y: Math.round(logicalY + logicalHeight + 10),
          decorations: false,
          transparent: true,
          shadow: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          title: "Recording",
        });
        // Exclude control bar from screen capture with retry for robustness
        controlWindow.once("tauri://created", async () => {
          await excludeWindowFromCapture("record-control", 3);
        });
      } catch (err) {
        updateStatus(`Recording error: ${err}`);
        isCapturing = false;

        // Clean up indicator window
        try {
          const indicator = await WebviewWindow.getByLabel("record-indicator");
          if (indicator) await indicator.close();
        } catch {}

        // Clean up pre-created clip editor window
        if (preCreatedClipEditor) {
          try {
            await preCreatedClipEditor.close();
            preCreatedClipEditor = null;
          } catch {}
        }
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

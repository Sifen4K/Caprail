import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { resolution } from "./resolution-context";

let recordWindow: WebviewWindow | null = null;

export async function createRecordingCaptureWindow() {
  if (recordWindow) {
    try { await recordWindow.close(); } catch {}
    recordWindow = null;
  }

  // Refresh monitor info and compute the virtual screen bounds in PHYSICAL pixels.
  // Using resolution.getVirtualDesktopBounds() centralises the per-monitor DPI
  // logic and handles mixed-DPI and negative-origin setups correctly.
  await resolution.refresh();
  const physical = resolution.getVirtualDesktopBounds();
  const minX = physical.x;
  const minY = physical.y;
  const physWidth = physical.w;
  const physHeight = physical.h;

  // Create window with minimal initial size - we'll set the actual size and position
  // using PhysicalSize and PhysicalPosition after creation to ensure physical coords.
  recordWindow = new WebviewWindow("record-overlay", {
    url: "src/record-overlay.html",
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    transparent: true,
    decorations: false,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focus: true,
  });

  recordWindow.once("tauri://created", async () => {
    // Set window to cover the full virtual screen in physical coordinates
    try {
      await recordWindow!.setSize(new PhysicalSize(physWidth, physHeight));
      await recordWindow!.setPosition(new PhysicalPosition(minX, minY));
    } catch (e) {
      console.error("Failed to set overlay size/position:", e);
    }
    await invoke("set_window_exclude_from_capture", { label: "record-overlay" }).catch((err) => {
      console.warn("Failed to exclude record overlay from capture:", err);
    });
    await invoke("flush_desktop_composition").catch((err) => {
      console.warn("Failed to flush desktop composition after excluding record overlay:", err);
    });
    console.log("Record overlay window created");
  });

  recordWindow.once("tauri://destroyed", () => {
    recordWindow = null;
  });
}

export async function closeRecordingCapture() {
  if (recordWindow) {
    await recordWindow.close();
    recordWindow = null;
  }
}

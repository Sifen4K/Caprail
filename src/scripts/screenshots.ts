import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { resolution } from "./resolution-context";

interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  is_primary: boolean;
}

interface VirtualScreenInfo {
  id: number;
  origin_x: number;
  origin_y: number;
  width: number;
  height: number;
}

let captureWindow: WebviewWindow | null = null;

export async function createScreenCaptureWindow() {
  // Clean up stale reference
  if (captureWindow) {
    try { await captureWindow.close(); } catch {}
    captureWindow = null;
  }

  // Pre-capture the virtual screen BEFORE creating overlay window
  const vsInfo = await invoke<VirtualScreenInfo>("capture_virtual_screen");

  // Get physical monitor info from Rust backend (used by overlay for coordinate mapping)
  const physicalMonitors = await invoke<MonitorInfo[]>("get_monitors");
  console.log("Physical monitors:", physicalMonitors);

  // Refresh resolution context and obtain bounding rects in one call.
  // getVirtualDesktopBounds() handles mixed-DPI and negative origins correctly.
  await resolution.refresh();
  const physical = resolution.getVirtualDesktopBounds();

  console.log("Physical bounding rect:", physical.x, physical.y, physical.x + physical.w, physical.y + physical.h);

  // Pass pre-capture metadata via URL params
  const params = new URLSearchParams({
    precaptureId: String(vsInfo.id),
    originX: String(vsInfo.origin_x),
    originY: String(vsInfo.origin_y),
    vsWidth: String(vsInfo.width),
    vsHeight: String(vsInfo.height),
  });

  // Use dummy size/position; real physical geometry is applied in tauri://created.
  // This matches the pattern used by recording.ts for correct mixed-DPI placement.
  captureWindow = new WebviewWindow("screenshot-overlay", {
    url: `src/screenshot-overlay.html?${params}`,
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
    fullscreen: false,
  });

  captureWindow.once("tauri://destroyed", () => {
    captureWindow = null;
  });

  captureWindow.once("tauri://created", async () => {
    try {
      const bounds = resolution.getVirtualDesktopBounds();
      await captureWindow!.setSize(new PhysicalSize(bounds.w, bounds.h));
      await captureWindow!.setPosition(new PhysicalPosition(bounds.x, bounds.y));
    } catch (e) {
      console.error("Failed to set screenshot window size/position:", e);
    }
    console.log("Screenshot overlay window created");
  });

  captureWindow.once("tauri://error", (e) => {
    console.error("Failed to create overlay:", e);
  });
}

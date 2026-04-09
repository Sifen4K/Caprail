import { availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";

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

  // Get physical monitor info from Rust backend
  const physicalMonitors = await invoke<MonitorInfo[]>("get_monitors");
  console.log("Physical monitors:", physicalMonitors);

  // Calculate bounding rect of all monitors in physical coordinates
  let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
  if (physicalMonitors.length > 0) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const m of physicalMonitors) {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.width);
      maxY = Math.max(maxY, m.y + m.height);
    }
  }
  console.log("Physical bounding rect:", minX, minY, maxX, maxY);

  // Get monitor info from Tauri API and convert to logical coordinates for window sizing.
  // availableMonitors() returns PhysicalPosition and PhysicalSize; we must convert
  // to logical coords using each monitor's scaleFactor because WebviewWindow x/y/width/height
  // expect logical coordinates.
  const monitors = await availableMonitors();
  let logicalMinX = 0, logicalMinY = 0, logicalMaxX = 1920, logicalMaxY = 1080;
  if (monitors.length > 0) {
    logicalMinX = Infinity; logicalMinY = Infinity; logicalMaxX = -Infinity; logicalMaxY = -Infinity;
    for (const m of monitors) {
      // m.position and m.size are in physical pixels; convert to logical
      const sf = m.scaleFactor;
      const logX = m.position.x / sf;
      const logY = m.position.y / sf;
      const logW = m.size.width / sf;
      const logH = m.size.height / sf;
      logicalMinX = Math.min(logicalMinX, logX);
      logicalMinY = Math.min(logicalMinY, logY);
      logicalMaxX = Math.max(logicalMaxX, logX + logW);
      logicalMaxY = Math.max(logicalMaxY, logY + logH);
    }
  }
  console.log("Logical bounding rect:", logicalMinX, logicalMinY, logicalMaxX, logicalMaxY);

  // Pass pre-capture metadata via URL params
  const params = new URLSearchParams({
    precaptureId: String(vsInfo.id),
    originX: String(vsInfo.origin_x),
    originY: String(vsInfo.origin_y),
    vsWidth: String(vsInfo.width),
    vsHeight: String(vsInfo.height),
  });

  // Use logical coordinates for window creation (Tauri uses logical coords)
  captureWindow = new WebviewWindow("screenshot-overlay", {
    url: `src/screenshot-overlay.html?${params}`,
    width: logicalMaxX - logicalMinX,
    height: logicalMaxY - logicalMinY,
    x: logicalMinX,
    y: logicalMinY,
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

  captureWindow.once("tauri://created", () => {
    console.log("Screenshot overlay window created");
  });

  captureWindow.once("tauri://error", (e) => {
    console.error("Failed to create overlay:", e);
  });
}

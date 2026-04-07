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

  // Get logical monitor info from Tauri API for window sizing
  const monitors = await availableMonitors();
  let logicalMinX = 0, logicalMinY = 0, logicalMaxX = 1920, logicalMaxY = 1080;
  if (monitors.length > 0) {
    logicalMinX = Infinity; logicalMinY = Infinity; logicalMaxX = -Infinity; logicalMaxY = -Infinity;
    for (const m of monitors) {
      const mx = m.position.x;
      const my = m.position.y;
      logicalMinX = Math.min(logicalMinX, mx);
      logicalMinY = Math.min(logicalMinY, my);
      logicalMaxX = Math.max(logicalMaxX, mx + m.size.width);
      logicalMaxY = Math.max(logicalMaxY, my + m.size.height);
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

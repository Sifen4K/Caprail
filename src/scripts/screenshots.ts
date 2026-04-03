import { availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";

interface WindowInfo {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hwnd: number;
}

interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  is_primary: boolean;
}

let captureWindow: WebviewWindow | null = null;

export async function createScreenCaptureWindow() {
  // Clean up stale reference
  if (captureWindow) {
    try { await captureWindow.close(); } catch {}
    captureWindow = null;
  }

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

  // Use logical coordinates for window creation (Tauri uses logical coords)
  captureWindow = new WebviewWindow("screenshot-overlay", {
    url: "src/screenshot-overlay.html",
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

export async function closeScreenCapture() {
  if (captureWindow) {
    await captureWindow.close();
    captureWindow = null;
  }
}

export async function captureRegion(x: number, y: number, width: number, height: number): Promise<{ width: number; height: number; data: number[] }> {
  return invoke("capture_region", { x, y, width, height });
}

export async function getWindowList(): Promise<WindowInfo[]> {
  return invoke("get_windows");
}

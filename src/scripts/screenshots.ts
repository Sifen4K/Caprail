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

let captureWindow: WebviewWindow | null = null;

export async function createScreenCaptureWindow() {
  // Clean up stale reference
  if (captureWindow) {
    try { await captureWindow.close(); } catch {}
    captureWindow = null;
  }

  // Calculate bounding rect of all monitors
  const monitors = await availableMonitors();
  let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
  if (monitors.length > 0) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const m of monitors) {
      const mx = m.position.x;
      const my = m.position.y;
      minX = Math.min(minX, mx);
      minY = Math.min(minY, my);
      maxX = Math.max(maxX, mx + m.size.width);
      maxY = Math.max(maxY, my + m.size.height);
    }
  }

  captureWindow = new WebviewWindow("screenshot-overlay", {
    url: "src/screenshot-overlay.html",
    width: maxX - minX,
    height: maxY - minY,
    x: minX,
    y: minY,
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

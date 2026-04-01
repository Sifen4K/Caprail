import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";

let recordWindow: WebviewWindow | null = null;

export async function createRecordingCaptureWindow() {
  if (recordWindow) {
    try { await recordWindow.close(); } catch {}
    recordWindow = null;
  }

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

  recordWindow = new WebviewWindow("record-overlay", {
    url: "src/record-overlay.html",
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
  });

  recordWindow.once("tauri://created", () => {
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

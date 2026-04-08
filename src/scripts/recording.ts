import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";

let recordWindow: WebviewWindow | null = null;

export async function createRecordingCaptureWindow() {
  if (recordWindow) {
    try { await recordWindow.close(); } catch {}
    recordWindow = null;
  }

  // availableMonitors() returns physical positions and physical sizes.
  // WebviewWindow x/y/width/height expect LOGICAL coordinates.
  // Convert physical → logical using each monitor's scaleFactor.
  const monitors = await availableMonitors();
  let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
  if (monitors.length > 0) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const m of monitors) {
      // m.position is PhysicalPosition, m.size is PhysicalSize
      const sf = m.scaleFactor;
      const logX = m.position.x / sf;
      const logY = m.position.y / sf;
      const logW = m.size.width / sf;
      const logH = m.size.height / sf;
      minX = Math.min(minX, logX);
      minY = Math.min(minY, logY);
      maxX = Math.max(maxX, logX + logW);
      maxY = Math.max(maxY, logY + logH);
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
    shadow: false,
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

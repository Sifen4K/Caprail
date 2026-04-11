import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize, availableMonitors } from "@tauri-apps/api/window";

let recordWindow: WebviewWindow | null = null;

export async function createRecordingCaptureWindow() {
  if (recordWindow) {
    try { await recordWindow.close(); } catch {}
    recordWindow = null;
  }

  // Compute the virtual screen bounds in PHYSICAL pixels.
  // Using physical coords ensures the overlay covers the exact screen area
  // regardless of per-monitor DPI scaling, avoiding coordinate mismatches
  // that occur when logical coords are computed with mixed scale factors.
  const monitors = await availableMonitors();
  let minX = 0, minY = 0, maxX = 1920, maxY = 1080;
  if (monitors.length > 0) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const m of monitors) {
      // m.position and m.size are in physical pixels (desktop coordinates)
      minX = Math.min(minX, m.position.x);
      minY = Math.min(minY, m.position.y);
      maxX = Math.max(maxX, m.position.x + m.size.width);
      maxY = Math.max(maxY, m.position.y + m.size.height);
    }
  }

  const physWidth = maxX - minX;
  const physHeight = maxY - minY;

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

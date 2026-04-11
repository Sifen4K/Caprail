import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import type { Monitor } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { loadLocale, t } from "./i18n.ts";

const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let isSelecting = false;
// Selection coordinates in physical pixels (desktop coordinates)
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
// Physical origin of the overlay window on the desktop
let originPhysX = 0;
let originPhysY = 0;
// List of all monitors with their scale factors (updated on resize)
let monitors: Monitor[] = [];

/** Find the scale factor for a given physical point by checking which monitor contains it */
function getScaleFactorForPoint(physX: number, physY: number): number {
  for (const mon of monitors) {
    if (
      physX >= mon.position.x &&
      physX < mon.position.x + mon.size.width &&
      physY >= mon.position.y &&
      physY < mon.position.y + mon.size.height
    ) {
      return mon.scaleFactor;
    }
  }
  // Fallback: assume 1.0 if not found
  return 1.0;
}

async function resize() {
  // Lock window position and compensate for any invisible frame offset.
  // This shifts the window so the client area starts at the requested position,
  // ensuring the overlay aligns exactly with the screen content.
  try {
    await invoke("lock_window_position", { label: "record-overlay" });
  } catch (e) {
    console.error("lock_window_position failed:", e);
  }

  const sz = await getCurrentWindow().innerSize();
  const pos = await getCurrentWindow().innerPosition();
  // Store physical client-area origin
  originPhysX = pos.x;
  originPhysY = pos.y;
  // Fetch all monitor geometries for per-monitor hint rendering
  monitors = await availableMonitors();
  // Set canvas to physical pixel size to match window
  canvas.width = sz.width;
  canvas.height = sz.height;
  // Reset any previous transform - we'll draw in physical coordinates directly
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draw();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (isSelecting) {
    const rect = {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      w: Math.abs(currentX - startX),
      h: Math.abs(currentY - startY),
    };
    if (rect.w > 2 && rect.h > 2) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "#f44336";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      // Show dimensions - use the scale factor at the rect center for display
      const centerX = originPhysX + rect.x + rect.w / 2;
      const centerY = originPhysY + rect.y + rect.h / 2;
      const sf = getScaleFactorForPoint(centerX, centerY);
      // Display logical pixels (physical / scaleFactor) for user-friendly dimensions
      const displayW = Math.round(rect.w / sf);
      const displayH = Math.round(rect.h / sf);
      const label = `${displayW} x ${displayH}`;
      ctx.font = "13px monospace";
      const metrics = ctx.measureText(label);
      const labelX = rect.x + rect.w / 2 - metrics.width / 2;
      const labelY = rect.y > 25 ? rect.y - 8 : rect.y + rect.h + 18;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(labelX - 4, labelY - 14, metrics.width + 8, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, labelX, labelY);
    }
  } else {
    // Draw hint text at the center of each physical monitor.
    const drawHintForMonitor = (physCX: number, physCY: number) => {
      // Scale text size by the monitor's scale factor for readability
      const sf = getScaleFactorForPoint(physCX, physCY);
      const fontSize = Math.round(24 * sf);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(t("recordOverlay.selectArea"), physCX, physCY);
      ctx.font = `${Math.round(16 * sf)}px sans-serif`;
      ctx.fillStyle = "#aaa";
      ctx.fillText(t("recordOverlay.pressEscCancel"), physCX, physCY + 30 * sf);
    };

    if (monitors.length > 0) {
      for (const mon of monitors) {
        const physCenterX = mon.position.x + mon.size.width / 2;
        const physCenterY = mon.position.y + mon.size.height / 2;
        // physCenterX/Y is in desktop coordinates; convert to canvas-relative
        const canvasX = physCenterX - originPhysX;
        const canvasY = physCenterY - originPhysY;
        // Only draw if within canvas bounds
        if (canvasX >= 0 && canvasX <= canvas.width && canvasY >= 0 && canvasY <= canvas.height) {
          drawHintForMonitor(canvasX, canvasY);
        }
      }
    } else {
      // Fallback: render at the center of the canvas
      drawHintForMonitor(canvas.width / 2, canvas.height / 2);
    }

    ctx.textAlign = "start";
  }

  // Crosshair (in physical coordinates)
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, currentY);
  ctx.lineTo(canvas.width, currentY);
  ctx.moveTo(currentX, 0);
  ctx.lineTo(currentX, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

canvas.addEventListener("mousedown", (e) => {
  isSelecting = true;
  // e.clientX/Y is in the webview's coordinate system.
  // Since the overlay is created with PhysicalPosition, we treat these
  // as physical coordinates directly (the webview is DPI-aware).
  startX = e.clientX;
  startY = e.clientY;
  currentX = e.clientX;
  currentY = e.clientY;
});

canvas.addEventListener("mousemove", (e) => {
  currentX = e.clientX;
  currentY = e.clientY;
  draw();
});

canvas.addEventListener("mouseup", async () => {
  if (!isSelecting) return;
  isSelecting = false;

  // Physical rectangle in desktop coordinates
  const physRect = {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    w: Math.abs(currentX - startX),
    h: Math.abs(currentY - startY),
  };

  if (physRect.w > 10 && physRect.h > 10) {
    // The selection is in physical coordinates.
    // For the recording: use physical coords directly (BitBlt uses physical coords).
    // For the indicator window: Tauri uses logical coords, so convert.

    // Find the scale factor at the center of the selection to convert
    // from physical to logical for window positioning.
    const centerX = originPhysX + physRect.x + physRect.w / 2;
    const centerY = originPhysY + physRect.y + physRect.h / 2;
    const sf = getScaleFactorForPoint(centerX, centerY);

    // Convert physical selection to logical (for indicator window)
    // The indicator window expects logical coords: position = physical / scaleFactor
    const logX = (originPhysX + physRect.x) / sf;
    const logY = (originPhysY + physRect.y) / sf;
    const logW = physRect.w / sf;
    const logH = physRect.h / sf;

    await emit("recording-area-selected", {
      x: physRect.x,      // physical, for BitBlt capture
      y: physRect.y,      // physical, for BitBlt capture
      width: physRect.w,  // physical, for BitBlt capture
      height: physRect.h, // physical, for BitBlt capture
      logicalX: logX,     // logical, for indicator window position
      logicalY: logY,     // logical, for indicator window position
      logicalWidth: logW, // logical, for indicator window size
      logicalHeight: logH,// logical, for indicator window size
    });
    // Do not close here — main.ts will close this window and wait for
    // its destruction before starting the recording, avoiding the race
    // condition where the red overlay border appears in captured frames.
  } else {
    await emit("recording-cancelled", {});
    const win = getCurrentWindow();
    await win.close();
  }
});

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    await emit("recording-cancelled", {});
    const win = getCurrentWindow();
    await win.close();
  }
});

window.addEventListener("load", resize);
loadLocale(new URLSearchParams(document.location.search).get("lang") || "en");

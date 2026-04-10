import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import type { Monitor } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { loadLocale, t } from "./i18n.ts";
import { logicalRectToRecordingSelection } from "./coordinate-mapping";

const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let isSelecting = false;
// Coordinates in logical pixels (CSS pixels, relative to overlay window)
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
// Device pixel ratio for HiDPI support
let dpr = 1;
// Physical origin of the overlay window on the desktop (for absolute coordinate calc)
let originPhysX = 0;
let originPhysY = 0;
// List of all physical monitors (updated on resize)
let monitors: Monitor[] = [];

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
  // innerPosition() returns the physical position of the CLIENT AREA on the desktop.
  // This is what JavaScript clientX/Y are relative to, so it must be used (not outerPosition,
  // which includes the window frame and would introduce an offset).
  const pos = await getCurrentWindow().innerPosition();
  dpr = window.devicePixelRatio || 1;
  // Store physical client-area origin so we can convert logical→absolute physical coords
  originPhysX = pos.x;
  originPhysY = pos.y;
  // Fetch all monitor geometries for per-monitor hint rendering
  monitors = await availableMonitors();
  // Set canvas physical pixel size to match window
  canvas.width = sz.width;
  canvas.height = sz.height;
  // Scale context so all drawing uses logical (CSS) coordinates
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  // Logical dimensions (physical / dpr)
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  ctx.clearRect(0, 0, logicalW, logicalH);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, logicalW, logicalH);

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

      // Show physical pixel dimensions in label
      const physW = Math.round(rect.w * dpr);
      const physH = Math.round(rect.h * dpr);
      const label = `${physW} x ${physH}`;
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
    // Monitor positions are in physical pixels; convert to logical coords
    // relative to the overlay canvas by subtracting the window's physical origin
    // and dividing by dpr.
    const drawHintForMonitor = (cx: number, cy: number) => {
      ctx.font = "24px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(t("recordOverlay.selectArea"), cx, cy);
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "#aaa";
      ctx.fillText(t("recordOverlay.pressEscCancel"), cx, cy + 30);
    };

    if (monitors.length > 0) {
      for (const mon of monitors) {
        // Physical center of this monitor in desktop coordinates
        const physCenterX = mon.position.x + mon.size.width / 2;
        const physCenterY = mon.position.y + mon.size.height / 2;
        // Convert to logical canvas coordinates:
        // subtract the overlay window's physical origin, then divide by dpr
        const logCX = (physCenterX - originPhysX) / dpr;
        const logCY = (physCenterY - originPhysY) / dpr;
        drawHintForMonitor(logCX, logCY);
      }
    } else {
      // Fallback: render at the center of the entire canvas
      drawHintForMonitor(logicalW / 2, logicalH / 2);
    }

    ctx.textAlign = "start";
  }

  // Crosshair (in logical coordinates)
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, currentY);
  ctx.lineTo(logicalW, currentY);
  ctx.moveTo(currentX, 0);
  ctx.lineTo(currentX, logicalH);
  ctx.stroke();
  ctx.setLineDash([]);
}

canvas.addEventListener("mousedown", (e) => {
  isSelecting = true;
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

  // Logical rectangle relative to overlay window (CSS pixels)
  const logRect = {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    w: Math.abs(currentX - startX),
    h: Math.abs(currentY - startY),
  };

  if (logRect.w > 10 && logRect.h > 10) {
    const selection = logicalRectToRecordingSelection(
      logRect,
      originPhysX,
      originPhysY,
      dpr,
      monitors
    );

    await emit("recording-area-selected", {
      ...selection,
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

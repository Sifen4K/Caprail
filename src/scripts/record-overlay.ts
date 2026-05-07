import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { resolution } from "./resolution-context";
import type { PhysicalPixel } from "./resolution-context";
import { loadLocale, t } from "./i18n.ts";
import {
  buildPhysicalRect,
  shouldCancelOverlayOnRightClick,
  toPhysicalCanvasPoint,
  toSelectionRect,
  translateCanvasRectToDesktop,
} from "./physical-capture.logic";

const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let dpr = 1;
let isSelecting = false;
// Selection coordinates in physical pixels (canvas-relative)
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
// (originPhysX/Y and monitors variables removed — use resolution context instead)

async function cancelRecordingSelection() {
  isSelecting = false;
  await emit("recording-cancelled", {});
  const win = getCurrentWindow();
  await win.close();
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
  // Refresh resolution context: updates monitor list and window physical origin
  await resolution.refresh();
  dpr = window.devicePixelRatio || 1;
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
    const rect = buildPhysicalRect(
      { x: startX, y: startY },
      { x: currentX, y: currentY },
    );
    if (rect.w > 2 && rect.h > 2) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "#f44336";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      const label = `${Math.round(rect.w)} x ${Math.round(rect.h)}`;
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
      const sf = resolution.getScaleFactorAtPhysical(physCX as PhysicalPixel, physCY as PhysicalPixel);
      const fontSize = Math.round(24 * sf);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(t("recordOverlay.selectArea"), physCX, physCY);
      ctx.font = `${Math.round(16 * sf)}px sans-serif`;
      ctx.fillStyle = "#aaa";
      ctx.fillText(t("recordOverlay.pressEscCancel"), physCX, physCY + 30 * sf);
    };

    const monitorList = resolution.monitors;
    if (monitorList.length > 0) {
      for (const mon of monitorList) {
        const physCenterX = mon.x + mon.width / 2;
        const physCenterY = mon.y + mon.height / 2;
        // physCenterX/Y is in desktop coordinates; convert to canvas-relative
        const canvasPos = resolution.desktopPhysicalToCanvas(physCenterX as PhysicalPixel, physCenterY as PhysicalPixel);
        // Only draw if within canvas bounds
        if (canvasPos.x >= 0 && canvasPos.x <= canvas.width && canvasPos.y >= 0 && canvasPos.y <= canvas.height) {
          drawHintForMonitor(canvasPos.x, canvasPos.y);
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
  if (shouldCancelOverlayOnRightClick(isSelecting, e.button, e.buttons)) {
    e.preventDefault();
    void cancelRecordingSelection();
    return;
  }

  if (e.button !== 0) {
    return;
  }

  isSelecting = true;
  const point = toPhysicalCanvasPoint(e.clientX, e.clientY, dpr);
  startX = point.x;
  startY = point.y;
  currentX = point.x;
  currentY = point.y;
});

canvas.addEventListener("mousemove", (e) => {
  const point = toPhysicalCanvasPoint(e.clientX, e.clientY, dpr);
  currentX = point.x;
  currentY = point.y;
  draw();
});

canvas.addEventListener("mouseup", async () => {
  if (!isSelecting) return;
  isSelecting = false;

  // Physical rectangle in desktop coordinates
  const physRect = buildPhysicalRect(
    { x: startX, y: startY },
    { x: currentX, y: currentY },
  );

  if (physRect.w > 10 && physRect.h > 10) {
    const desktopRect = translateCanvasRectToDesktop(physRect, {
      x: resolution.windowOrigin.x,
      y: resolution.windowOrigin.y,
    });
    const selection = toSelectionRect(desktopRect);

    await emit("recording-area-selected", {
      x: Math.round(selection.x),
      y: Math.round(selection.y),
      width: Math.round(selection.width),
      height: Math.round(selection.height),
    });
    await getCurrentWindow().hide().catch((err) => {
      console.warn("Failed to hide record overlay after selection:", err);
    });
    // Do not close here — main.ts will close this window and wait for
    // its destruction before starting the recording, avoiding the race
    // condition where the red overlay border appears in captured frames.
  } else {
    await cancelRecordingSelection();
  }
});

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    await cancelRecordingSelection();
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

window.addEventListener("load", resize);
window.addEventListener("resize", () => {
  dpr = window.devicePixelRatio || 1;
  resize();
});
loadLocale(new URLSearchParams(document.location.search).get("lang") || "en");

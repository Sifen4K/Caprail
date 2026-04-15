import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { resolution } from "./resolution-context";
import type { PhysicalPixel } from "./resolution-context";
import {
  buildPhysicalRect,
  findMonitorAtPoint,
  findSmallestWindowAtPoint,
  shouldCancelOverlayOnRightClick,
  toPhysicalCanvasPoint,
  toSelectionRect,
  translateCanvasRectToDesktop,
} from "./physical-capture.logic";

interface WindowInfo {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hwnd: number;
}

// Pre-capture parameters from URL
const params = new URLSearchParams(window.location.search);
const precaptureId = parseInt(params.get("precaptureId")!);
const vsOriginX = parseInt(params.get("originX")!);
const vsOriginY = parseInt(params.get("originY")!);
const vsWidth = parseInt(params.get("vsWidth")!);
const vsHeight = parseInt(params.get("vsHeight")!);

const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let isSelecting = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let windowList: WindowInfo[] = [];
let hoveredWindow: WindowInfo | null = null;
let lastClickTime = 0;

let dpr = 1;

// Offscreen canvas holding the pre-captured virtual screen image
let bgCanvas: HTMLCanvasElement | null = null;

async function cancelCapture() {
  try {
    await invoke("cleanup_screenshot", { id: precaptureId });
  } catch (err) {
    console.error("Cleanup failed:", err);
  }

  await emit("screenshot-cancelled", {});
  const win = getCurrentWindow();
  await win.close();
}

async function init() {
  // Lock window position to prevent dragging
  try {
    await invoke("lock_window_position", { label: "screenshot-overlay" });
  } catch (e) {
    console.error("lock_window_position failed:", e);
  }

  const sz = await getCurrentWindow().innerSize();
  canvas.width = sz.width;
  canvas.height = sz.height;
  dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Initialise resolution context: loads monitor list and window geometry.
  // monitorOriginX/Y are now derived from resolution.getVirtualDesktopBounds()
  // and resolution.windowOrigin as needed.
  try {
    await resolution.init();
    console.log("Monitor origin:", resolution.getVirtualDesktopBounds());
    console.log("Monitors:", resolution.monitors);
  } catch {
    // Silently ignore – resolution context will fall back to defaults
  }

  // Load window list for hover highlight
  try {
    windowList = await invoke<WindowInfo[]>("get_windows");
  } catch {
    windowList = [];
  }

  // Load pre-captured virtual screen image
  try {
    const buffer = await invoke<ArrayBuffer>("read_screenshot", { id: precaptureId });
    const bytes = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(bytes, vsWidth, vsHeight);

    bgCanvas = document.createElement("canvas");
    bgCanvas.width = vsWidth;
    bgCanvas.height = vsHeight;
    bgCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
  } catch (err) {
    console.error("Failed to load pre-capture:", err);
  }

  draw();
}

function canvasToDesktopPhysical(canvasX: number, canvasY: number) {
  return resolution.canvasToDesktopPhysical(canvasX as PhysicalPixel, canvasY as PhysicalPixel);
}

function desktopToCanvasPhysical(physicalX: number, physicalY: number): { x: number; y: number } {
  const point = resolution.desktopPhysicalToCanvas(physicalX as PhysicalPixel, physicalY as PhysicalPixel);
  return {
    x: point.x,
    y: point.y,
  };
}

function findWindowAtCanvasPoint(canvasX: number, canvasY: number): WindowInfo | null {
  const desktopPoint = canvasToDesktopPhysical(canvasX, canvasY);
  return findSmallestWindowAtPoint({ x: desktopPoint.x, y: desktopPoint.y }, windowList);
}

function drawBackgroundRegion(desktopX: number, desktopY: number, width: number, height: number, canvasX: number, canvasY: number) {
  if (!bgCanvas) return;
  const srcX = desktopX - vsOriginX;
  const srcY = desktopY - vsOriginY;
  ctx.drawImage(bgCanvas, srcX, srcY, width, height, canvasX, canvasY, width, height);
}

function draw() {
  const canvasW = canvas.width;
  const canvasH = canvas.height;

  if (bgCanvas) {
    ctx.drawImage(bgCanvas, 0, 0, bgCanvas.width, bgCanvas.height, 0, 0, canvasW, canvasH);
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (isSelecting) {
    const rect = buildPhysicalRect(
      { x: startX, y: startY },
      { x: currentX, y: currentY },
    );
    if (rect.w > 2 && rect.h > 2) {
      const desktopTopLeft = canvasToDesktopPhysical(rect.x, rect.y);
      drawBackgroundRegion(desktopTopLeft.x, desktopTopLeft.y, rect.w, rect.h, rect.x, rect.y);

      ctx.strokeStyle = "#4CAF50";
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
  } else if (hoveredWindow) {
    const w = hoveredWindow;
    const topLeft = desktopToCanvasPhysical(w.x, w.y);
    drawBackgroundRegion(w.x, w.y, w.width, w.height, topLeft.x, topLeft.y);

    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.x, topLeft.y, w.width, w.height);

    const label = `${hoveredWindow.title} (${w.width}x${w.height})`;
    ctx.font = "13px sans-serif";
    const metrics = ctx.measureText(label);
    const maxWidth = Math.min(metrics.width + 8, w.width);
    const labelX = topLeft.x + 4;
    const labelY = topLeft.y > 25 ? topLeft.y - 8 : topLeft.y + w.height + 18;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(labelX - 4, labelY - 14, maxWidth, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelX, labelY, w.width - 8);
  }

  if (!isSelecting) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, currentY);
    ctx.lineTo(canvasW, currentY);
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, canvasH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

canvas.addEventListener("mousedown", (e) => {
  if (shouldCancelOverlayOnRightClick(isSelecting, e.button, e.buttons)) {
    e.preventDefault();
    isSelecting = false;
    hoveredWindow = null;
    draw();
    void cancelCapture();
    return;
  }

  if (e.button !== 0) {
    return;
  }

  const now = Date.now();

  // Double-click: capture full screen
  if (now - lastClickTime < 300) {
    captureFullScreen();
    return;
  }
  lastClickTime = now;

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

  if (!isSelecting) {
    hoveredWindow = findWindowAtCanvasPoint(currentX, currentY);
  }

  draw();
});

canvas.addEventListener("mouseup", async (e) => {
  if (e.button !== 0 || !isSelecting) return;
  isSelecting = false;

  const dragW = Math.abs(currentX - startX);
  const dragH = Math.abs(currentY - startY);

  let captureRect: { x: number; y: number; w: number; h: number };

  if (dragW > 5 && dragH > 5) {
    const canvasRect = buildPhysicalRect(
      { x: startX, y: startY },
      { x: currentX, y: currentY },
    );
    const desktopRect = translateCanvasRectToDesktop(canvasRect, {
      x: resolution.windowOrigin.x,
      y: resolution.windowOrigin.y,
    });
    const selection = toSelectionRect(desktopRect);

    captureRect = {
      x: Math.round(selection.x),
      y: Math.round(selection.y),
      w: Math.round(selection.width),
      h: Math.round(selection.height),
    };
    console.log("Capture region (physical):", captureRect);
  } else if (hoveredWindow) {
    captureRect = {
      x: hoveredWindow.x,
      y: hoveredWindow.y,
      w: hoveredWindow.width,
      h: hoveredWindow.height,
    };
    console.log("Capture window:", captureRect);
  } else {
    return;
  }

  try {
    // Crop from the pre-captured image — no live screen capture needed
    const result = await invoke<{ id: number; width: number; height: number }>(
      "crop_precapture",
      {
        precaptureId: precaptureId,
        x: captureRect.x,
        y: captureRect.y,
        width: captureRect.w,
        height: captureRect.h,
        originX: vsOriginX,
        originY: vsOriginY,
      }
    );
    await emit("screenshot-captured", result);
    // Clean up the pre-capture buffer
    await invoke("cleanup_screenshot", { id: precaptureId });
  } catch (err) {
    console.error("Capture failed:", err);
  }

  const win = getCurrentWindow();
  await win.close();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

async function captureFullScreen() {
  const desktopPoint = canvasToDesktopPhysical(currentX, currentY);
  const physicalX = desktopPoint.x as PhysicalPixel;
  const physicalY = desktopPoint.y as PhysicalPixel;

  const target = findMonitorAtPoint(
    { x: physicalX, y: physicalY },
    resolution.monitors,
  ) ?? resolution.monitors[0];

  if (!target) {
    console.error("No monitor found for cursor position");
    const win = getCurrentWindow();
    await win.close();
    return;
  }

  try {
    const result = await invoke<{ id: number; width: number; height: number }>(
      "crop_precapture",
      {
        precaptureId: precaptureId,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        originX: vsOriginX,
        originY: vsOriginY,
      }
    );
    await emit("screenshot-captured", result);
    await invoke("cleanup_screenshot", { id: precaptureId });
  } catch (err) {
    console.error("Full screen capture failed:", err);
  }
  const win = getCurrentWindow();
  await win.close();
}

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    await cancelCapture();
  }
});

window.addEventListener("load", init);
window.addEventListener("resize", () => {
  dpr = window.devicePixelRatio || 1;
  init().catch((err) => console.error("Overlay resize init failed:", err));
});

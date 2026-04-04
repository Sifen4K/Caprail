import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

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

// DPI scaling factor - converts logical coordinates to physical pixels
let dpiScale = 1;
// Monitor physical origin offset for coordinate mapping
let monitorOriginX = 0;
let monitorOriginY = 0;
let monitorList: MonitorInfo[] = [];

async function init() {
  const sz = await getCurrentWindow().innerSize();
  canvas.width = sz.width;
  canvas.height = sz.height;

  // Get DPI scaling factor
  dpiScale = window.devicePixelRatio;
  console.log("DPI scale factor:", dpiScale);

  // Load monitor info for coordinate mapping
  try {
    monitorList = await invoke<MonitorInfo[]>("get_monitors");
    // Calculate monitor origin offset (minX, minY from all monitors)
    if (monitorList.length > 0) {
      monitorOriginX = Math.min(...monitorList.map(m => m.x));
      monitorOriginY = Math.min(...monitorList.map(m => m.y));
    }
    console.log("Monitor origin:", monitorOriginX, monitorOriginY);
    console.log("Monitors:", monitorList);
  } catch {
    monitorList = [];
  }

  // Load window list for hover highlight
  try {
    windowList = await invoke<WindowInfo[]>("get_windows");
  } catch {
    windowList = [];
  }

  draw();
}

// Convert physical pixel coordinates to overlay window relative logical coordinates
function physicalToOverlayLogical(physicalX: number, physicalY: number): { x: number; y: number } {
  // Physical coordinates from get_windows are in screen pixels
  // Overlay window starts at (monitorOriginX, monitorOriginY) in physical coordinates
  // Need to convert to logical coordinates relative to overlay window
  const overlayPhysicalX = physicalX - monitorOriginX;
  const overlayPhysicalY = physicalY - monitorOriginY;
  // Convert to logical coordinates by dividing by DPI scale
  return {
    x: overlayPhysicalX / dpiScale,
    y: overlayPhysicalY / dpiScale
  };
}

function findWindowAt(x: number, y: number): WindowInfo | null {
  // x, y are logical coordinates in overlay window
  // Convert to physical screen coordinates to match windowList coordinates
  const physicalX = monitorOriginX + x * dpiScale;
  const physicalY = monitorOriginY + y * dpiScale;

  // Find smallest window containing the point (most specific match)
  let best: WindowInfo | null = null;
  let bestArea = Infinity;
  for (const w of windowList) {
    if (physicalX >= w.x && physicalX < w.x + w.width && physicalY >= w.y && physicalY < w.y + w.height) {
      const area = w.width * w.height;
      if (area < bestArea) {
        bestArea = area;
        best = w;
      }
    }
  }
  return best;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Semi-transparent dark overlay
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (isSelecting) {
    // Show selection rectangle
    const rect = {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      w: Math.abs(currentX - startX),
      h: Math.abs(currentY - startY),
    };
    if (rect.w > 2 && rect.h > 2) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

      ctx.strokeStyle = "#4CAF50";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      // Size label
      const label = `${rect.w} x ${rect.h}`;
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
    // Highlight hovered window - convert physical coords to overlay logical coords
    const w = hoveredWindow;
    const topLeft = physicalToOverlayLogical(w.x, w.y);
    const bottomRight = physicalToOverlayLogical(w.x + w.width, w.y + w.height);
    const logicalWidth = bottomRight.x - topLeft.x;
    const logicalHeight = bottomRight.y - topLeft.y;

    ctx.clearRect(topLeft.x, topLeft.y, logicalWidth, logicalHeight);

    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.x, topLeft.y, logicalWidth, logicalHeight);

    // Window title label
    const label = `${hoveredWindow.title} (${w.width}x${w.height})`;
    ctx.font = "13px sans-serif";
    const metrics = ctx.measureText(label);
    const maxWidth = Math.min(metrics.width + 8, logicalWidth);
    const labelX = topLeft.x + 4;
    const labelY = topLeft.y > 25 ? topLeft.y - 8 : topLeft.y + logicalHeight + 18;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(labelX - 4, labelY - 14, maxWidth, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelX, labelY, logicalWidth - 8);
  }

  // Crosshair
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
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
  const now = Date.now();

  // Double-click: capture full screen
  if (now - lastClickTime < 300) {
    captureFullScreen();
    return;
  }
  lastClickTime = now;

  // If hovering a window and just clicking (not dragging), select that window
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  currentX = e.clientX;
  currentY = e.clientY;
});

canvas.addEventListener("mousemove", (e) => {
  currentX = e.clientX;
  currentY = e.clientY;

  if (!isSelecting) {
    hoveredWindow = findWindowAt(currentX, currentY);
  }

  draw();
});

canvas.addEventListener("mouseup", async () => {
  if (!isSelecting) return;
  isSelecting = false;

  const dragW = Math.abs(currentX - startX);
  const dragH = Math.abs(currentY - startY);

  // Clear canvas before capture to avoid green lines in screenshot
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let captureRect: { x: number; y: number; w: number; h: number };

  if (dragW > 5 && dragH > 5) {
    // User dragged a region - convert logical coords to physical pixels
    const logicalX = Math.min(startX, currentX);
    const logicalY = Math.min(startY, currentY);
    // Convert to physical screen coordinates
    const physicalX = monitorOriginX + logicalX * dpiScale;
    const physicalY = monitorOriginY + logicalY * dpiScale;
    const physicalW = dragW * dpiScale;
    const physicalH = dragH * dpiScale;

    captureRect = {
      x: Math.round(physicalX),
      y: Math.round(physicalY),
      w: Math.round(physicalW),
      h: Math.round(physicalH),
    };
    console.log("Capture region (logical):", logicalX, logicalY, dragW, dragH);
    console.log("Capture region (physical):", captureRect);
  } else if (hoveredWindow) {
    // User clicked on a window (no drag) - use physical coords directly
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
    // Get current window handle to exclude from capture
    const win = getCurrentWindow();
    const hwnd = (win as any).hwnd as number;

    const result = await invoke<{ id: number; width: number; height: number }>(
      "capture_region",
      {
        x: captureRect.x,
        y: captureRect.y,
        width: captureRect.w,
        height: captureRect.h,
        exclude_hwnd: hwnd,
      }
    );
    await emit("screenshot-captured", result);
  } catch (err) {
    console.error("Capture failed:", err);
  }

  const win = getCurrentWindow();
  await win.close();
});

async function captureFullScreen() {
  try {
    const win = getCurrentWindow();
    const hwnd = (win as any).hwnd as number;

    const result = await invoke<{ id: number; width: number; height: number }>(
      "capture_screen",
      { monitorIndex: 0, excludeHwnd: hwnd }
    );
    await emit("screenshot-captured", result);
  } catch (err) {
    console.error("Full screen capture failed:", err);
  }
  const win = getCurrentWindow();
  await win.close();
}

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    await emit("screenshot-cancelled", {});
    const win = getCurrentWindow();
    await win.close();
  }
});

window.addEventListener("load", init);

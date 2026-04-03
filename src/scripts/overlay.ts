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

async function init() {
  const sz = await getCurrentWindow().innerSize();
  canvas.width = sz.width;
  canvas.height = sz.height;

  // Load window list for hover highlight
  try {
    windowList = await invoke<WindowInfo[]>("get_windows");
  } catch {
    windowList = [];
  }

  draw();
}

function findWindowAt(x: number, y: number): WindowInfo | null {
  // Find smallest window containing the point (most specific match)
  let best: WindowInfo | null = null;
  let bestArea = Infinity;
  for (const w of windowList) {
    if (x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height) {
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
    // Highlight hovered window
    const w = hoveredWindow;
    ctx.clearRect(w.x, w.y, w.width, w.height);

    ctx.strokeStyle = "#4CAF50";
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x, w.y, w.width, w.height);

    // Window title label
    const label = `${hoveredWindow.title} (${w.width}x${w.height})`;
    ctx.font = "13px sans-serif";
    const metrics = ctx.measureText(label);
    const maxWidth = Math.min(metrics.width + 8, w.width);
    const labelX = w.x + 4;
    const labelY = w.y > 25 ? w.y - 8 : w.y + w.height + 18;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(labelX - 4, labelY - 14, maxWidth, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelX, labelY, w.width - 8);
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

  let captureRect: { x: number; y: number; w: number; h: number };

  if (dragW > 5 && dragH > 5) {
    // User dragged a region
    captureRect = {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      w: dragW,
      h: dragH,
    };
  } else if (hoveredWindow) {
    // User clicked on a window (no drag) - capture that window
    captureRect = {
      x: hoveredWindow.x,
      y: hoveredWindow.y,
      w: hoveredWindow.width,
      h: hoveredWindow.height,
    };
  } else {
    return;
  }

  try {
    const result = await invoke<{ id: number; width: number; height: number }>(
      "capture_region",
      {
        x: captureRect.x,
        y: captureRect.y,
        width: captureRect.w,
        height: captureRect.h,
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
    const result = await invoke<{ id: number; width: number; height: number }>(
      "capture_screen",
      { monitorIndex: 0 }
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

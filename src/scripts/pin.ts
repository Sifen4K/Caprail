import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

const canvas = document.getElementById("pin-image") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const win = getCurrentWindow();

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let lastClickTime = 0;
let baseWidth = 400;
let baseHeight = 300;
let scale = 1;
const MIN_SIZE = 50;

// Load image data
listen<{ data: number[]; width: number; height: number }>("load-pin-image", async (event) => {
  const { data, width, height } = event.payload;
  baseWidth = width;
  baseHeight = height;
  canvas.width = width;
  canvas.height = height;

  // data is PNG encoded, decode it
  const blob = new Blob([new Uint8Array(data)], { type: "image/png" });
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(blob);
});

// Drag to move
document.addEventListener("mousedown", (e) => {
  const now = Date.now();

  // Double-click to close
  if (now - lastClickTime < 300) {
    win.close();
    return;
  }
  lastClickTime = now;

  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

document.addEventListener("mousemove", async (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;

  const pos = await win.outerPosition();
  await win.setPosition(new (await import("@tauri-apps/api/dpi")).LogicalPosition(
    pos.x + dx,
    pos.y + dy
  ));
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

// Scroll to zoom
document.addEventListener("wheel", async (e) => {
  e.preventDefault();

  if (e.ctrlKey) {
    // Ctrl+Scroll: adjust opacity
    let opacity = parseFloat(document.body.style.opacity || "1");
    opacity += e.deltaY > 0 ? -0.05 : 0.05;
    opacity = Math.max(0.2, Math.min(1.0, opacity));
    document.body.style.opacity = String(opacity);
    return;
  }

  // Normal scroll: zoom
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  scale *= zoomFactor;

  const newWidth = Math.max(MIN_SIZE, Math.round(baseWidth * scale));
  const newHeight = Math.max(MIN_SIZE, Math.round(baseHeight * scale));

  if (newWidth >= MIN_SIZE && newHeight >= MIN_SIZE) {
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(newWidth, newHeight));
  }
}, { passive: false });

// Esc to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    win.close();
  }
});

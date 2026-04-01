import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";

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

// Load image from URL param
function loadPinImage() {
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get("path");
  if (!filePath) return;

  const assetUrl = convertFileSrc(filePath);
  const img = new Image();
  img.onload = () => {
    baseWidth = img.naturalWidth;
    baseHeight = img.naturalHeight;
    canvas.width = baseWidth;
    canvas.height = baseHeight;
    ctx.drawImage(img, 0, 0);
  };
  img.src = assetUrl;
}

loadPinImage();

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

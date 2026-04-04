import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";

const canvas = document.getElementById("pin-image") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const win = getCurrentWindow();

let isDragging = false;
let baseWidth = 400;
let baseHeight = 300;
let scale = 1;
let pinId: number | null = null;
let originalImage: HTMLImageElement | null = null;
let originalPhysicalWidth = 0;
let originalPhysicalHeight = 0;
const MIN_SIZE = 50;

// Load image from Rust backend
async function loadPinImage() {
  const params = new URLSearchParams(window.location.search);
  const pinIdParam = params.get("pinId");
  const widthParam = params.get("width");
  const heightParam = params.get("height");

  if (!pinIdParam) {
    console.error("No pinId provided");
    return;
  }

  pinId = parseInt(pinIdParam);
  originalPhysicalWidth = parseInt(widthParam || "0");
  originalPhysicalHeight = parseInt(heightParam || "0");

  if (!originalPhysicalWidth || !originalPhysicalHeight) {
    console.error("Invalid dimensions");
    return;
  }

  // Get DPI scale to convert to logical size
  const dpiScale = window.devicePixelRatio;

  try {
    // Read image data from Rust backend
    const buffer = await invoke<ArrayBuffer>("read_pin_image", { id: pinId });
    const uint8Array = new Uint8Array(buffer);

    // Create blob and image from data
    const blob = new Blob([uint8Array], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = async () => {
      console.log("Pin image loaded successfully");
      originalImage = img;

      // Calculate logical size for window
      const logicalWidth = Math.round(originalPhysicalWidth / dpiScale);
      const logicalHeight = Math.round(originalPhysicalHeight / dpiScale);

      baseWidth = logicalWidth;
      baseHeight = logicalHeight;

      // Initial render at scale 1
      renderScaledImage(1);

      // Resize window to fit image (logical size)
      await win.setSize(new LogicalSize(logicalWidth, logicalHeight));

      // Clean up blob URL
      URL.revokeObjectURL(url);
    };

    img.onerror = (e) => {
      console.error("Failed to load pin image:", e);
      URL.revokeObjectURL(url);
    };

    img.src = url;
  } catch (err) {
    console.error("Failed to read pin image from backend:", err);
  }
}

// Render image at given scale
function renderScaledImage(newScale: number) {
  if (!originalImage) return;

  const dpiScale = window.devicePixelRatio;

  // Calculate new physical canvas size for crisp rendering
  const newPhysicalWidth = Math.round(originalPhysicalWidth * newScale);
  const newPhysicalHeight = Math.round(originalPhysicalHeight * newScale);

  // Calculate logical size for display
  const newLogicalWidth = Math.round(newPhysicalWidth / dpiScale);
  const newLogicalHeight = Math.round(newPhysicalHeight / dpiScale);

  // Set canvas physical size
  canvas.width = newPhysicalWidth;
  canvas.height = newPhysicalHeight;

  // Set canvas CSS size to match logical size
  canvas.style.width = `${newLogicalWidth}px`;
  canvas.style.height = `${newLogicalHeight}px`;

  // Draw scaled image
  ctx.drawImage(originalImage, 0, 0, newPhysicalWidth, newPhysicalHeight);
}

loadPinImage();

// Cleanup on window close
window.addEventListener("beforeunload", () => {
  if (pinId !== null) {
    invoke("cleanup_pin_image", { id: pinId }).catch(() => {});
  }
});

let clickCount = 0;
let clickTimer: number | null = null;

// Double-click to close, single-click to start drag
document.addEventListener("mousedown", () => {
  clickCount++;

  if (clickCount === 1) {
    // First click - start drag
    isDragging = true;

    // Set timer to reset click count
    clickTimer = window.setTimeout(() => {
      clickCount = 0;
    }, 300);
  } else if (clickCount === 2) {
    // Second click within 300ms - close window
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickCount = 0;
    isDragging = false;
    win.close();
    return;
  }
});

document.addEventListener("mousemove", async (e) => {
  if (!isDragging) return;

  try {
    // Use movementX/Y which gives delta directly, avoiding DPI issues
    const dx = e.movementX;
    const dy = e.movementY;

    if (dx === 0 && dy === 0) return;

    const pos = await win.outerPosition();
    await win.setPosition(new PhysicalPosition(pos.x + dx, pos.y + dy));
  } catch (err) {
    console.error("Drag error:", err);
  }
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
    // Re-render image at new scale
    renderScaledImage(scale);
    // Update window size to match
    await win.setSize(new LogicalSize(newWidth, newHeight));
  }
}, { passive: false });

// Esc to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    win.close();
  }
});

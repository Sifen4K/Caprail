import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { ToolType, StampType, EditorState } from "./editor-types";
import { redrawAll, setupCanvasHandlers, bakeBuffer } from "./editor-canvas";
import { undo, redo } from "./editor-history";
import { copyToClipboard, saveToFile, pinToScreen, performOcr } from "./editor-output";
import { handleWheel, startPan, endPan, applyZoomTransform } from "./editor-zoom";

// --- State ---

const canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const state: EditorState = {
  currentTool: "rect",
  currentColor: "#ff0000",
  currentLineWidth: 2,
  currentFontSize: 16,
  currentStamp: "counter",
  stampCounter: 1,
  annotations: [],
  redoStack: [],
  isDrawing: false,
  currentAnnotation: null,
  baseImageData: null,
  canvas,
  ctx,
  bufferCanvas: null,
  bufferCtx: null,
  baseCanvas: null,
  dpiScale: 1,
  // Zoom state
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
};

const redraw = () => redrawAll(state);
const bakeAndRedraw = () => {
  bakeBuffer(state);
  redrawAll(state);
};

// --- Image Loading ---

let screenshotId: number | null = null;

async function loadScreenshot() {
  const params = new URLSearchParams(window.location.search);
  const idStr = params.get("id");
  const width = parseInt(params.get("width") || "0");  // Physical pixels
  const height = parseInt(params.get("height") || "0"); // Physical pixels
  if (!idStr || !width || !height) return;

  screenshotId = parseInt(idStr);

  // Get DPI scale factor to convert physical pixels to logical size
  const dpiScale = window.devicePixelRatio;
  state.dpiScale = dpiScale;
  const logicalWidth = Math.round(width / dpiScale);
  const logicalHeight = Math.round(height / dpiScale);

  console.log("Screenshot physical size:", width, "x", height);
  console.log("DPI scale:", dpiScale);
  console.log("Logical size:", logicalWidth, "x", logicalHeight);

  try {
    const buffer = await invoke<ArrayBuffer>("read_screenshot", { id: screenshotId });
    const bytes = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(bytes, width, height);

    // Set canvas pixel size (physical pixels for crisp rendering)
    canvas.width = width;
    canvas.height = height;
    // Set canvas CSS size (logical pixels for correct display scale)
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;

    ctx.putImageData(imageData, 0, 0);
    state.baseImageData = imageData;

    // Create buffer canvas for layered rendering
    const bufferCanvas = document.createElement("canvas");
    bufferCanvas.width = width;
    bufferCanvas.height = height;
    state.bufferCanvas = bufferCanvas;
    state.bufferCtx = bufferCanvas.getContext("2d")!;

    // Create base canvas for mosaic source
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = width;
    baseCanvas.height = height;
    baseCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
    state.baseCanvas = baseCanvas;

    bakeBuffer(state);

    // Resize window to fit the screenshot (logical size + padding)
    const win = getCurrentWindow();
    const toolbarHeight = 44; // toolbar + border
    const padding = 20;
    const windowWidth = Math.min(logicalWidth + padding, 1600);
    const windowHeight = Math.min(logicalHeight + toolbarHeight + padding, 1000);
    await win.setSize(new LogicalSize(windowWidth, windowHeight));
    await win.center();

    console.log("Window resized to:", windowWidth, "x", windowHeight);
  } catch (err) {
    console.error("Failed to load screenshot:", err);
  }
}

loadScreenshot();

// --- Canvas event handlers ---

setupCanvasHandlers(state, redraw, bakeAndRedraw);

// --- Toolbar ---

document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.currentTool = (btn as HTMLElement).dataset.tool as ToolType;

    const fontSizeSlider = document.getElementById("font-size") as HTMLInputElement;
    const lineWidthSlider = document.getElementById("line-width") as HTMLInputElement;
    fontSizeSlider.style.display = state.currentTool === "text" ? "" : "none";
    lineWidthSlider.style.display = state.currentTool === "text" ? "none" : "";

    const stampMenu = document.getElementById("stamp-menu")!;
    if (state.currentTool === "stamp") {
      const rect = btn.getBoundingClientRect();
      stampMenu.style.display = "flex";
      stampMenu.style.left = `${rect.left}px`;
      stampMenu.style.top = `${rect.bottom + 4}px`;
    } else {
      stampMenu.style.display = "none";
    }
  });
});

document.querySelectorAll(".stamp-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.currentStamp = (btn as HTMLElement).dataset.stamp as StampType;
  });
});

(document.getElementById("color-picker") as HTMLInputElement).addEventListener("input", (e) => {
  state.currentColor = (e.target as HTMLInputElement).value;
});

(document.getElementById("line-width") as HTMLInputElement).addEventListener("input", (e) => {
  state.currentLineWidth = parseInt((e.target as HTMLInputElement).value);
});

(document.getElementById("font-size") as HTMLInputElement).addEventListener("input", (e) => {
  state.currentFontSize = parseInt((e.target as HTMLInputElement).value);
});

document.getElementById("undo-btn")!.addEventListener("click", () => undo(state, bakeAndRedraw));
document.getElementById("redo-btn")!.addEventListener("click", () => redo(state, bakeAndRedraw));
document.getElementById("copy-btn")!.addEventListener("click", () => copyToClipboard(state, redraw));
document.getElementById("save-btn")!.addEventListener("click", () => saveToFile(state, redraw));
document.getElementById("pin-btn")!.addEventListener("click", () => pinToScreen(state, redraw));
document.getElementById("ocr-btn")!.addEventListener("click", () => performOcr(screenshotId));

// OCR panel
document.getElementById("ocr-close-btn")!.addEventListener("click", () => {
  document.getElementById("ocr-panel")!.style.display = "none";
});

document.getElementById("ocr-copy-btn")!.addEventListener("click", async () => {
  const text = (document.getElementById("ocr-text") as HTMLTextAreaElement).value;
  if (text) {
    await navigator.clipboard.writeText(text);
  }
});

// --- Keyboard shortcuts ---

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "z") {
    e.preventDefault();
    undo(state, bakeAndRedraw);
  } else if (e.ctrlKey && e.key === "y") {
    e.preventDefault();
    redo(state, bakeAndRedraw);
  } else if (e.ctrlKey && e.key === "c") {
    e.preventDefault();
    copyToClipboard(state, redraw);
  } else if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    saveToFile(state, redraw);
  }
});

// --- Zoom and Pan handlers ---

const canvasWrapper = document.getElementById("canvas-wrapper")!;

// Wheel zoom
canvasWrapper.addEventListener("wheel", (e) => {
  handleWheel(state, e);
}, { passive: false });

// Pan with right/middle mouse button
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

canvasWrapper.addEventListener("pointerdown", (e) => {
  // Only start pan with right button (1) or middle button (2)
  if (e.button === 1 || e.button === 2) {
    e.preventDefault();
    startPan(state, e);
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = state.panX;
    panStartPanY = state.panY;
    canvasWrapper.setPointerCapture(e.pointerId);
  }
});

canvasWrapper.addEventListener("pointermove", (e) => {
  if (state.isPanning) {
    const deltaX = e.clientX - panStartX;
    const deltaY = e.clientY - panStartY;
    state.panX = panStartPanX + deltaX;
    state.panY = panStartPanY + deltaY;
    // No constraint - let user pan freely
    applyZoomTransform(state);
  }
});

canvasWrapper.addEventListener("pointerup", (e) => {
  if (state.isPanning) {
    endPan(state);
    canvasWrapper.releasePointerCapture(e.pointerId);
  }
});

canvasWrapper.addEventListener("pointerleave", () => {
  if (state.isPanning) {
    endPan(state);
  }
});

// Prevent context menu on right click (used for pan)
canvasWrapper.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// --- Cleanup on close ---

window.addEventListener("beforeunload", () => {
  if (screenshotId !== null) {
    invoke("cleanup_screenshot", { id: screenshotId }).catch(() => {});
  }
});

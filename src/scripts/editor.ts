import { invoke } from "@tauri-apps/api/core";
import type { ToolType, StampType, EditorState } from "./editor-types";
import { redrawAll, setupCanvasHandlers, bakeBuffer } from "./editor-canvas";
import { undo, redo } from "./editor-history";
import { copyToClipboard, saveToFile, pinToScreen, performOcr } from "./editor-output";

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
  const width = parseInt(params.get("width") || "0");
  const height = parseInt(params.get("height") || "0");
  if (!idStr || !width || !height) return;

  screenshotId = parseInt(idStr);

  try {
    const buffer = await invoke<ArrayBuffer>("read_screenshot", { id: screenshotId });
    const bytes = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(bytes, width, height);

    canvas.width = width;
    canvas.height = height;
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
document.getElementById("ocr-btn")!.addEventListener("click", () => performOcr(state));

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

// --- Cleanup on close ---

window.addEventListener("beforeunload", () => {
  if (screenshotId !== null) {
    invoke("cleanup_screenshot", { id: screenshotId }).catch(() => {});
  }
});

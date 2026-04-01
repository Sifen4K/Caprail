import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { ToolType, StampType, EditorState } from "./editor-types";
import { redrawAll, setupCanvasHandlers } from "./editor-canvas";
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
  screenshotPath: null,
  canvas,
  ctx,
};

const redraw = () => redrawAll(state);

// --- Image Loading ---

async function loadScreenshot() {
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get("path");
  if (!filePath) return;

  state.screenshotPath = filePath;
  const assetUrl = convertFileSrc(filePath);

  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    state.baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  img.src = assetUrl;
}

loadScreenshot();

// --- Canvas event handlers ---

setupCanvasHandlers(state, redraw);

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

document.getElementById("undo-btn")!.addEventListener("click", () => undo(state, redraw));
document.getElementById("redo-btn")!.addEventListener("click", () => redo(state, redraw));
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
    undo(state, redraw);
  } else if (e.ctrlKey && e.key === "y") {
    e.preventDefault();
    redo(state, redraw);
  } else if (e.ctrlKey && e.key === "c") {
    e.preventDefault();
    copyToClipboard(state, redraw);
  } else if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    saveToFile(state, redraw);
  }
});

// --- Cleanup temp file on close ---

window.addEventListener("beforeunload", () => {
  if (state.screenshotPath) {
    invoke("cleanup_temp_file", { path: state.screenshotPath }).catch(() => {});
  }
});

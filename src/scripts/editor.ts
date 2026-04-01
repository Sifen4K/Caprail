import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

// --- Types ---

type ToolType = "rect" | "ellipse" | "arrow" | "pen" | "text" | "mosaic" | "blur" | "stamp";
type StampType = "counter" | "check" | "cross" | "star";

interface Annotation {
  type: ToolType;
  color: string;
  lineWidth: number;
  // For rect, ellipse, mosaic, blur
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  // For arrow
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  // For pen
  points?: { x: number; y: number }[];
  // For text
  text?: string;
  fontSize?: number;
  // For stamp
  stampType?: StampType;
  stampIndex?: number;
}

// --- State ---

let currentTool: ToolType = "rect";
let currentColor = "#ff0000";
let currentLineWidth = 2;
let currentFontSize = 16;
let currentStamp: StampType = "counter";
let stampCounter = 1;

let annotations: Annotation[] = [];
let redoStack: Annotation[] = [];
let isDrawing = false;
let currentAnnotation: Annotation | null = null;

let baseImageData: ImageData | null = null;

const canvas = document.getElementById("editor-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// --- Image Loading ---

async function loadScreenshot() {
  // Listen for screenshot data passed via event
  const unlisten = await listen<{ width: number; height: number; data: number[] }>(
    "load-screenshot",
    (event) => {
      const { width, height, data } = event.payload;
      canvas.width = width;
      canvas.height = height;

      const imageData = new ImageData(
        new Uint8ClampedArray(data),
        width,
        height
      );
      baseImageData = imageData;
      ctx.putImageData(imageData, 0, 0);
      unlisten();
    }
  );
}

loadScreenshot();

// --- Drawing ---

function redrawAll() {
  if (baseImageData) {
    ctx.putImageData(baseImageData, 0, 0);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  for (const ann of annotations) {
    drawAnnotation(ann);
  }

  if (currentAnnotation) {
    drawAnnotation(currentAnnotation);
  }
}

function drawAnnotation(ann: Annotation) {
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (ann.type) {
    case "rect":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null) {
        ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "ellipse":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null) {
        ctx.beginPath();
        ctx.ellipse(
          ann.x + ann.w / 2,
          ann.y + ann.h / 2,
          Math.abs(ann.w / 2),
          Math.abs(ann.h / 2),
          0, 0, Math.PI * 2
        );
        ctx.stroke();
      }
      break;

    case "arrow":
      if (ann.x1 != null && ann.y1 != null && ann.x2 != null && ann.y2 != null) {
        drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.lineWidth);
      }
      break;

    case "pen":
      if (ann.points && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      }
      break;

    case "text":
      if (ann.text && ann.x != null && ann.y != null) {
        ctx.font = `${ann.fontSize || 16}px sans-serif`;
        ctx.fillText(ann.text, ann.x, ann.y);
      }
      break;

    case "mosaic":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null && baseImageData) {
        applyMosaic(ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "blur":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null && baseImageData) {
        applyBlur(ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "stamp":
      if (ann.x != null && ann.y != null) {
        drawStamp(ctx, ann);
      }
      break;
  }

  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number
) {
  const headLen = Math.max(10, lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function applyMosaic(x: number, y: number, w: number, h: number) {
  if (!baseImageData) return;
  const blockSize = 10;
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const ex = Math.min(baseImageData.width, Math.round(x + w));
  const ey = Math.min(baseImageData.height, Math.round(y + h));

  for (let by = sy; by < ey; by += blockSize) {
    for (let bx = sx; bx < ex; bx += blockSize) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let py = by; py < Math.min(by + blockSize, ey); py++) {
        for (let px = bx; px < Math.min(bx + blockSize, ex); px++) {
          const i = (py * baseImageData.width + px) * 4;
          r += baseImageData.data[i];
          g += baseImageData.data[i + 1];
          b += baseImageData.data[i + 2];
          count++;
        }
      }
      if (count > 0) {
        ctx.fillStyle = `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
        ctx.fillRect(bx, by, Math.min(blockSize, ex - bx), Math.min(blockSize, ey - by));
      }
    }
  }
}

function applyBlur(x: number, y: number, w: number, h: number) {
  if (!baseImageData) return;
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.min(Math.round(w), baseImageData.width - sx);
  const sh = Math.min(Math.round(h), baseImageData.height - sy);
  if (sw <= 0 || sh <= 0) return;

  // Use CSS filter for blur
  ctx.save();
  ctx.filter = "blur(8px)";
  ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, ann: Annotation) {
  const x = ann.x!;
  const y = ann.y!;
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  switch (ann.stampType) {
    case "counter": {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = ann.color;
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(ann.stampIndex || 1), x, y + 1);
      break;
    }
    case "check":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("✓", x, y);
      break;
    case "cross":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("✗", x, y);
      break;
    case "star":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("★", x, y);
      break;
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

// --- Canvas offset helpers ---

function getCanvasPos(e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

// --- Mouse handlers ---

canvas.addEventListener("mousedown", (e) => {
  if (currentTool === "text") {
    showTextInput(e);
    return;
  }

  if (currentTool === "stamp") {
    placeStamp(e);
    return;
  }

  isDrawing = true;
  const pos = getCanvasPos(e);

  switch (currentTool) {
    case "rect":
    case "ellipse":
    case "mosaic":
    case "blur":
      currentAnnotation = {
        type: currentTool,
        color: currentColor,
        lineWidth: currentLineWidth,
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
      };
      break;
    case "arrow":
      currentAnnotation = {
        type: "arrow",
        color: currentColor,
        lineWidth: currentLineWidth,
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
      };
      break;
    case "pen":
      currentAnnotation = {
        type: "pen",
        color: currentColor,
        lineWidth: currentLineWidth,
        points: [pos],
      };
      break;
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!isDrawing || !currentAnnotation) return;
  const pos = getCanvasPos(e);

  switch (currentAnnotation.type) {
    case "rect":
    case "ellipse":
    case "mosaic":
    case "blur":
      currentAnnotation.w = pos.x - currentAnnotation.x!;
      currentAnnotation.h = pos.y - currentAnnotation.y!;
      break;
    case "arrow":
      currentAnnotation.x2 = pos.x;
      currentAnnotation.y2 = pos.y;
      break;
    case "pen":
      currentAnnotation.points!.push(pos);
      break;
  }

  redrawAll();
});

canvas.addEventListener("mouseup", () => {
  if (!isDrawing || !currentAnnotation) return;
  isDrawing = false;

  // Normalize rect dimensions (handle negative w/h)
  if (
    currentAnnotation.type === "rect" ||
    currentAnnotation.type === "ellipse" ||
    currentAnnotation.type === "mosaic" ||
    currentAnnotation.type === "blur"
  ) {
    if (currentAnnotation.w! < 0) {
      currentAnnotation.x! += currentAnnotation.w!;
      currentAnnotation.w = -currentAnnotation.w!;
    }
    if (currentAnnotation.h! < 0) {
      currentAnnotation.y! += currentAnnotation.h!;
      currentAnnotation.h = -currentAnnotation.h!;
    }
    // Skip tiny annotations
    if (currentAnnotation.w! < 3 && currentAnnotation.h! < 3) {
      currentAnnotation = null;
      redrawAll();
      return;
    }
  }

  annotations.push(currentAnnotation);
  redoStack.length = 0;
  currentAnnotation = null;
  redrawAll();
});

// --- Text tool ---

function showTextInput(e: MouseEvent) {
  const overlay = document.getElementById("text-input-overlay")!;
  const input = document.getElementById("text-input") as HTMLTextAreaElement;
  const pos = getCanvasPos(e);
  const canvasRect = canvas.getBoundingClientRect();

  overlay.style.display = "block";
  overlay.style.left = `${canvasRect.left + pos.x}px`;
  overlay.style.top = `${canvasRect.top + pos.y}px`;
  input.style.color = currentColor;
  input.style.fontSize = `${currentFontSize}px`;
  input.value = "";
  input.focus();

  const handleBlur = () => {
    const text = input.value.trim();
    if (text) {
      annotations.push({
        type: "text",
        color: currentColor,
        lineWidth: currentLineWidth,
        x: pos.x,
        y: pos.y + currentFontSize,
        text,
        fontSize: currentFontSize,
      });
      redoStack.length = 0;
      redrawAll();
    }
    overlay.style.display = "none";
    input.removeEventListener("blur", handleBlur);
    input.removeEventListener("keydown", handleKey);
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
  };

  input.addEventListener("blur", handleBlur);
  input.addEventListener("keydown", handleKey);
}

// --- Stamp tool ---

function placeStamp(e: MouseEvent) {
  const pos = getCanvasPos(e);
  const ann: Annotation = {
    type: "stamp",
    color: currentColor,
    lineWidth: currentLineWidth,
    x: pos.x,
    y: pos.y,
    stampType: currentStamp,
  };

  if (currentStamp === "counter") {
    ann.stampIndex = stampCounter++;
  }

  annotations.push(ann);
  redoStack.length = 0;
  redrawAll();
}

// --- Undo / Redo ---

function undo() {
  const last = annotations.pop();
  if (last) {
    redoStack.push(last);
    if (last.type === "stamp" && last.stampType === "counter") {
      stampCounter = Math.max(1, stampCounter - 1);
    }
    redrawAll();
  }
}

function redo() {
  const item = redoStack.pop();
  if (item) {
    annotations.push(item);
    if (item.type === "stamp" && item.stampType === "counter") {
      stampCounter++;
    }
    redrawAll();
  }
}

// --- Output ---

async function copyToClipboard() {
  redrawAll();
  const blob = await canvasToBlob("png");
  if (blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    try {
      await writeImage(uint8Array);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }
}

async function saveToFile() {
  const config = await invoke<{ save_path: string; default_image_format: string }>("load_config");
  const format = config.default_image_format || "png";
  const ext = format === "jpg" ? "jpg" : "png";

  const filePath = await save({
    defaultPath: `${config.save_path}/screenshot.${ext}`,
    filters: [
      { name: "Images", extensions: [ext] },
      { name: "All", extensions: ["png", "jpg"] },
    ],
  });

  if (filePath) {
    redrawAll();
    const mimeType = ext === "jpg" ? "image/jpeg" : "image/png";
    const blob = await canvasToBlob(mimeType);
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(arrayBuffer));
    }
  }
}

function canvasToBlob(type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, 0.95);
  });
}

async function pinToScreen() {
  redrawAll();
  const blob = await canvasToBlob("image/png");
  if (blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const data = Array.from(new Uint8Array(arrayBuffer));
    const { emit } = await import("@tauri-apps/api/event");
    await emit("pin-screenshot", { data, width: canvas.width, height: canvas.height });
  }
}

// --- Toolbar ---

document.querySelectorAll(".tool-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTool = (btn as HTMLElement).dataset.tool as ToolType;

    const fontSizeSlider = document.getElementById("font-size") as HTMLInputElement;
    const lineWidthSlider = document.getElementById("line-width") as HTMLInputElement;
    fontSizeSlider.style.display = currentTool === "text" ? "" : "none";
    lineWidthSlider.style.display = currentTool === "text" ? "none" : "";

    // Show stamp menu when stamp tool selected
    const stampMenu = document.getElementById("stamp-menu")!;
    if (currentTool === "stamp") {
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
    currentStamp = (btn as HTMLElement).dataset.stamp as StampType;
  });
});

(document.getElementById("color-picker") as HTMLInputElement).addEventListener("input", (e) => {
  currentColor = (e.target as HTMLInputElement).value;
});

(document.getElementById("line-width") as HTMLInputElement).addEventListener("input", (e) => {
  currentLineWidth = parseInt((e.target as HTMLInputElement).value);
});

(document.getElementById("font-size") as HTMLInputElement).addEventListener("input", (e) => {
  currentFontSize = parseInt((e.target as HTMLInputElement).value);
});

document.getElementById("undo-btn")!.addEventListener("click", undo);
document.getElementById("redo-btn")!.addEventListener("click", redo);
document.getElementById("copy-btn")!.addEventListener("click", copyToClipboard);
document.getElementById("save-btn")!.addEventListener("click", saveToFile);
document.getElementById("pin-btn")!.addEventListener("click", pinToScreen);
document.getElementById("ocr-btn")!.addEventListener("click", performOcr);

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

async function performOcr() {
  if (!baseImageData) return;

  const ocrPanel = document.getElementById("ocr-panel")!;
  const ocrText = document.getElementById("ocr-text") as HTMLTextAreaElement;
  ocrPanel.style.display = "flex";
  ocrText.value = "Recognizing...";

  try {
    const result = await invoke<{ text: string; regions: unknown[] }>("ocr_recognize", {
      imageData: Array.from(baseImageData.data),
      width: baseImageData.width,
      height: baseImageData.height,
    });
    ocrText.value = result.text || "(No text found)";
  } catch (err) {
    ocrText.value = `OCR error: ${err}`;
  }
}

// --- Keyboard shortcuts ---

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "z") {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && e.key === "y") {
    e.preventDefault();
    redo();
  } else if (e.ctrlKey && e.key === "c") {
    e.preventDefault();
    copyToClipboard();
  } else if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    saveToFile();
  }
});

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { EditorState } from "./editor-types";

type OcrPanelState = {
  requestId: number;
  screenshotId: number | null;
  status: "idle" | "running" | "done" | "error";
  text: string;
};

let ocrRequestId = 0;
const ocrState: OcrPanelState = {
  requestId: 0,
  screenshotId: null,
  status: "idle",
  text: "",
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, 0.95);
  });
}

async function blobToNumberArray(blob: Blob): Promise<number[]> {
  const arrayBuffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
}

export async function copyToClipboard(state: EditorState, redrawAll: () => void) {
  redrawAll();
  const blob = await canvasToBlob(state.canvas, "image/png");
  if (blob) {
    try {
      await invoke("copy_image_to_clipboard", {
        data: await blobToNumberArray(blob),
      });
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }
}

export async function saveToFile(state: EditorState, redrawAll: () => void) {
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
    const blob = await canvasToBlob(state.canvas, mimeType);
    if (blob) {
      await invoke("save_rendered_image", {
        path: filePath,
        data: await blobToNumberArray(blob),
      });
    }
  }
}

export async function pinToScreen(state: EditorState, redrawAll: () => void) {
  if (!state.baseImageData) return;
  redrawAll();
  const blob = await canvasToBlob(state.canvas, "image/png");
  if (blob) {
    // Store image in Rust backend and get an ID
    const pinId = await invoke<number>("save_pin_image", {
      data: await blobToNumberArray(blob),
    });
    const { emit } = await import("@tauri-apps/api/event");
    await emit("pin-screenshot", {
      id: pinId,
      width: state.canvas.width,
      height: state.canvas.height
    });
  }
}

export async function performOcr(screenshotId: number | null) {
  if (screenshotId === null) return;

  const ocrPanel = document.getElementById("ocr-panel")!;
  const ocrText = document.getElementById("ocr-text") as HTMLTextAreaElement;

  // Dynamically set top position based on actual toolbar height
  const toolbar = document.getElementById("toolbar");
  if (toolbar) {
    ocrPanel.style.top = `${toolbar.offsetHeight}px`;
  }

  ocrPanel.style.display = "flex";

  if (
    ocrState.screenshotId === screenshotId &&
    (ocrState.status === "running" || ocrState.status === "done")
  ) {
    ocrText.value = ocrState.text;
    return;
  }

  const requestId = ++ocrRequestId;
  ocrState.requestId = requestId;
  ocrState.screenshotId = screenshotId;
  ocrState.status = "running";
  ocrState.text = "Recognizing...";
  ocrText.value = ocrState.text;

  try {
    const result = await invoke<{ text: string; regions: unknown[] }>("ocr_recognize_screenshot", {
      id: screenshotId,
    });
    if (ocrState.requestId !== requestId) {
      return;
    }
    ocrState.status = "done";
    ocrState.text = result.text || "(No text found)";
    if (ocrPanel.style.display !== "none") {
      ocrText.value = ocrState.text;
    }
  } catch (err) {
    if (ocrState.requestId !== requestId) {
      return;
    }
    ocrState.status = "error";
    ocrState.text = `OCR error: ${err}`;
    if (ocrPanel.style.display !== "none") {
      ocrText.value = ocrState.text;
    }
  }
}

export function closeOcrPanel() {
  const ocrPanel = document.getElementById("ocr-panel")!;
  ocrPanel.style.display = "none";
}

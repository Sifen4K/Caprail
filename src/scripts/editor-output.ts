import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { EditorState } from "./editor-types";

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, 0.95);
  });
}

export async function copyToClipboard(state: EditorState, redrawAll: () => void) {
  redrawAll();
  const blob = await canvasToBlob(state.canvas, "png");
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
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(arrayBuffer));
    }
  }
}

export async function pinToScreen(state: EditorState, redrawAll: () => void) {
  if (!state.baseImageData) return;
  redrawAll();
  const blob = await canvasToBlob(state.canvas, "image/png");
  if (blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    // Store image in Rust backend and get an ID
    const pinId = await invoke<number>("save_pin_image", {
      data: Array.from(uint8Array),
    });
    const { emit } = await import("@tauri-apps/api/event");
    await emit("pin-screenshot", {
      id: pinId,
      width: state.canvas.width,
      height: state.canvas.height
    });
  }
}

export async function performOcr(state: EditorState) {
  if (!state.baseImageData) return;

  const ocrPanel = document.getElementById("ocr-panel")!;
  const ocrText = document.getElementById("ocr-text") as HTMLTextAreaElement;
  ocrPanel.style.display = "flex";
  ocrText.value = "Recognizing...";

  try {
    const result = await invoke<{ text: string; regions: unknown[] }>("ocr_recognize", {
      imageData: Array.from(state.baseImageData.data),
      width: state.baseImageData.width,
      height: state.baseImageData.height,
    });
    ocrText.value = result.text || "(No text found)";
  } catch (err) {
    ocrText.value = `OCR error: ${err}`;
  }
}

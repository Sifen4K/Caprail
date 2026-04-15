import type { EditorState } from "./editor-types";
import { drawAnnotation } from "./editor-tools";
import {
  beginAnnotation,
  commitAnnotation,
  commitTextAnnotation,
  finalizeAnnotationDraft,
  placeStampAnnotation,
  updateAnnotationDraft,
} from "./editor-session.logic";
import { getCanvasPosWithZoom } from "./editor-zoom";

// Track active text input state to prevent duplicate listeners
let activeTextInput: {
  overlay: HTMLElement;
  input: HTMLTextAreaElement;
  state: EditorState;
  pos: { x: number; y: number };
  dpiScale: number;
  blurHandler: () => void;
  keyHandler: (e: KeyboardEvent) => void;
} | null = null;

export function getCanvasPosZoomAware(state: EditorState, e: MouseEvent) {
  return getCanvasPosWithZoom(state, e);
}

export function bakeBuffer(state: EditorState) {
  if (!state.baseImageData || !state.bufferCanvas || !state.bufferCtx) return;

  const origCtx = state.ctx;
  const origCanvas = state.canvas;

  state.ctx = state.bufferCtx;
  state.canvas = state.bufferCanvas;

  state.bufferCtx.putImageData(state.baseImageData, 0, 0);
  for (const ann of state.annotations) {
    drawAnnotation(state, ann);
  }

  state.ctx = origCtx;
  state.canvas = origCanvas;
}

export function redrawAll(state: EditorState) {
  const { ctx, canvas } = state;

  if (state.bufferCanvas) {
    ctx.drawImage(state.bufferCanvas, 0, 0);
  } else if (state.baseImageData) {
    ctx.putImageData(state.baseImageData, 0, 0);
    for (const ann of state.annotations) {
      drawAnnotation(state, ann);
    }
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (state.currentAnnotation) {
    drawAnnotation(state, state.currentAnnotation);
  }
}

export function setupCanvasHandlers(state: EditorState, redraw: () => void, onAnnotationChange: () => void) {
  const { canvas } = state;

  // Use click event for text and stamp tools (more reliable than mousedown)
  canvas.addEventListener("click", (e) => {
    // Only respond to left button (button 0)
    if (e.button !== 0) return;

    if (state.currentTool === "text") {
      showTextInput(state, e, onAnnotationChange);
      return;
    }

    if (state.currentTool === "stamp") {
      placeStamp(state, e, onAnnotationChange);
      return;
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    // Only allow drawing with left mouse button (button 0)
    if (e.button !== 0) return;
    // Don't start drawing if panning
    if (state.isPanning) return;

    // Always use zoom-aware position for consistency
    const pos = getCanvasPosZoomAware(state, e);
    state.currentAnnotation = beginAnnotation(state, pos);
    state.isDrawing = state.currentAnnotation !== null;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!state.isDrawing || !state.currentAnnotation) return;
    // Always use zoom-aware position for consistency
    const pos = getCanvasPosZoomAware(state, e);
    state.currentAnnotation = updateAnnotationDraft(state.currentAnnotation, pos);

    redraw();
  });

  canvas.addEventListener("mouseup", (e) => {
    // Only handle left button release
    if (e.button !== 0) return;
    if (!state.isDrawing || !state.currentAnnotation) return;
    state.isDrawing = false;

    const finalizedAnnotation = finalizeAnnotationDraft(state.currentAnnotation);
    state.currentAnnotation = null;

    if (!finalizedAnnotation) {
      redraw();
      return;
    }

    commitAnnotation(state, finalizedAnnotation);
    onAnnotationChange();
  });
}

function showTextInput(state: EditorState, e: MouseEvent, redraw: () => void) {
  const overlay = document.getElementById("text-input-overlay")!;
  const input = document.getElementById("text-input") as HTMLTextAreaElement;

  // Position overlay directly at mouse click position (viewport coordinates)
  // This works correctly with zoom since viewport position doesn't change
  const clickX = e.clientX;
  const clickY = e.clientY;

  // Calculate physical pixel position for the annotation
  // Always use zoom-aware coordinates for consistency
  const pos = getCanvasPosZoomAware(state, e);
  const dpiScale = state.dpiScale;

  // If there's already an active text input, finalize it first
  if (activeTextInput) {
    // Remove old listeners before finalizing
    activeTextInput.input.removeEventListener("blur", activeTextInput.blurHandler);
    activeTextInput.input.removeEventListener("keydown", activeTextInput.keyHandler);

    // Save the current text if any, using the state from when input started
    const text = activeTextInput.input.value;
    const savedState = activeTextInput.state;
    if (commitTextAnnotation(savedState, text, activeTextInput.pos, activeTextInput.dpiScale)) {
      redraw();
    }
    activeTextInput.overlay.style.display = "none";
    activeTextInput = null;
  }

  // Show input at click position
  overlay.style.display = "block";
  overlay.style.left = `${clickX}px`;
  overlay.style.top = `${clickY}px`;
  input.style.color = state.currentColor;
  input.style.fontSize = `${state.currentFontSize}px`;
  input.value = "";
  input.focus();

  const blurHandler = () => {
    if (commitTextAnnotation(state, input.value, pos, dpiScale)) {
      redraw();
    }
    overlay.style.display = "none";
    input.removeEventListener("blur", blurHandler);
    input.removeEventListener("keydown", keyHandler);
    activeTextInput = null;
  };

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
  };

  input.addEventListener("blur", blurHandler);
  input.addEventListener("keydown", keyHandler);

  // Track active input state
  activeTextInput = {
    overlay,
    input,
    state,
    pos,
    dpiScale,
    blurHandler,
    keyHandler,
  };
}

function placeStamp(state: EditorState, e: MouseEvent, redraw: () => void) {
  // Always use zoom-aware coordinates for consistency
  const pos = getCanvasPosZoomAware(state, e);
  placeStampAnnotation(state, pos);
  redraw();
}

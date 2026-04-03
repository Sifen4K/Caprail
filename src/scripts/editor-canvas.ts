import type { Annotation, EditorState } from "./editor-types";
import { drawAnnotation } from "./editor-tools";
import { addAnnotation } from "./editor-history";

export function getCanvasPos(canvas: HTMLCanvasElement, e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  // Convert logical (CSS) coordinates to physical pixel coordinates
  // canvas.width/height are physical pixels, rect.width/height are CSS pixels
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
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

  canvas.addEventListener("mousedown", (e) => {
    if (state.currentTool === "text") {
      showTextInput(state, e, onAnnotationChange);
      return;
    }

    if (state.currentTool === "stamp") {
      placeStamp(state, e, onAnnotationChange);
      return;
    }

    state.isDrawing = true;
    const pos = getCanvasPos(canvas, e);

    switch (state.currentTool) {
      case "rect":
      case "ellipse":
      case "mosaic":
      case "blur":
        state.currentAnnotation = {
          type: state.currentTool,
          color: state.currentColor,
          lineWidth: state.currentLineWidth,
          x: pos.x,
          y: pos.y,
          w: 0,
          h: 0,
        };
        break;
      case "arrow":
        state.currentAnnotation = {
          type: "arrow",
          color: state.currentColor,
          lineWidth: state.currentLineWidth,
          x1: pos.x,
          y1: pos.y,
          x2: pos.x,
          y2: pos.y,
        };
        break;
      case "pen":
        state.currentAnnotation = {
          type: "pen",
          color: state.currentColor,
          lineWidth: state.currentLineWidth,
          points: [pos],
        };
        break;
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!state.isDrawing || !state.currentAnnotation) return;
    const pos = getCanvasPos(canvas, e);

    switch (state.currentAnnotation.type) {
      case "rect":
      case "ellipse":
      case "mosaic":
      case "blur":
        state.currentAnnotation.w = pos.x - state.currentAnnotation.x!;
        state.currentAnnotation.h = pos.y - state.currentAnnotation.y!;
        break;
      case "arrow":
        state.currentAnnotation.x2 = pos.x;
        state.currentAnnotation.y2 = pos.y;
        break;
      case "pen":
        state.currentAnnotation.points!.push(pos);
        break;
    }

    redraw();
  });

  canvas.addEventListener("mouseup", () => {
    if (!state.isDrawing || !state.currentAnnotation) return;
    state.isDrawing = false;

    if (
      state.currentAnnotation.type === "rect" ||
      state.currentAnnotation.type === "ellipse" ||
      state.currentAnnotation.type === "mosaic" ||
      state.currentAnnotation.type === "blur"
    ) {
      if (state.currentAnnotation.w! < 0) {
        state.currentAnnotation.x! += state.currentAnnotation.w!;
        state.currentAnnotation.w = -state.currentAnnotation.w!;
      }
      if (state.currentAnnotation.h! < 0) {
        state.currentAnnotation.y! += state.currentAnnotation.h!;
        state.currentAnnotation.h = -state.currentAnnotation.h!;
      }
      if (state.currentAnnotation.w! < 3 && state.currentAnnotation.h! < 3) {
        state.currentAnnotation = null;
        redraw();
        return;
      }
    }

    state.annotations.push(state.currentAnnotation);
    state.redoStack.length = 0;
    state.currentAnnotation = null;
    onAnnotationChange();
  });
}

function showTextInput(state: EditorState, e: MouseEvent, redraw: () => void) {
  const overlay = document.getElementById("text-input-overlay")!;
  const input = document.getElementById("text-input") as HTMLTextAreaElement;
  const pos = getCanvasPos(state.canvas, e);
  const canvasRect = state.canvas.getBoundingClientRect();

  // Convert physical pixel position to logical (CSS) position for overlay
  const dpiScale = state.dpiScale;
  const logicalX = pos.x / dpiScale;
  const logicalY = pos.y / dpiScale;

  overlay.style.display = "block";
  overlay.style.left = `${canvasRect.left + logicalX}px`;
  overlay.style.top = `${canvasRect.top + logicalY}px`;
  input.style.color = state.currentColor;
  input.style.fontSize = `${state.currentFontSize}px`;
  input.value = "";
  input.focus();

  const handleBlur = () => {
    const text = input.value.trim();
    if (text) {
      addAnnotation(state, {
        type: "text",
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        x: pos.x,
        y: pos.y + state.currentFontSize * dpiScale, // Use physical pixels
        text,
        fontSize: state.currentFontSize * dpiScale, // Scale font size to physical pixels
      }, redraw);
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

function placeStamp(state: EditorState, e: MouseEvent, redraw: () => void) {
  const pos = getCanvasPos(state.canvas, e);
  const ann: Annotation = {
    type: "stamp",
    color: state.currentColor,
    lineWidth: state.currentLineWidth,
    x: pos.x,
    y: pos.y,
    stampType: state.currentStamp,
  };

  if (state.currentStamp === "counter") {
    ann.stampIndex = state.stampCounter++;
  }

  addAnnotation(state, ann, redraw);
}

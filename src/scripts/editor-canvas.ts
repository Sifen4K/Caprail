import type { Annotation, EditorState } from "./editor-types";
import { drawAnnotation } from "./editor-tools";
import { addAnnotation } from "./editor-history";

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

export function getCanvasPos(canvas: HTMLCanvasElement, e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  // Protect against division by zero
  if (rect.width === 0 || rect.height === 0) {
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }
  // Convert logical (CSS) coordinates to physical pixel coordinates
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

  // Use click event for text and stamp tools (more reliable than mousedown)
  canvas.addEventListener("click", (e) => {
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

  // Position overlay directly at mouse click position (viewport coordinates)
  const clickX = e.clientX;
  const clickY = e.clientY;

  // Calculate physical pixel position for the annotation
  const pos = getCanvasPos(state.canvas, e);
  const dpiScale = state.dpiScale;

  // If there's already an active text input, finalize it first
  if (activeTextInput) {
    // Remove old listeners before finalizing
    activeTextInput.input.removeEventListener("blur", activeTextInput.blurHandler);
    activeTextInput.input.removeEventListener("keydown", activeTextInput.keyHandler);

    // Save the current text if any, using the state from when input started
    const text = activeTextInput.input.value.trim();
    if (text) {
      const savedState = activeTextInput.state;
      addAnnotation(savedState, {
        type: "text",
        color: savedState.currentColor,
        lineWidth: savedState.currentLineWidth,
        x: activeTextInput.pos.x,
        y: activeTextInput.pos.y + savedState.currentFontSize * activeTextInput.dpiScale,
        text,
        fontSize: savedState.currentFontSize * activeTextInput.dpiScale,
      }, redraw);
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
    const text = input.value.trim();
    if (text) {
      addAnnotation(state, {
        type: "text",
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        x: pos.x,
        y: pos.y + state.currentFontSize * dpiScale,
        text,
        fontSize: state.currentFontSize * dpiScale,
      }, redraw);
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

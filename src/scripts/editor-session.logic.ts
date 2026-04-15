import type { Annotation, EditorState } from "./editor-types";

export interface EditorCanvasPoint {
  x: number;
  y: number;
}

export type EditorSessionState = Pick<
  EditorState,
  | "currentTool"
  | "currentColor"
  | "currentLineWidth"
  | "currentFontSize"
  | "currentStamp"
  | "stampCounter"
  | "annotations"
  | "redoStack"
>;

function isBoxAnnotation(type: Annotation["type"]) {
  return type === "rect" || type === "ellipse" || type === "mosaic" || type === "blur";
}

function isCounterStamp(annotation: Annotation) {
  return annotation.type === "stamp" && annotation.stampType === "counter";
}

export function beginAnnotation(state: EditorSessionState, pos: EditorCanvasPoint): Annotation | null {
  switch (state.currentTool) {
    case "rect":
    case "ellipse":
    case "mosaic":
    case "blur":
      return {
        type: state.currentTool,
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
      };
    case "arrow":
      return {
        type: "arrow",
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
      };
    case "pen":
      return {
        type: "pen",
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        points: [pos],
      };
    default:
      return null;
  }
}

export function updateAnnotationDraft(annotation: Annotation, pos: EditorCanvasPoint): Annotation {
  switch (annotation.type) {
    case "rect":
    case "ellipse":
    case "mosaic":
    case "blur":
      return {
        ...annotation,
        w: pos.x - (annotation.x ?? pos.x),
        h: pos.y - (annotation.y ?? pos.y),
      };
    case "arrow":
      return {
        ...annotation,
        x2: pos.x,
        y2: pos.y,
      };
    case "pen":
      if (annotation.points) {
        annotation.points.push(pos);
        return annotation;
      }

      return {
        ...annotation,
        points: [pos],
      };
    default:
      return annotation;
  }
}

export function finalizeAnnotationDraft(annotation: Annotation): Annotation | null {
  if (!isBoxAnnotation(annotation.type)) {
    return annotation;
  }

  let x = annotation.x ?? 0;
  let y = annotation.y ?? 0;
  let w = annotation.w ?? 0;
  let h = annotation.h ?? 0;

  if (w < 0) {
    x += w;
    w = -w;
  }

  if (h < 0) {
    y += h;
    h = -h;
  }

  if (w < 3 && h < 3) {
    return null;
  }

  return {
    ...annotation,
    x,
    y,
    w,
    h,
  };
}

export function commitAnnotation(state: EditorSessionState, annotation: Annotation): Annotation {
  state.annotations.push(annotation);
  state.redoStack.length = 0;
  return annotation;
}

export function buildTextAnnotation(
  state: EditorSessionState,
  text: string,
  pos: EditorCanvasPoint,
  dpiScale: number,
): Annotation | null {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return null;
  }

  return {
    type: "text",
    color: state.currentColor,
    lineWidth: state.currentLineWidth,
    x: pos.x,
    y: pos.y + state.currentFontSize * dpiScale,
    text: trimmedText,
    fontSize: state.currentFontSize * dpiScale,
  };
}

export function commitTextAnnotation(
  state: EditorSessionState,
  text: string,
  pos: EditorCanvasPoint,
  dpiScale: number,
): Annotation | null {
  const annotation = buildTextAnnotation(state, text, pos, dpiScale);
  if (!annotation) {
    return null;
  }

  return commitAnnotation(state, annotation);
}

export function createStampAnnotation(state: EditorSessionState, pos: EditorCanvasPoint): Annotation {
  const annotation: Annotation = {
    type: "stamp",
    color: state.currentColor,
    lineWidth: state.currentLineWidth,
    x: pos.x,
    y: pos.y,
    stampType: state.currentStamp,
  };

  if (state.currentStamp === "counter") {
    annotation.stampIndex = state.stampCounter;
    state.stampCounter += 1;
  }

  return annotation;
}

export function placeStampAnnotation(state: EditorSessionState, pos: EditorCanvasPoint): Annotation {
  return commitAnnotation(state, createStampAnnotation(state, pos));
}

export function undoAnnotation(state: EditorSessionState): Annotation | null {
  const annotation = state.annotations.pop() ?? null;
  if (!annotation) {
    return null;
  }

  state.redoStack.push(annotation);
  if (isCounterStamp(annotation)) {
    state.stampCounter = Math.max(1, state.stampCounter - 1);
  }

  return annotation;
}

export function redoAnnotation(state: EditorSessionState): Annotation | null {
  const annotation = state.redoStack.pop() ?? null;
  if (!annotation) {
    return null;
  }

  state.annotations.push(annotation);
  if (isCounterStamp(annotation)) {
    state.stampCounter += 1;
  }

  return annotation;
}

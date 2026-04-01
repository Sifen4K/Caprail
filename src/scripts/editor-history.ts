import type { Annotation, EditorState } from "./editor-types";

export function undo(state: EditorState, redrawAll: () => void) {
  const last = state.annotations.pop();
  if (last) {
    state.redoStack.push(last);
    if (last.type === "stamp" && last.stampType === "counter") {
      state.stampCounter = Math.max(1, state.stampCounter - 1);
    }
    redrawAll();
  }
}

export function redo(state: EditorState, redrawAll: () => void) {
  const item = state.redoStack.pop();
  if (item) {
    state.annotations.push(item);
    if (item.type === "stamp" && item.stampType === "counter") {
      state.stampCounter++;
    }
    redrawAll();
  }
}

export function addAnnotation(state: EditorState, ann: Annotation, redrawAll: () => void) {
  state.annotations.push(ann);
  state.redoStack.length = 0;
  redrawAll();
}

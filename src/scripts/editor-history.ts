import type { Annotation, EditorState } from "./editor-types";
import { commitAnnotation, redoAnnotation, undoAnnotation } from "./editor-session.logic";

export function undo(state: EditorState, redrawAll: () => void) {
  if (undoAnnotation(state)) {
    redrawAll();
  }
}

export function redo(state: EditorState, redrawAll: () => void) {
  if (redoAnnotation(state)) {
    redrawAll();
  }
}

export function addAnnotation(state: EditorState, ann: Annotation, redrawAll: () => void) {
  commitAnnotation(state, ann);
  redrawAll();
}

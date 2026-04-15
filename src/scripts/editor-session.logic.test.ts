import { describe, expect, it } from "vitest";
import type { Annotation } from "./editor-types";
import {
  beginAnnotation,
  commitAnnotation,
  commitTextAnnotation,
  finalizeAnnotationDraft,
  placeStampAnnotation,
  redoAnnotation,
  undoAnnotation,
  updateAnnotationDraft,
  type EditorSessionState,
} from "./editor-session.logic";

function makeState(overrides: Partial<EditorSessionState> = {}): EditorSessionState {
  return {
    currentTool: "rect",
    currentColor: "#ff0000",
    currentLineWidth: 2,
    currentFontSize: 16,
    currentStamp: "counter",
    stampCounter: 1,
    annotations: [],
    redoStack: [],
    ...overrides,
  };
}

describe("editor drawing transitions", () => {
  it("creates box annotations from the active tool", () => {
    const annotation = beginAnnotation(makeState(), { x: 20, y: 30 });

    expect(annotation).toEqual({
      type: "rect",
      color: "#ff0000",
      lineWidth: 2,
      x: 20,
      y: 30,
      w: 0,
      h: 0,
    });
  });

  it("does not enter drawing mode for text and stamp tools", () => {
    expect(beginAnnotation(makeState({ currentTool: "text" }), { x: 10, y: 20 })).toBeNull();
    expect(beginAnnotation(makeState({ currentTool: "stamp" }), { x: 10, y: 20 })).toBeNull();
  });

  it("updates pen drafts by appending new points", () => {
    const draft = beginAnnotation(makeState({ currentTool: "pen" }), { x: 5, y: 6 });
    const originalPoints = (draft as Annotation).points;
    const updated = updateAnnotationDraft(draft as Annotation, { x: 7, y: 9 });

    expect(updated).toBe(draft);
    expect(updated.points).toBe(originalPoints);
    expect(updated.points).toEqual([
      { x: 5, y: 6 },
      { x: 7, y: 9 },
    ]);
  });

  it("normalizes negative drag rectangles before commit", () => {
    const normalized = finalizeAnnotationDraft({
      type: "rect",
      color: "#ff0000",
      lineWidth: 2,
      x: 100,
      y: 80,
      w: -40,
      h: -20,
    });

    expect(normalized).toEqual({
      type: "rect",
      color: "#ff0000",
      lineWidth: 2,
      x: 60,
      y: 60,
      w: 40,
      h: 20,
    });
  });

  it("drops tiny box drags instead of polluting history", () => {
    const finalized = finalizeAnnotationDraft({
      type: "ellipse",
      color: "#ff0000",
      lineWidth: 2,
      x: 10,
      y: 10,
      w: 2,
      h: 2,
    });

    expect(finalized).toBeNull();
  });
});

describe("editor history transitions", () => {
  it("clears redo history when a new annotation is committed", () => {
    const state = makeState({
      redoStack: [
        {
          type: "arrow",
          color: "#00ff00",
          lineWidth: 3,
          x1: 1,
          y1: 1,
          x2: 9,
          y2: 9,
        },
      ],
    });

    commitAnnotation(state, {
      type: "rect",
      color: "#ff0000",
      lineWidth: 2,
      x: 10,
      y: 10,
      w: 30,
      h: 40,
    });

    expect(state.annotations).toHaveLength(1);
    expect(state.redoStack).toEqual([]);
  });

  it("keeps counter stamp numbering consistent across add, undo, and redo", () => {
    const state = makeState();

    const first = placeStampAnnotation(state, { x: 20, y: 30 });
    const second = placeStampAnnotation(state, { x: 40, y: 50 });

    expect(first.stampIndex).toBe(1);
    expect(second.stampIndex).toBe(2);
    expect(state.stampCounter).toBe(3);

    const undone = undoAnnotation(state);
    expect(undone?.stampIndex).toBe(2);
    expect(state.annotations).toHaveLength(1);
    expect(state.redoStack).toHaveLength(1);
    expect(state.stampCounter).toBe(2);

    const redone = redoAnnotation(state);
    expect(redone?.stampIndex).toBe(2);
    expect(state.annotations).toHaveLength(2);
    expect(state.redoStack).toHaveLength(0);
    expect(state.stampCounter).toBe(3);
  });
});

describe("editor text transitions", () => {
  it("commits trimmed text annotations with physical font sizing", () => {
    const state = makeState({
      currentColor: "#00ff00",
      currentLineWidth: 4,
      currentFontSize: 18,
    });

    const annotation = commitTextAnnotation(state, "  hello  ", { x: 24, y: 32 }, 1.5);

    expect(annotation).toEqual({
      type: "text",
      color: "#00ff00",
      lineWidth: 4,
      x: 24,
      y: 59,
      text: "hello",
      fontSize: 27,
    });
    expect(state.annotations).toEqual([annotation]);
  });

  it("ignores empty text submissions", () => {
    const state = makeState();

    expect(commitTextAnnotation(state, "   ", { x: 10, y: 10 }, 2)).toBeNull();
    expect(state.annotations).toEqual([]);
  });
});

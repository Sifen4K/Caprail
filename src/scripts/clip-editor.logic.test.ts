import { describe, expect, it } from "vitest";
import {
  buildInitialClipEditorState,
  createClipEditorSession,
  getPlaybackTerminalFrame,
  prepareExportRequest,
  toExportFrameRange,
} from "./clip-editor.logic";

describe("clip editor frame range semantics", () => {
  it("initial full-range selection should include the last frame for export", () => {
    const state = buildInitialClipEditorState(10, 30);
    const range = toExportFrameRange(state.trimStartFrame, state.trimEndFrame);

    expect(range.startFrame).toBe(0);
    expect(range.endFrame).toBe(10);
  });

  it("single-frame recordings should still export one frame", () => {
    const state = buildInitialClipEditorState(1, 30);
    const range = toExportFrameRange(state.trimStartFrame, state.trimEndFrame);

    expect(range.startFrame).toBe(0);
    expect(range.endFrame - range.startFrame).toBe(1);
  });

  it("playback should stop on the last selected frame", () => {
    const state = buildInitialClipEditorState(10, 30);

    expect(getPlaybackTerminalFrame(state.trimEndFrame)).toBe(9);
  });
});

describe("clip editor export workflow", () => {
  it("builds a full-length export request that includes the final frame", () => {
    const session = createClipEditorSession(10, 30);
    const request = prepareExportRequest(session, "capture.mp4", 1, "mp4");

    expect(request).toMatchObject({
      outputPath: "capture.mp4",
      startFrame: 0,
      endFrame: 10,
      speed: 1,
      format: "mp4",
      gifFps: null,
      gifMaxWidth: null,
    });
  });

  it("builds a single-frame export request that still contains one frame", () => {
    const session = createClipEditorSession(1, 30);
    const request = prepareExportRequest(session, "capture.gif", 1.25, "gif");

    expect(request.startFrame).toBe(0);
    expect(request.endFrame - request.startFrame).toBe(1);
    expect(request.gifFps).toBe(15);
    expect(request.gifMaxWidth).toBe(640);
  });
});

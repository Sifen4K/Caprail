import { describe, expect, it } from "vitest";
import {
  buildInitialClipEditorState,
  buildTimelineGeometry,
  createClipEditorSession,
  getPlaybackTerminalFrame,
  prepareExportRequest,
  resolvePlayheadLeft,
  resolveTrimLayout,
  timelineFrameToOffset,
  timelineOffsetToFrame,
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

describe("clip editor timeline geometry", () => {
  it("maps the visible track between the handle inner edges", () => {
    const geometry = buildTimelineGeometry(230, 8, 10);

    expect(geometry.trackLeft).toBe(8);
    expect(geometry.trackRight).toBe(220);
    expect(geometry.trackWidth).toBe(212);
  });

  it("converts frames using the inner visual track instead of the full hit area", () => {
    const geometry = buildTimelineGeometry(210, 10, 10);

    expect(timelineFrameToOffset(0, 11, geometry)).toBe(10);
    expect(timelineFrameToOffset(10, 11, geometry)).toBe(200);
    expect(timelineOffsetToFrame(0, 11, geometry)).toBe(0);
    expect(timelineOffsetToFrame(210, 11, geometry)).toBe(10);
  });

  it("keeps the visible selected region inside the visual handle edges while hit areas extend outward", () => {
    const geometry = buildTimelineGeometry(210, 10, 10);
    const layout = resolveTrimLayout(11, 2, 8, geometry, {
      startHandleWidth: 16,
      endHandleWidth: 16,
    });

    expect(layout.startBoundary).toBe(48);
    expect(layout.endBoundary).toBe(143);
    expect(layout.startHandleLeft).toBe(32);
    expect(layout.endHandleLeft).toBe(143);
    expect(layout.regionLeft).toBe(48);
    expect(layout.regionWidth).toBe(95);
  });

  it("keeps the playhead fully visible before the right visual edge", () => {
    const geometry = buildTimelineGeometry(210, 10, 10);

    expect(resolvePlayheadLeft(0, 11, geometry, 2)).toBe(10);
    expect(resolvePlayheadLeft(10, 11, geometry, 2)).toBe(198);
  });

  it("positions the playhead by center rather than by its left edge", () => {
    const geometry = buildTimelineGeometry(210, 10, 10);

    expect(resolvePlayheadLeft(5, 11, geometry, 5)).toBe(102.5);
  });
});

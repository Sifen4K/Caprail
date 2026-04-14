import { describe, expect, it } from "vitest";
import {
  buildTimelineGeometry,
  getPlaybackTerminalFrame,
  resolvePlaybackStartFrame,
  resolvePlayheadLeft,
  resolveTrimLayout,
  timelineFrameToOffset,
  timelineOffsetToFrame,
} from "./clip-editor.logic";

describe("clip editor frame range semantics", () => {
  it("playback should stop on the last selected frame", () => {
    expect(getPlaybackTerminalFrame(10)).toBe(9);
  });

  it("restarts from the selected first frame when play is pressed on the terminal frame", () => {
    expect(resolvePlaybackStartFrame(9, 2, 10)).toBe(2);
  });

  it("starts from the selected first frame when the current frame is outside the trim range", () => {
    expect(resolvePlaybackStartFrame(1, 2, 8)).toBe(2);
    expect(resolvePlaybackStartFrame(8, 2, 8)).toBe(2);
  });

  it("continues from the current frame when it is inside the trim range and before the terminal frame", () => {
    expect(resolvePlaybackStartFrame(5, 2, 8)).toBe(5);
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

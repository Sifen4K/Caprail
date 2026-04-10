import { describe, expect, it } from "vitest";
import {
  buildMixedDpiCaptureScenario,
  findWindowAtLogicalPoint,
  logicalRectToRecordingSelection,
  overlayLogicalToPhysical,
  physicalToOverlayLogical,
  type MonitorInfo,
} from "./coordinate-mapping";

const mixedDpiMonitors: MonitorInfo[] = [
  {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scale_factor: 1,
    is_primary: true,
  },
  {
    x: 1920,
    y: 0,
    width: 2560,
    height: 1440,
    scale_factor: 1.5,
    is_primary: false,
  },
];

describe("mixed-DPI coordinate mapping", () => {
  it("maps physical points on secondary monitors using that monitor's DPI", () => {
    const point = physicalToOverlayLogical(2040, 300, 0, 0, 1, mixedDpiMonitors);

    expect(point.x).toBeCloseTo(2000);
    expect(point.y).toBeCloseTo(300);
  });

  it("converts overlay logical coordinates back to physical pixels per monitor", () => {
    const point = overlayLogicalToPhysical(2000, 300, 0, 0, 1, mixedDpiMonitors);

    expect(point.x).toBe(2040);
    expect(point.y).toBe(300);
  });

  it("converts recording selections on a secondary monitor without using a global dpr", () => {
    const selection = logicalRectToRecordingSelection(
      {
        x: 2000,
        y: 100,
        w: 120,
        h: 80,
      },
      0,
      0,
      1,
      [
        {
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          scaleFactor: 1,
        },
        {
          position: { x: 1920, y: 0 },
          size: { width: 2560, height: 1440 },
          scaleFactor: 1.5,
        },
      ]
    );

    expect(selection.x).toBe(2040);
    expect(selection.width).toBe(180);
  });

  it("finds hovered windows on a secondary monitor using per-monitor mapping", () => {
    const hovered = findWindowAtLogicalPoint(
      2000,
      300,
      [
        { x: 1980, y: 250, width: 240, height: 180 },
        { x: 0, y: 0, width: 1920, height: 1080 },
      ],
      0,
      0,
      1,
      mixedDpiMonitors
    );

    expect(hovered).not.toBeNull();
    expect(hovered?.x).toBe(1980);
  });

  it("keeps screenshot hover, crop, and recording payload aligned on the same secondary-monitor region", () => {
    const scenario = buildMixedDpiCaptureScenario(
      2000,
      300,
      120,
      80,
      0,
      0,
      1,
      mixedDpiMonitors,
      [
        { x: 1980, y: 250, width: 240, height: 180 },
        { x: 0, y: 0, width: 1920, height: 1080 },
      ]
    );

    expect(scenario.hoveredWindow?.x).toBe(1980);
    expect(scenario.screenshotTopLeft.x).toBe(2040);
    expect(scenario.screenshotBottomRight.x).toBe(2220);
    expect(scenario.recordingSelection.x).toBe(2040);
    expect(scenario.recordingSelection.width).toBe(180);
  });
});

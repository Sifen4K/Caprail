import { describe, expect, it } from "vitest";
import {
  buildPhysicalRect,
  computeCenteredRect,
  computeControlWindowGeometry,
  computeDraggedPhysicalPosition,
  findMonitorAtPoint,
  findSmallestWindowAtPoint,
  shouldCancelOverlayOnRightClick,
  toPhysicalCanvasPoint,
  toSelectionRect,
  translateCanvasRectToDesktop,
} from "./physical-capture.logic";

const mixedDpiMonitors = [
  { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 },
  { x: 1920, y: 0, width: 2560, height: 1440, scaleFactor: 1.5 },
];

describe("physical capture geometry", () => {
  it("keeps screenshot hover, screenshot crop, and recording selection aligned on a 4K 150% monitor", () => {
    const dpr = 1.5;
    const windowOrigin = { x: 1920, y: 0 };
    const dragStart = toPhysicalCanvasPoint(80, 120, dpr);
    const dragEnd = toPhysicalCanvasPoint(200, 220, dpr);
    const canvasRect = buildPhysicalRect(dragStart, dragEnd);
    const desktopRect = translateCanvasRectToDesktop(canvasRect, windowOrigin);
    const hoveredWindow = findSmallestWindowAtPoint(
      { x: desktopRect.x + 10, y: desktopRect.y + 10 },
      [
        { x: 1980, y: 170, width: 240, height: 180 },
        { x: 1920, y: 0, width: 2560, height: 1440 },
      ],
    );

    expect(canvasRect).toEqual({ x: 120, y: 180, w: 180, h: 150 });
    expect(desktopRect).toEqual({ x: 2040, y: 180, w: 180, h: 150 });
    expect(toSelectionRect(desktopRect)).toEqual({
      x: 2040,
      y: 180,
      width: 180,
      height: 150,
    });
    expect(hoveredWindow).toMatchObject({ x: 1980, y: 170, width: 240, height: 180 });
  });

  it("picks the physical monitor under the cursor even when the virtual desktop has a negative origin", () => {
    const monitors = [
      { x: -2560, y: 0, width: 2560, height: 1440, scaleFactor: 1.5 },
      { x: 0, y: 0, width: 3840, height: 2160, scaleFactor: 2 },
    ];

    const leftMonitor = findMonitorAtPoint({ x: -1200, y: 500 }, monitors);
    const rightMonitor = findMonitorAtPoint({ x: 3200, y: 1200 }, monitors);

    expect(leftMonitor).toMatchObject({ x: -2560, width: 2560, scaleFactor: 1.5 });
    expect(rightMonitor).toMatchObject({ x: 0, width: 3840, scaleFactor: 2 });
  });

  it("places the record control bar below the selection when there is room and keeps it inside the physical desktop", () => {
    const selection = { x: 2100, y: 300, width: 800, height: 500 };
    const desktopBounds = { x: 0, y: 0, w: 4480, h: 1440 };

    const control = computeControlWindowGeometry(selection, desktopBounds, 1.5);

    expect(control).toEqual({
      x: 2335,
      y: 815,
      width: 330,
      height: 78,
    });
  });

  it("flips the record control bar above the selection when the lower edge would overflow", () => {
    const selection = { x: 3500, y: 1260, width: 700, height: 140 };
    const desktopBounds = { x: 0, y: 0, w: 4480, h: 1440 };

    const control = computeControlWindowGeometry(selection, desktopBounds, 1.5);

    expect(control).toEqual({
      x: 3685,
      y: 1167,
      width: 330,
      height: 78,
    });
  });

  it("centers pin windows and applies drag deltas in physical pixels", () => {
    const centered = computeCenteredRect(3840, 2160, { x: 0, y: 0, w: 4480, h: 2160 });
    const dragged = computeDraggedPhysicalPosition(
      { x: centered.x, y: centered.y },
      12,
      -8,
      1.5,
    );

    expect(centered).toEqual({
      x: 320,
      y: 0,
      width: 3840,
      height: 2160,
    });
    expect(dragged).toEqual({
      x: 338,
      y: -12,
    });
  });

  it("keeps full-screen targeting and scaled control placement consistent on the active monitor", () => {
    const selectedMonitor = findMonitorAtPoint({ x: 2600, y: 600 }, mixedDpiMonitors);
    const selection = { x: 2400, y: 400, width: 600, height: 300 };
    const control = computeControlWindowGeometry(
      selection,
      { x: 0, y: 0, w: 4480, h: 1440 },
      selectedMonitor?.scaleFactor ?? 1,
    );

    expect(selectedMonitor).toMatchObject({ x: 1920, width: 2560, scaleFactor: 1.5 });
    expect(control.width).toBe(330);
    expect(control.height).toBe(78);
    expect(control.y).toBe(selection.y + selection.height + 15);
  });

  it("treats right click as overlay cancel before selection starts and while a drag is active", () => {
    expect(shouldCancelOverlayOnRightClick(false, 2, 2)).toBe(true);
    expect(shouldCancelOverlayOnRightClick(true, 2, 3)).toBe(true);
    expect(shouldCancelOverlayOnRightClick(true, 2, 2)).toBe(false);
    expect(shouldCancelOverlayOnRightClick(false, 0, 1)).toBe(false);
  });
});

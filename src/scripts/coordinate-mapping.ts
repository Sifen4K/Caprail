export interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  is_primary: boolean;
}

export interface LogicalPoint {
  x: number;
  y: number;
}

export interface PhysicalPoint {
  x: number;
  y: number;
}

export interface LogicalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecordingSelection {
  x: number;
  y: number;
  width: number;
  height: number;
  logicalX: number;
  logicalY: number;
  logicalWidth: number;
  logicalHeight: number;
}

export interface WindowInfoLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function findWindowAtLogicalPoint<T extends WindowInfoLike>(
  logicalX: number,
  logicalY: number,
  windows: T[],
  monitorOriginX: number,
  monitorOriginY: number,
  dpiScale: number,
  monitors: MonitorInfo[]
): T | null {
  const physicalPoint = overlayLogicalToPhysical(
    logicalX,
    logicalY,
    monitorOriginX,
    monitorOriginY,
    dpiScale,
    monitors
  );

  let best: T | null = null;
  let bestArea = Infinity;

  for (const windowInfo of windows) {
    const containsPoint =
      physicalPoint.x >= windowInfo.x &&
      physicalPoint.x < windowInfo.x + windowInfo.width &&
      physicalPoint.y >= windowInfo.y &&
      physicalPoint.y < windowInfo.y + windowInfo.height;

    if (!containsPoint) continue;

    const area = windowInfo.width * windowInfo.height;
    if (area < bestArea) {
      best = windowInfo;
      bestArea = area;
    }
  }

  return best;
}

export function physicalToOverlayLogical(
  physicalX: number,
  physicalY: number,
  monitorOriginX: number,
  monitorOriginY: number,
  dpiScale: number,
  _monitors: MonitorInfo[]
): LogicalPoint {
  const overlayPhysicalX = physicalX - monitorOriginX;
  const overlayPhysicalY = physicalY - monitorOriginY;
  return {
    x: overlayPhysicalX / dpiScale,
    y: overlayPhysicalY / dpiScale,
  };
}

export function overlayLogicalToPhysical(
  logicalX: number,
  logicalY: number,
  monitorOriginX: number,
  monitorOriginY: number,
  dpiScale: number,
  _monitors: MonitorInfo[]
): PhysicalPoint {
  return {
    x: monitorOriginX + logicalX * dpiScale,
    y: monitorOriginY + logicalY * dpiScale,
  };
}

export function logicalRectToRecordingSelection(
  logRect: LogicalRect,
  originPhysX: number,
  originPhysY: number,
  dpr: number,
  _monitors: Array<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    scaleFactor: number;
  }>
): RecordingSelection {
  const physX = Math.round(originPhysX + logRect.x * dpr);
  const physY = Math.round(originPhysY + logRect.y * dpr);
  const physW = Math.round(logRect.w * dpr);
  const physH = Math.round(logRect.h * dpr);

  const logAbsX = originPhysX / dpr + logRect.x;
  const logAbsY = originPhysY / dpr + logRect.y;

  return {
    x: physX,
    y: physY,
    width: physW,
    height: physH,
    logicalX: logAbsX,
    logicalY: logAbsY,
    logicalWidth: logRect.w,
    logicalHeight: logRect.h,
  };
}

export function buildMixedDpiCaptureScenario(
  logicalX: number,
  logicalY: number,
  logicalWidth: number,
  logicalHeight: number,
  monitorOriginX: number,
  monitorOriginY: number,
  dpiScale: number,
  monitors: MonitorInfo[],
  windows: WindowInfoLike[]
) {
  return {
    hoveredWindow: findWindowAtLogicalPoint(
      logicalX,
      logicalY,
      windows,
      monitorOriginX,
      monitorOriginY,
      dpiScale,
      monitors
    ),
    screenshotTopLeft: overlayLogicalToPhysical(
      logicalX,
      logicalY,
      monitorOriginX,
      monitorOriginY,
      dpiScale,
      monitors
    ),
    screenshotBottomRight: overlayLogicalToPhysical(
      logicalX + logicalWidth,
      logicalY + logicalHeight,
      monitorOriginX,
      monitorOriginY,
      dpiScale,
      monitors
    ),
    recordingSelection: logicalRectToRecordingSelection(
      { x: logicalX, y: logicalY, w: logicalWidth, h: logicalHeight },
      monitorOriginX,
      monitorOriginY,
      dpiScale,
      monitors.map((monitor) => ({
        position: { x: monitor.x, y: monitor.y },
        size: { width: monitor.width, height: monitor.height },
        scaleFactor: monitor.scale_factor,
      }))
    ),
  };
}

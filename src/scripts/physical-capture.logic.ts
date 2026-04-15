export interface PhysicalPointLike {
  x: number;
  y: number;
}

export interface PhysicalRectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhysicalSelectionLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalWindowLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalMonitorLike {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export function toPhysicalCanvasPoint(
  clientX: number,
  clientY: number,
  dpr: number,
): PhysicalPointLike {
  return {
    x: clientX * dpr,
    y: clientY * dpr,
  };
}

export function buildPhysicalRect(
  start: PhysicalPointLike,
  end: PhysicalPointLike,
): PhysicalRectLike {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export function translateCanvasRectToDesktop(
  rect: PhysicalRectLike,
  windowOrigin: PhysicalPointLike,
): PhysicalRectLike {
  return {
    x: rect.x + windowOrigin.x,
    y: rect.y + windowOrigin.y,
    w: rect.w,
    h: rect.h,
  };
}

export function toSelectionRect(rect: PhysicalRectLike): PhysicalSelectionLike {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
  };
}

export function findSmallestWindowAtPoint<T extends PhysicalWindowLike>(
  point: PhysicalPointLike,
  windows: readonly T[],
): T | null {
  let best: T | null = null;
  let bestArea = Infinity;

  for (const windowInfo of windows) {
    const containsPoint =
      point.x >= windowInfo.x &&
      point.x < windowInfo.x + windowInfo.width &&
      point.y >= windowInfo.y &&
      point.y < windowInfo.y + windowInfo.height;

    if (!containsPoint) continue;

    const area = windowInfo.width * windowInfo.height;
    if (area < bestArea) {
      best = windowInfo;
      bestArea = area;
    }
  }

  return best;
}

export function findMonitorAtPoint<T extends PhysicalMonitorLike>(
  point: PhysicalPointLike,
  monitors: readonly T[],
): T | null {
  for (const monitor of monitors) {
    if (
      point.x >= monitor.x &&
      point.x < monitor.x + monitor.width &&
      point.y >= monitor.y &&
      point.y < monitor.y + monitor.height
    ) {
      return monitor;
    }
  }

  return null;
}

export function computeControlWindowGeometry(
  selection: PhysicalSelectionLike,
  desktopBounds: PhysicalRectLike,
  scaleFactor: number,
): PhysicalSelectionLike {
  const width = Math.max(220, Math.round(220 * scaleFactor));
  const height = Math.max(52, Math.round(52 * scaleFactor));
  const margin = Math.max(10, Math.round(10 * scaleFactor));

  const maxX = desktopBounds.x + desktopBounds.w - width;
  const maxY = desktopBounds.y + desktopBounds.h - height;
  const preferredX = Math.round(selection.x + selection.width / 2 - width / 2);
  const preferredY = Math.round(selection.y + selection.height + margin);
  const fallbackY = Math.round(selection.y - height - margin);

  return {
    x: Math.min(Math.max(preferredX, desktopBounds.x), maxX),
    y: preferredY <= maxY ? preferredY : Math.max(fallbackY, desktopBounds.y),
    width,
    height,
  };
}

export function computeCenteredRect(
  contentWidth: number,
  contentHeight: number,
  desktopBounds: PhysicalRectLike,
): PhysicalSelectionLike {
  const width = Math.max(1, Math.round(contentWidth));
  const height = Math.max(1, Math.round(contentHeight));

  return {
    x: Math.round(desktopBounds.x + Math.max(0, desktopBounds.w - width) / 2),
    y: Math.round(desktopBounds.y + Math.max(0, desktopBounds.h - height) / 2),
    width,
    height,
  };
}

export function computeDraggedPhysicalPosition(
  currentPosition: PhysicalPointLike,
  movementCssX: number,
  movementCssY: number,
  dpr: number,
): PhysicalPointLike {
  return {
    x: Math.round(currentPosition.x + movementCssX * dpr),
    y: Math.round(currentPosition.y + movementCssY * dpr),
  };
}

export function shouldCancelOverlayOnRightClick(
  isSelecting: boolean,
  button: number,
  buttons: number,
): boolean {
  if (button !== 2) {
    return false;
  }

  if (!isSelecting) {
    return true;
  }

  return (buttons & 1) === 1;
}

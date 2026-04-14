export interface TimelineGeometry {
  containerWidth: number;
  trackLeft: number;
  trackRight: number;
  trackWidth: number;
}

export interface TrimHandleLayoutMetrics {
  startHandleWidth: number;
  endHandleWidth: number;
}

export interface TrimLayout {
  startBoundary: number;
  endBoundary: number;
  startHandleLeft: number;
  endHandleLeft: number;
  regionLeft: number;
  regionWidth: number;
}

export function getPlaybackTerminalFrame(trimEndFrame: number): number {
  return Math.max(trimEndFrame - 1, 0);
}

export function resolvePlaybackStartFrame(
  currentFrame: number,
  trimStartFrame: number,
  trimEndFrame: number
): number {
  const terminalFrame = getPlaybackTerminalFrame(trimEndFrame);

  if (currentFrame < trimStartFrame || currentFrame >= terminalFrame) {
    return trimStartFrame;
  }

  return currentFrame;
}

export function buildTimelineGeometry(
  containerWidth: number,
  trackStartInset: number,
  trackEndInset: number
): TimelineGeometry {
  const safeContainerWidth = Math.max(containerWidth, 0);
  const safeTrackStartInset = Math.max(trackStartInset, 0);
  const safeTrackEndInset = Math.max(trackEndInset, 0);
  const trackLeft = Math.min(safeTrackStartInset, safeContainerWidth);
  const trackRight = Math.max(trackLeft, safeContainerWidth - safeTrackEndInset);

  return {
    containerWidth: safeContainerWidth,
    trackLeft,
    trackRight,
    trackWidth: Math.max(trackRight - trackLeft, 0),
  };
}

export function timelineFrameToOffset(
  frameIndex: number,
  totalFrames: number,
  geometry: TimelineGeometry
): number {
  if (geometry.trackWidth <= 0) {
    return geometry.trackLeft;
  }

  if (totalFrames <= 1) {
    return geometry.trackLeft;
  }

  const clampedFrame = Math.max(0, Math.min(frameIndex, totalFrames - 1));
  const ratio = clampedFrame / (totalFrames - 1);
  return geometry.trackLeft + ratio * geometry.trackWidth;
}

export function timelineOffsetToFrame(
  offset: number,
  totalFrames: number,
  geometry: TimelineGeometry
): number {
  if (totalFrames <= 1 || geometry.trackWidth <= 0) {
    return 0;
  }

  const clampedOffset = Math.max(
    geometry.trackLeft,
    Math.min(offset, geometry.trackRight)
  );
  const ratio = (clampedOffset - geometry.trackLeft) / geometry.trackWidth;
  return Math.round(ratio * (totalFrames - 1));
}

export function resolvePlayheadLeft(
  frameIndex: number,
  totalFrames: number,
  geometry: TimelineGeometry,
  playheadWidth: number
): number {
  const safePlayheadWidth = Math.max(playheadWidth, 0);
  const halfPlayheadWidth = safePlayheadWidth / 2;
  const center = timelineFrameToOffset(frameIndex, totalFrames, geometry);
  const minCenter = geometry.trackLeft + halfPlayheadWidth;
  const maxCenter = Math.max(minCenter, geometry.trackRight - halfPlayheadWidth);
  const clampedCenter = Math.max(minCenter, Math.min(center, maxCenter));

  return clampedCenter - halfPlayheadWidth;
}

export function resolveTrimLayout(
  totalFrames: number,
  trimStartFrame: number,
  trimEndFrame: number,
  geometry: TimelineGeometry,
  handleMetrics: TrimHandleLayoutMetrics
): TrimLayout {
  const startBoundary =
    totalFrames <= 1
      ? geometry.trackLeft
      : timelineFrameToOffset(trimStartFrame, totalFrames, geometry);
  const endBoundary =
    totalFrames <= 1
      ? geometry.trackRight
      : timelineFrameToOffset(
          getPlaybackTerminalFrame(trimEndFrame),
          totalFrames,
          geometry
        );

  return {
    startBoundary,
    endBoundary,
    startHandleLeft: startBoundary - Math.max(handleMetrics.startHandleWidth, 0),
    endHandleLeft: endBoundary,
    regionLeft: startBoundary,
    regionWidth: Math.max(endBoundary - startBoundary, 0),
  };
}

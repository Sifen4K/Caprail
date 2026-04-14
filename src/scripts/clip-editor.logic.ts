export interface ClipEditorState {
  totalFrames: number;
  fps: number;
  duration: number;
  trimStartFrame: number;
  trimEndFrame: number;
}

export interface ClipEditorSession {
  totalFrames: number;
  fps: number;
  duration: number;
  selection: {
    startFrame: number;
    endFrame: number;
  };
}

export interface ExportRequest {
  outputPath: string;
  startFrame: number;
  endFrame: number;
  speed: number;
  format: "mp4" | "gif";
  gifFps: number | null;
  gifMaxWidth: number | null;
}

export function buildInitialClipEditorState(
  totalFrames: number,
  fps: number
): ClipEditorState {
  return {
    totalFrames,
    fps,
    duration: totalFrames / fps,
    trimStartFrame: 0,
    trimEndFrame: totalFrames,
  };
}

export function toExportFrameRange(trimStartFrame: number, trimEndFrame: number): {
  startFrame: number;
  endFrame: number;
} {
  return {
    startFrame: trimStartFrame,
    endFrame: trimEndFrame,
  };
}

export function getPlaybackTerminalFrame(trimEndFrame: number): number {
  return Math.max(trimEndFrame - 1, 0);
}

export function createClipEditorSession(
  totalFrames: number,
  fps: number
): ClipEditorSession {
  const state = buildInitialClipEditorState(totalFrames, fps);
  return {
    totalFrames: state.totalFrames,
    fps: state.fps,
    duration: state.duration,
    selection: {
      startFrame: state.trimStartFrame,
      endFrame: state.trimEndFrame,
    },
  };
}

export function prepareExportRequest(
  session: ClipEditorSession,
  outputPath: string,
  speed: number,
  format: "mp4" | "gif"
): ExportRequest {
  const range = toExportFrameRange(
    session.selection.startFrame,
    session.selection.endFrame
  );

  return {
    outputPath,
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    speed,
    format,
    gifFps: format === "gif" ? 15 : null,
    gifMaxWidth: format === "gif" ? 640 : null,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";

const canvas = document.getElementById("player-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const playBtn = document.getElementById("play-btn")!;
const timeDisplay = document.getElementById("time-display")!;
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const timeline = document.getElementById("timeline")!;
const playhead = document.getElementById("timeline-playhead")!;
const trimStartHandle = document.getElementById("trim-start")!;
const trimEndHandle = document.getElementById("trim-end")!;
const trimRegion = document.getElementById("trim-region")!;
const exportMp4Btn = document.getElementById("export-mp4-btn")!;
const exportGifBtn = document.getElementById("export-gif-btn")!;
const exportProgress = document.getElementById("export-progress")!;
const exportProgressBar = document.getElementById("export-progress-bar")!;

let totalFrames = 0;
let fps = 30;
let videoWidth = 0;
let videoHeight = 0;
let duration = 0;

let currentFrame = 0;
let trimStartFrame = 0;
let trimEndFrame = 0;
let isPlaying = false;
let playbackSpeed = 1.0;
let lastFrameTime = 0;
let animFrameId = 0;

// Frame cache for smooth playback
const frameCache = new Map<number, ImageData>();
const CACHE_AHEAD = 8;
const MAX_CACHE_SIZE = 30;

// In-flight fetch tracking
const pendingFetches = new Set<number>();
const MAX_INFLIGHT = 4;

// ── Initialization ────────────────────────────────────────────────────

invoke<{ width: number; height: number; fps: number; frameCount: number }>(
  "get_recording_info"
)
  .then((info) => {
    videoWidth = info.width;
    videoHeight = info.height;
    fps = info.fps;
    totalFrames = info.frameCount;
    duration = totalFrames / fps;
    trimEndFrame = totalFrames - 1;

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    updateTimeDisplay();
    updateTrimUI();

    // Render first frame
    fetchAndRender(0);
  })
  .catch((err) => {
    console.error("Failed to load recording info:", err);
  });

// Free in-memory frames when editor window closes
window.addEventListener("beforeunload", () => {
  invoke("cleanup_recording").catch(() => {});
});

// ── Frame rendering ───────────────────────────────────────────────────

async function fetchFrame(frameIndex: number): Promise<ImageData | null> {
  if (frameCache.has(frameIndex)) {
    return frameCache.get(frameIndex)!;
  }

  if (pendingFetches.has(frameIndex)) {
    return null; // already being fetched
  }

  pendingFetches.add(frameIndex);

  try {
    const buffer = await invoke<ArrayBuffer>("read_recording_frame", {
      frameIndex,
    });

    const bytes = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(bytes, videoWidth, videoHeight);

    // Cache management: evict frames far from current position
    if (frameCache.size >= MAX_CACHE_SIZE) {
      const keys = [...frameCache.keys()];
      for (const key of keys) {
        if (Math.abs(key - frameIndex) > CACHE_AHEAD * 2) {
          frameCache.delete(key);
          if (frameCache.size < MAX_CACHE_SIZE) break;
        }
      }
      if (frameCache.size >= MAX_CACHE_SIZE) {
        let farthest = keys[0];
        let maxDist = 0;
        for (const key of keys) {
          const dist = Math.abs(key - frameIndex);
          if (dist > maxDist) { maxDist = dist; farthest = key; }
        }
        frameCache.delete(farthest);
      }
    }

    frameCache.set(frameIndex, imageData);
    return imageData;
  } catch (err) {
    console.error(`Failed to fetch frame ${frameIndex}:`, err);
    return null;
  } finally {
    pendingFetches.delete(frameIndex);
  }
}

/** Synchronous render from cache. Returns true if frame was available. */
function renderFrameSync(frameIndex: number): boolean {
  if (frameIndex < 0 || frameIndex >= totalFrames) return false;

  const imageData = frameCache.get(frameIndex);
  if (imageData) {
    currentFrame = frameIndex;
    ctx.putImageData(imageData, 0, 0);
    updatePlayhead();
    updateTimeDisplay();
    return true;
  }
  return false;
}

/** Async: fetch frame, render, and prefetch ahead. Used for seek/init. */
async function fetchAndRender(frameIndex: number) {
  if (frameIndex < 0 || frameIndex >= totalFrames) return;
  currentFrame = frameIndex;

  const imageData = await fetchFrame(frameIndex);
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }

  updatePlayhead();
  updateTimeDisplay();
  prefetchFrames(frameIndex);
}

function prefetchFrames(fromFrame: number) {
  for (let i = 1; i <= CACHE_AHEAD; i++) {
    if (pendingFetches.size >= MAX_INFLIGHT) break;

    const idx = fromFrame + i;
    if (idx < totalFrames && !frameCache.has(idx) && !pendingFetches.has(idx)) {
      fetchFrame(idx); // fire-and-forget
    }
  }
}

// ── Playback engine ───────────────────────────────────────────────────

function startPlayback() {
  if (isPlaying) return;
  isPlaying = true;
  playBtn.textContent = "\u23F8";

  if (currentFrame < trimStartFrame || currentFrame >= trimEndFrame) {
    currentFrame = trimStartFrame;
  }

  prefetchFrames(currentFrame);

  lastFrameTime = performance.now();
  playbackLoop();
}

function stopPlayback() {
  isPlaying = false;
  playBtn.textContent = "\u25B6";
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = 0;
  }
}

function playbackLoop() {
  if (!isPlaying) return;

  animFrameId = requestAnimationFrame((now) => {
    const frameDuration = 1000 / (fps * playbackSpeed);
    const elapsed = now - lastFrameTime;

    if (elapsed >= frameDuration) {
      const framesToAdvance = Math.max(1, Math.floor(elapsed / frameDuration));
      const nextFrame = currentFrame + framesToAdvance;

      if (nextFrame >= trimEndFrame) {
        renderFrameSync(trimStartFrame) || fetchAndRender(trimStartFrame);
        stopPlayback();
        return;
      }

      if (renderFrameSync(nextFrame)) {
        lastFrameTime = now - (elapsed % frameDuration);
      }
      currentFrame = nextFrame;

      prefetchFrames(nextFrame);
    }

    playbackLoop();
  });
}

// ── Controls ──────────────────────────────────────────────────────────

playBtn.addEventListener("click", () => {
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

speedSelect.addEventListener("change", () => {
  playbackSpeed = parseFloat(speedSelect.value);
});

timeline.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).classList.contains("trim-handle")) return;
  const rect = timeline.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const targetFrame = Math.round(ratio * (totalFrames - 1));
  fetchAndRender(Math.max(0, Math.min(totalFrames - 1, targetFrame)));
});

let draggingTrim: "start" | "end" | null = null;

trimStartHandle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  draggingTrim = "start";
});

trimEndHandle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  draggingTrim = "end";
});

document.addEventListener("mousemove", (e) => {
  if (!draggingTrim) return;
  const rect = timeline.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const frame = Math.round(ratio * (totalFrames - 1));

  if (draggingTrim === "start") {
    trimStartFrame = Math.min(frame, trimEndFrame - 1);
  } else {
    trimEndFrame = Math.max(frame, trimStartFrame + 1);
  }

  updateTrimUI();
  updateTimeDisplay();
});

document.addEventListener("mouseup", () => {
  draggingTrim = null;
});

// ── UI updates ────────────────────────────────────────────────────────

function updatePlayhead() {
  if (totalFrames > 0) {
    const ratio = currentFrame / (totalFrames - 1);
    playhead.style.left = `${ratio * 100}%`;
  }
}

function updateTrimUI() {
  if (totalFrames <= 0) return;
  const startRatio = trimStartFrame / (totalFrames - 1);
  const endRatio = trimEndFrame / (totalFrames - 1);
  trimStartHandle.style.left = `${startRatio * 100}%`;
  trimEndHandle.style.left = `${endRatio * 100 - 1}%`;
  trimRegion.style.left = `${startRatio * 100}%`;
  trimRegion.style.width = `${(endRatio - startRatio) * 100}%`;
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateTimeDisplay() {
  const currentTime = currentFrame / fps;
  const trimStartTime = trimStartFrame / fps;
  const trimEndTime = trimEndFrame / fps;
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)} [${formatTime(trimStartTime)} - ${formatTime(trimEndTime)}]`;
}

// ── Export ─────────────────────────────────────────────────────────────

let unlistenProgress: UnlistenFn | null = null;
let unlistenComplete: UnlistenFn | null = null;

async function doExport(format: "mp4" | "gif") {
  const ext = format;
  const defaultName = `recording-export.${ext}`;

  const outputPath = await save({
    defaultPath: defaultName,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });

  if (!outputPath) return;

  exportProgress.style.display = "block";
  exportProgressBar.style.width = "0%";

  unlistenProgress = await listen<{ progress: number }>(
    "export-progress",
    (event) => {
      exportProgressBar.style.width = `${event.payload.progress * 100}%`;
    }
  );

  unlistenComplete = await listen<{ success: boolean; outputPath?: string; error?: string }>(
    "export-complete",
    (event) => {
      if (event.payload.success) {
        exportProgressBar.style.width = "100%";
        setTimeout(() => {
          exportProgress.style.display = "none";
          exportProgressBar.style.width = "0%";
        }, 1500);
      } else {
        console.error("Export failed:", event.payload.error);
        exportProgress.style.display = "none";
        exportProgressBar.style.width = "0%";
      }

      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      unlistenProgress = null;
      unlistenComplete = null;
    }
  );

  try {
    await invoke("export_video", {
      config: {
        outputPath,
        startFrame: trimStartFrame,
        endFrame: trimEndFrame,
        speed: playbackSpeed,
        format,
        gifFps: format === "gif" ? 15 : null,
        gifMaxWidth: format === "gif" ? 640 : null,
      },
    });
  } catch (err) {
    console.error("Export invocation failed:", err);
    exportProgress.style.display = "none";
    exportProgressBar.style.width = "0%";
  }
}

exportMp4Btn.addEventListener("click", () => doExport("mp4"));
exportGifBtn.addEventListener("click", () => doExport("gif"));

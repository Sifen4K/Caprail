import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import {
  buildTimelineGeometry,
  getPlaybackTerminalFrame,
  resolvePlaybackStartFrame,
  resolvePlayheadLeft,
  resolveTrimLayout,
  timelineOffsetToFrame,
} from "./clip-editor.logic";
import {
  buildDefaultSavePath,
  persistLastUsedSaveDirectory,
} from "./save-dialog.logic";

const canvas = document.getElementById("player-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const playBtn = document.getElementById("play-btn")!;
const timeDisplay = document.getElementById("time-display")!;
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const timeline = document.getElementById("timeline")!;
const timelineTrack = document.getElementById("timeline-track")!;
const playhead = document.getElementById("timeline-playhead")!;
const trimStartHandle = document.getElementById("trim-start")!;
const trimEndHandle = document.getElementById("trim-end")!;
const trimStartVisual = document.getElementById("trim-start-visual")!;
const trimEndVisual = document.getElementById("trim-end-visual")!;
const trimRegion = document.getElementById("trim-region")!;
const exportMp4Btn = document.getElementById("export-mp4-btn")!;
const exportGifBtn = document.getElementById("export-gif-btn")!;
const exportProgress = document.getElementById("export-progress")!;
const exportProgressBar = document.getElementById("export-progress-bar")!;
const systemAudioToggle = document.getElementById("system-audio-toggle") as HTMLInputElement;
const micAudioToggle = document.getElementById("mic-audio-toggle") as HTMLInputElement;

let totalFrames = 0;
let fps = 30;
let videoWidth = 0;
let videoHeight = 0;
let duration = 0;

let currentFrame = 0;
let trimStartFrame = 0;
let trimEndFrame = 0;
let isPlaying = false;
let isStartingPlayback = false;
let playbackSpeed = 1.0;
let lastFrameTime = 0;
let animFrameId = 0;
let pendingPlaybackFrame: number | null = null;
let recordingGeneration = 0;
let systemAudio: HTMLAudioElement | null = null;
let micAudio: HTMLAudioElement | null = null;
let systemAudioAvailable = false;
let micAudioAvailable = false;
let systemAudioUserChanged = false;
let micAudioUserChanged = false;

// ── Unified drag state ────────────────────────────────────────────────
type DragMode = null | "scrub" | "trim-start" | "trim-end";
let dragMode: DragMode = null;

// Frame cache for smooth playback
const frameCache = new Map<number, ImageData>();
const CACHE_AHEAD = 8;
const MAX_CACHE_SIZE = 30;

// In-flight fetch tracking
const pendingFetches = new Map<number, Promise<ImageData | null>>();
const MAX_INFLIGHT = 4;

// ── Initialization ────────────────────────────────────────────────────

async function loadRecording() {
  resetRecordingState();
  const generation = recordingGeneration;

  try {
    const info = await invoke<{
      width: number;
      height: number;
      fps: number;
      frameCount: number;
      durationSecs: number;
      trimStartFrame: number;
      trimEndFrame: number;
      terminalFrame: number;
      systemAudioAvailable: boolean;
      micAvailable: boolean;
    }>("get_recording_editor_session");

    videoWidth = info.width;
    videoHeight = info.height;
    fps = info.fps;
    totalFrames = info.frameCount;
    duration = info.durationSecs;
    trimStartFrame = info.trimStartFrame;
    trimEndFrame = info.trimEndFrame;
    currentFrame = Math.min(currentFrame, info.terminalFrame);
    systemAudioAvailable = info.systemAudioAvailable;
    micAudioAvailable = info.micAvailable;
    systemAudioUserChanged = false;
    micAudioUserChanged = false;
    systemAudioToggle.checked = systemAudioAvailable;
    systemAudioToggle.disabled = !systemAudioAvailable;
    micAudioToggle.checked = micAudioAvailable;
    micAudioToggle.disabled = !micAudioAvailable;
    if (generation !== recordingGeneration) {
      return;
    }

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    updateTimeDisplay();
    updateTrimUI();

    fetchAndRender(trimStartFrame);
    void loadAudioPreviews(info.systemAudioAvailable, info.micAvailable, generation);
  } catch (err) {
    console.error("Failed to load recording info:", err);
  }
}

// Try loading immediately (works if window created after recording stopped).
// Always listen for the ready signal too: a hidden pre-created editor can start
// before the old recording store has been cleared, so a later stop must force a
// fresh load even if the first read succeeded.
listen("recording-data-ready", () => loadRecording()).catch((err) => {
  console.error("Failed to listen for recording data readiness:", err);
});

invoke("get_recording_editor_session")
  .then(() => loadRecording())
  .catch(() => {});

// Free in-memory frames when editor window closes
window.addEventListener("beforeunload", () => {
  invoke("cleanup_recording").catch(() => {});
});

// ── Frame rendering ───────────────────────────────────────────────────

async function fetchFrame(frameIndex: number): Promise<ImageData | null> {
  if (frameCache.has(frameIndex)) {
    return frameCache.get(frameIndex)!;
  }

  const pending = pendingFetches.get(frameIndex);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const generation = recordingGeneration;

    try {
      const buffer = await invoke<ArrayBuffer>("read_recording_frame", {
        frameIndex,
      });

      if (generation !== recordingGeneration) {
        return null;
      }

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
  })();

  pendingFetches.set(frameIndex, request);
  return request;
}

function paintFrame(frameIndex: number, imageData: ImageData) {
  currentFrame = frameIndex;
  ctx.putImageData(imageData, 0, 0);
  updatePlayhead();
  updateTimeDisplay();
}

/** Synchronous render from cache. Returns true if frame was available. */
function renderFrameSync(frameIndex: number): boolean {
  if (frameIndex < 0 || frameIndex >= totalFrames) return false;

  const imageData = frameCache.get(frameIndex);
  if (imageData) {
    paintFrame(frameIndex, imageData);
    return true;
  }
  return false;
}

async function renderFrameAsync(frameIndex: number): Promise<boolean> {
  if (frameIndex < 0 || frameIndex >= totalFrames) return false;

  const cached = frameCache.get(frameIndex);
  if (cached) {
    paintFrame(frameIndex, cached);
    prefetchFrames(frameIndex);
    return true;
  }

  currentFrame = frameIndex;
  updatePlayhead();
  updateTimeDisplay();

  const imageData = await fetchFrame(frameIndex);
  if (!imageData || currentFrame !== frameIndex) {
    return false;
  }

  paintFrame(frameIndex, imageData);
  prefetchFrames(frameIndex);
  return true;
}

/** Async: fetch frame, render, and prefetch ahead. Used for seek/init. */
async function fetchAndRender(frameIndex: number) {
  await renderFrameAsync(frameIndex);
}

async function loadAudioPreviews(systemAvailable: boolean, micAvailable: boolean, generation: number) {
  disposeAudioPreviews();

  if (systemAvailable) {
    systemAudio = await loadAudioPreview("system", generation);
    if (systemAudio) {
      activateAudioPreview(systemAudio, systemAudioToggle, "System audio");
    }
  }

  if (micAvailable) {
    micAudio = await loadAudioPreview("mic", generation);
    if (micAudio) {
      activateAudioPreview(micAudio, micAudioToggle, "Mic audio");
    }
  }
}

async function loadAudioPreview(kind: "system" | "mic", generation: number): Promise<HTMLAudioElement | null> {
  try {
    const path = await invoke<string>("get_recording_audio_track_path", { kind });
    if (generation !== recordingGeneration) return null;

    const url = convertFileSrc(path);
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.playbackRate = playbackSpeed;

    return audio;
  } catch (err) {
    console.error(`Failed to load ${kind} audio preview:`, err);
    return null;
  }
}

function activateAudioPreview(audio: HTMLAudioElement, toggle: HTMLInputElement, label: string) {
  audio.muted = !toggle.checked;
  audio.playbackRate = playbackSpeed;
  if (isPlaying) {
    syncAudioElementToFrame(audio, currentFrame);
    void audio.play().catch((err) => console.error(`${label} preview failed:`, err));
  }
}

function disposeAudioPreviews() {
  pauseAudioPlayback();
  systemAudio = null;
  micAudio = null;
}

function currentFrameTime(frameIndex: number): number {
  return fps > 0 ? frameIndex / fps : 0;
}

function syncAudioElementToFrame(audio: HTMLAudioElement, frameIndex: number) {
  const time = currentFrameTime(frameIndex);
  if (Number.isFinite(time)) {
    audio.currentTime = Math.max(0, time);
  }
}

function syncAudioToFrame(frameIndex: number) {
  for (const audio of [systemAudio, micAudio]) {
    if (!audio) continue;
    syncAudioElementToFrame(audio, frameIndex);
  }
}

function startAudioPlayback(frameIndex: number) {
  syncAudioToFrame(frameIndex);
  if (systemAudio) {
    systemAudio.muted = !systemAudioToggle.checked;
    systemAudio.playbackRate = playbackSpeed;
    void systemAudio.play().catch((err) => console.error("System audio preview failed:", err));
  }
  if (micAudio) {
    micAudio.muted = !micAudioToggle.checked;
    micAudio.playbackRate = playbackSpeed;
    void micAudio.play().catch((err) => console.error("Mic audio preview failed:", err));
  }
}

function pauseAudioPlayback() {
  systemAudio?.pause();
  micAudio?.pause();
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

// ── Seek throttle ─────────────────────────────────────────────────────

let pendingSeekFrame: number | null = null;
let seekInProgress = false;

function resetRecordingState() {
  recordingGeneration += 1;
  stopPlayback();
  dragMode = null;
  pendingSeekFrame = null;
  seekInProgress = false;
  frameCache.clear();
  pendingFetches.clear();
  currentFrame = 0;
  trimStartFrame = 0;
  trimEndFrame = 0;
  totalFrames = 0;
  duration = 0;
  systemAudioToggle.checked = false;
  systemAudioToggle.disabled = true;
  micAudioToggle.checked = false;
  micAudioToggle.disabled = true;
  systemAudioAvailable = false;
  micAudioAvailable = false;
  systemAudioUserChanged = false;
  micAudioUserChanged = false;
  disposeAudioPreviews();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getTimelineGeometry() {
  return buildTimelineGeometry(
    timeline.clientWidth,
    trimStartVisual.getBoundingClientRect().width,
    trimEndVisual.getBoundingClientRect().width
  );
}

function getTrimHandleLayoutMetrics() {
  return {
    startHandleWidth: trimStartHandle.getBoundingClientRect().width,
    endHandleWidth: trimEndHandle.getBoundingClientRect().width,
  };
}

function getFrameFromPointer(clientX: number): number {
  const rect = timeline.getBoundingClientRect();
  const geometry = getTimelineGeometry();
  return timelineOffsetToFrame(clientX - rect.left, totalFrames, geometry);
}

/** Synchronously moves the playhead and updates UI; renders from cache if possible,
 *  otherwise queues an async fetch. */
function seekToFrame(frameIndex: number) {
  frameIndex = clamp(frameIndex, 0, totalFrames - 1);
  currentFrame = frameIndex;
  syncAudioToFrame(frameIndex);
  updatePlayhead();
  updateTimeDisplay();

  // Try synchronous render from cache first
  const cached = frameCache.get(frameIndex);
  if (cached) {
    ctx.putImageData(cached, 0, 0);
    prefetchFrames(frameIndex);
    return;
  }

  // Cache miss — queue async fetch, but only one in flight at a time
  pendingSeekFrame = frameIndex;
  if (!seekInProgress) {
    processSeek();
  }
}

async function processSeek() {
  seekInProgress = true;
  while (pendingSeekFrame !== null) {
    const target = pendingSeekFrame;
    pendingSeekFrame = null;

    const imageData = await fetchFrame(target);
    // Only paint if still current (guard against newer seeks)
    if (imageData && currentFrame === target) {
      paintFrame(target, imageData);
      prefetchFrames(target);
    }
  }
  seekInProgress = false;
}

// ── Playback engine ───────────────────────────────────────────────────

async function startPlayback() {
  if (isPlaying || isStartingPlayback || totalFrames <= 0) return;
  isStartingPlayback = true;

  const startFrame = resolvePlaybackStartFrame(
    currentFrame,
    trimStartFrame,
    trimEndFrame
  );
  const rendered = await renderFrameAsync(startFrame);

  isStartingPlayback = false;
  if (!rendered) {
    if (currentFrame === startFrame) {
      console.error(`Failed to start playback at frame ${startFrame}`);
    }
    return;
  }

  isPlaying = true;
  playBtn.textContent = "\u23F8";

  prefetchFrames(startFrame);
  startAudioPlayback(startFrame);

  lastFrameTime = performance.now();
  playbackLoop();
}

function stopPlayback() {
  isPlaying = false;
  isStartingPlayback = false;
  pendingPlaybackFrame = null;
  playBtn.textContent = "\u25B6";
  pauseAudioPlayback();
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
        const terminalFrame = getPlaybackTerminalFrame(trimEndFrame);
        renderFrameSync(terminalFrame) || fetchAndRender(terminalFrame);
        stopPlayback();
        return;
      }

      if (renderFrameSync(nextFrame)) {
        lastFrameTime = now - (elapsed % frameDuration);
      } else {
        if (pendingPlaybackFrame !== nextFrame) {
          pendingPlaybackFrame = nextFrame;
          void fetchFrame(nextFrame).then((imageData) => {
            if (pendingPlaybackFrame === nextFrame) {
              pendingPlaybackFrame = null;
            }

            if (!isPlaying || !imageData) {
              if (isPlaying && !imageData) {
                console.error(`Stopping playback because frame ${nextFrame} could not be loaded`);
                stopPlayback();
              }
              return;
            }

            if (renderFrameSync(nextFrame)) {
              lastFrameTime = performance.now();
              prefetchFrames(nextFrame);
            }
          });
        }
        lastFrameTime = now;
      }

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
    void startPlayback();
  }
});

speedSelect.addEventListener("change", () => {
  playbackSpeed = parseFloat(speedSelect.value);
  if (systemAudio) systemAudio.playbackRate = playbackSpeed;
  if (micAudio) micAudio.playbackRate = playbackSpeed;
});

systemAudioToggle.addEventListener("change", () => {
  systemAudioUserChanged = true;
  if (systemAudio) systemAudio.muted = !systemAudioToggle.checked;
});

micAudioToggle.addEventListener("change", () => {
  micAudioUserChanged = true;
  if (micAudio) micAudio.muted = !micAudioToggle.checked;
});

timeline.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  // Ignore clicks that land on trim handles or the trim region (they have their own handlers)
  if (target.classList.contains("trim-handle") || target.id === "trim-region") return;

  e.preventDefault();
  if (isPlaying) stopPlayback();

  dragMode = "scrub";
  seekToFrame(getFrameFromPointer(e.clientX));
});

trimStartHandle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  e.preventDefault();
  if (isPlaying) stopPlayback();
  dragMode = "trim-start";
});

trimEndHandle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  e.preventDefault();
  if (isPlaying) stopPlayback();
  dragMode = "trim-end";
});

trimRegion.addEventListener("mousedown", (e) => {
  e.stopPropagation();
  e.preventDefault();
  if (isPlaying) stopPlayback();

  // Clicking/dragging on the trim region scrubs the playhead
  dragMode = "scrub";
  seekToFrame(getFrameFromPointer(e.clientX));
});

document.addEventListener("mousemove", (e) => {
  if (!dragMode) return;

  switch (dragMode) {
    case "scrub": {
      seekToFrame(getFrameFromPointer(e.clientX));
      break;
    }

    case "trim-start": {
      const frame = getFrameFromPointer(e.clientX);
      trimStartFrame = Math.min(frame, trimEndFrame - 1);
      currentFrame = trimStartFrame;
      updateTrimUI();
      seekToFrame(currentFrame);
      break;
    }

    case "trim-end": {
      const frame = getFrameFromPointer(e.clientX) + 1;
      trimEndFrame = Math.max(frame, trimStartFrame + 1);
      currentFrame = getPlaybackTerminalFrame(trimEndFrame);
      updateTrimUI();
      seekToFrame(currentFrame);
      break;
    }
  }
});

document.addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    dragMode = null;
  }
});

// ── UI updates ────────────────────────────────────────────────────────

function updatePlayhead() {
  if (totalFrames <= 0) return;

  const geometry = getTimelineGeometry();
  const playheadLeft = resolvePlayheadLeft(
    currentFrame,
    totalFrames,
    geometry,
    playhead.getBoundingClientRect().width
  );
  playhead.style.left = `${playheadLeft}px`;
}

function updateTrimUI() {
  if (totalFrames <= 0) return;

  const geometry = getTimelineGeometry();
  const layout = resolveTrimLayout(
    totalFrames,
    trimStartFrame,
    trimEndFrame,
    geometry,
    getTrimHandleLayoutMetrics()
  );

  timelineTrack.style.left = `${geometry.trackLeft}px`;
  timelineTrack.style.width = `${geometry.trackWidth}px`;
  trimStartHandle.style.left = `${layout.startHandleLeft}px`;
  trimEndHandle.style.left = `${layout.endHandleLeft}px`;
  trimRegion.style.left = `${layout.regionLeft}px`;
  trimRegion.style.width = `${layout.regionWidth}px`;
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
  const config = await invoke<{ save_path: string }>("load_config");
  const defaultName = buildDefaultSavePath(
    config.save_path,
    `recording-export.${ext}`
  );

  const outputPath = await save({
    defaultPath: defaultName,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });

  if (!outputPath) return;
  await persistLastUsedSaveDirectory(outputPath);

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
    const prepared = await invoke<{
      config: {
        outputPath: string;
        startFrame: number;
        endFrame: number;
        speed: number;
        format: "mp4" | "gif";
        gifFps: number | null;
        gifMaxWidth: number | null;
        includeSystemAudio: boolean;
        includeMicAudio: boolean;
      };
      selectedFrameCount: number;
    }>("prepare_export_video", {
      config: {
        outputPath,
        startFrame: trimStartFrame,
        endFrame: trimEndFrame,
        speed: playbackSpeed,
        format,
        gifFps: format === "gif" ? 15 : null,
        gifMaxWidth: format === "gif" ? 640 : null,
        includeSystemAudio: format === "mp4" ? shouldIncludeSystemAudio() : false,
        includeMicAudio: format === "mp4" ? shouldIncludeMicAudio() : false,
      },
    });
    await invoke("export_video", {
      config: prepared.config,
    });
  } catch (err) {
    console.error("Export invocation failed:", err);
    exportProgress.style.display = "none";
    exportProgressBar.style.width = "0%";
  }
}

exportMp4Btn.addEventListener("click", () => doExport("mp4"));
exportGifBtn.addEventListener("click", () => doExport("gif"));

function shouldIncludeSystemAudio(): boolean {
  if (!systemAudioAvailable) return false;
  return systemAudioUserChanged ? systemAudioToggle.checked : true;
}

function shouldIncludeMicAudio(): boolean {
  if (!micAudioAvailable) return false;
  return micAudioUserChanged ? micAudioToggle.checked : true;
}

const resizeObserver = new ResizeObserver(() => {
  updateTrimUI();
  updatePlayhead();
});

resizeObserver.observe(timeline);
resizeObserver.observe(trimStartHandle);
resizeObserver.observe(trimEndHandle);
resizeObserver.observe(trimStartVisual);
resizeObserver.observe(trimEndVisual);
resizeObserver.observe(playhead);

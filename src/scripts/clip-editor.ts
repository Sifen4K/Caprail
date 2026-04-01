import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

const video = document.getElementById("video") as HTMLVideoElement;
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

let videoPath = "";
let duration = 0;
let trimStart = 0;
let trimEnd = 0;

// Load video from URL query parameter
const params = new URLSearchParams(window.location.search);
const pathParam = params.get("path");

if (pathParam) {
  videoPath = pathParam;

  // Load video as blob URL (reliable across all Tauri configurations)
  readFile(videoPath)
    .then((data) => {
      const blob = new Blob([data], { type: "video/mp4" });
      video.src = URL.createObjectURL(blob);
    })
    .catch((err) => {
      console.error("Failed to read video file:", err);
    });

  video.addEventListener("loadedmetadata", () => {
    if (video.duration && video.duration > 0 && isFinite(video.duration)) {
      duration = video.duration;
      trimEnd = duration;
      updateTimeDisplay();
      updateTrimUI();
    }
  });

  video.addEventListener("error", () => {
    console.error("Video load error:", video.error);
  });

  // Get duration via ffprobe (reliable, as fallback/override)
  invoke<number>("get_video_duration", { path: videoPath })
    .then((d) => {
      duration = d;
      trimEnd = d;
      updateTimeDisplay();
      updateTrimUI();
    })
    .catch((err) => {
      console.error("ffprobe duration failed:", err);
    });
} else {
  console.error("No video path provided in URL");
}

// Playback controls
playBtn.addEventListener("click", () => {
  if (video.paused) {
    if (video.currentTime < trimStart || video.currentTime >= trimEnd) {
      video.currentTime = trimStart;
    }
    video.play();
    playBtn.textContent = "⏸";
  } else {
    video.pause();
    playBtn.textContent = "▶";
  }
});

video.addEventListener("timeupdate", () => {
  updateTimeDisplay();
  updatePlayhead();

  // Stop at trim end
  if (video.currentTime >= trimEnd) {
    video.pause();
    video.currentTime = trimStart;
    playBtn.textContent = "▶";
  }
});

video.addEventListener("pause", () => {
  playBtn.textContent = "▶";
});

video.addEventListener("play", () => {
  playBtn.textContent = "⏸";
});

speedSelect.addEventListener("change", () => {
  video.playbackRate = parseFloat(speedSelect.value);
});

// Timeline click to seek
timeline.addEventListener("click", (e) => {
  const rect = timeline.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  video.currentTime = ratio * duration;
});

// Trim handles
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
  const time = ratio * duration;

  if (draggingTrim === "start") {
    trimStart = Math.min(time, trimEnd - 0.1);
  } else {
    trimEnd = Math.max(time, trimStart + 0.1);
  }

  updateTrimUI();
  updateTimeDisplay();
});

document.addEventListener("mouseup", () => {
  draggingTrim = null;
});

function updatePlayhead() {
  if (duration > 0) {
    const ratio = video.currentTime / duration;
    playhead.style.left = `${ratio * 100}%`;
  }
}

function updateTrimUI() {
  if (duration <= 0) return;
  const startRatio = trimStart / duration;
  const endRatio = trimEnd / duration;
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
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)} [${formatTime(trimStart)} - ${formatTime(trimEnd)}]`;
}

// Export
async function doExport(format: "mp4" | "gif") {
  const ext = format;
  const defaultName = videoPath.replace(/\.[^.]+$/, `-edited.${ext}`);

  const outputPath = await save({
    defaultPath: defaultName,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });

  if (!outputPath) return;

  exportProgress.style.display = "block";
  exportProgressBar.style.width = "50%";

  try {
    await invoke("export_video", {
      config: {
        inputPath: videoPath,
        outputPath,
        startTime: trimStart,
        endTime: trimEnd,
        speed: parseFloat(speedSelect.value),
        format,
        gifFps: format === "gif" ? 15 : null,
        gifMaxWidth: format === "gif" ? 640 : null,
      },
    });
    exportProgressBar.style.width = "100%";
    setTimeout(() => {
      exportProgress.style.display = "none";
      exportProgressBar.style.width = "0%";
    }, 1500);
  } catch (err) {
    console.error("Export failed:", err);
    exportProgress.style.display = "none";
    exportProgressBar.style.width = "0%";
  }
}

exportMp4Btn.addEventListener("click", () => doExport("mp4"));
exportGifBtn.addEventListener("click", () => doExport("gif"));

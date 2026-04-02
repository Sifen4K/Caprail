import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

const durationEl = document.getElementById("duration")!;
const pauseBtn = document.getElementById("pause-btn")!;
const stopBtn = document.getElementById("stop-btn")!;
const recDot = document.getElementById("rec-dot")!;
const win = getCurrentWindow();

let isPaused = false;
let statusInterval: ReturnType<typeof setInterval>;

// Drag to move
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

document.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).tagName === "BUTTON") return;
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

document.addEventListener("mousemove", async (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;

  const pos = await win.outerPosition();
  const { LogicalPosition } = await import("@tauri-apps/api/dpi");
  await win.setPosition(new LogicalPosition(pos.x + dx, pos.y + dy));
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function updateStatus() {
  try {
    const status = await invoke<{
      is_recording: boolean;
      is_paused: boolean;
      duration_secs: number;
      frame_count: number;
      fps: number;
    }>("get_recording_status");

    durationEl.textContent = formatDuration(status.duration_secs);

    if (!status.is_recording) {
      clearInterval(statusInterval);
      await win.close();
    }
  } catch {
    // ignore
  }
}

pauseBtn.addEventListener("click", async () => {
  if (isPaused) {
    await invoke("resume_recording");
    isPaused = false;
    pauseBtn.textContent = "⏸";
    recDot.classList.remove("paused");
  } else {
    await invoke("pause_recording");
    isPaused = true;
    pauseBtn.textContent = "▶";
    recDot.classList.add("paused");
  }
});

stopBtn.addEventListener("click", async () => {
  clearInterval(statusInterval);
  try {
    await invoke("stop_recording");
    await emit("recording-stopped", {});
  } catch (err) {
    console.error("Stop recording failed:", err);
  }
  await win.close();
});

// Start polling status
statusInterval = setInterval(updateStatus, 500);
updateStatus();

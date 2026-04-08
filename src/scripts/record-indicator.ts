import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

// Make this window click-through at the OS level.
// CSS pointer-events:none only affects the HTML layer; without this call
// the OS window still captures all mouse events.
win.setIgnoreCursorEvents(true).catch((err) => {
  console.error("Failed to set ignore cursor events:", err);
});

// Close this indicator window when recording stops
listen("recording-stopped", async () => {
  await win.close();
});

listen("recording-cancelled", async () => {
  await win.close();
});

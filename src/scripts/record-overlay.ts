import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { loadLocale, t } from "./i18n.ts";

const canvas = document.getElementById("overlay") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let isSelecting = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

async function resize() {
  const sz = await getCurrentWindow().innerSize();
  canvas.width = sz.width;
  canvas.height = sz.height;
  draw();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (isSelecting) {
    const rect = {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      w: Math.abs(currentX - startX),
      h: Math.abs(currentY - startY),
    };
    if (rect.w > 2 && rect.h > 2) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "#f44336";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      const label = `${rect.w} x ${rect.h}`;
      ctx.font = "13px monospace";
      const metrics = ctx.measureText(label);
      const labelX = rect.x + rect.w / 2 - metrics.width / 2;
      const labelY = rect.y > 25 ? rect.y - 8 : rect.y + rect.h + 18;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(labelX - 4, labelY - 14, metrics.width + 8, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, labelX, labelY);
    }
  } else {
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(t("recordOverlay.selectArea"), canvas.width / 2, canvas.height / 2);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#aaa";
    ctx.fillText(t("recordOverlay.pressEscCancel"), canvas.width / 2, canvas.height / 2 + 30);
    ctx.textAlign = "start";
  }

  // Crosshair
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, currentY);
  ctx.lineTo(canvas.width, currentY);
  ctx.moveTo(currentX, 0);
  ctx.lineTo(currentX, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

canvas.addEventListener("mousedown", (e) => {
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  currentX = e.clientX;
  currentY = e.clientY;
});

canvas.addEventListener("mousemove", (e) => {
  currentX = e.clientX;
  currentY = e.clientY;
  draw();
});

canvas.addEventListener("mouseup", async () => {
  if (!isSelecting) return;
  isSelecting = false;

  const rect = {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    w: Math.abs(currentX - startX),
    h: Math.abs(currentY - startY),
  };

  if (rect.w > 10 && rect.h > 10) {
    // Emit recording area selected
    await emit("recording-area-selected", {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
    });
  } else {
    await emit("recording-cancelled", {});
  }

  const win = getCurrentWindow();
  await win.close();
});

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    await emit("recording-cancelled", {});
    const win = getCurrentWindow();
    await win.close();
  }
});

window.addEventListener("load", resize);
loadLocale(new URLSearchParams(document.location.search).get("lang") || "en");

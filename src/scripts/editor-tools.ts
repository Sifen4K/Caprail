import type { Annotation, EditorState } from "./editor-types";

export function drawAnnotation(state: EditorState, ann: Annotation) {
  const { ctx } = state;
  ctx.save();
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = ann.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (ann.type) {
    case "rect":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null) {
        ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "ellipse":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null) {
        ctx.beginPath();
        ctx.ellipse(
          ann.x + ann.w / 2,
          ann.y + ann.h / 2,
          Math.abs(ann.w / 2),
          Math.abs(ann.h / 2),
          0, 0, Math.PI * 2
        );
        ctx.stroke();
      }
      break;

    case "arrow":
      if (ann.x1 != null && ann.y1 != null && ann.x2 != null && ann.y2 != null) {
        drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.lineWidth);
      }
      break;

    case "pen":
      if (ann.points && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.stroke();
      }
      break;

    case "text":
      if (ann.text && ann.x != null && ann.y != null) {
        ctx.font = `${ann.fontSize || 16}px sans-serif`;
        ctx.fillText(ann.text, ann.x, ann.y);
      }
      break;

    case "mosaic":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null && state.baseImageData) {
        applyMosaic(state, ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "blur":
      if (ann.x != null && ann.y != null && ann.w != null && ann.h != null && state.baseImageData) {
        applyBlur(state, ann.x, ann.y, ann.w, ann.h);
      }
      break;

    case "stamp":
      if (ann.x != null && ann.y != null) {
        drawStamp(ctx, ann);
      }
      break;
  }

  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  lineWidth: number
) {
  const headLen = Math.max(10, lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function applyMosaic(state: EditorState, x: number, y: number, w: number, h: number) {
  if (!state.baseCanvas) return;
  const { ctx } = state;
  const blockSize = 10;
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const ex = Math.min(state.baseCanvas.width, Math.round(x + w));
  const ey = Math.min(state.baseCanvas.height, Math.round(y + h));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw <= 0 || sh <= 0) return;

  const reducedW = Math.max(1, Math.ceil(sw / blockSize));
  const reducedH = Math.max(1, Math.ceil(sh / blockSize));

  // Scale down from base image (averages pixels)
  const small = document.createElement("canvas");
  small.width = reducedW;
  small.height = reducedH;
  const sCtx = small.getContext("2d")!;
  sCtx.drawImage(state.baseCanvas, sx, sy, sw, sh, 0, 0, reducedW, reducedH);

  // Scale back up with nearest-neighbor interpolation
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, reducedW, reducedH, sx, sy, sw, sh);
  ctx.imageSmoothingEnabled = true;
}

function applyBlur(state: EditorState, x: number, y: number, w: number, h: number) {
  if (!state.baseImageData) return;
  const { ctx, canvas } = state;
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.min(Math.round(w), state.baseImageData.width - sx);
  const sh = Math.min(Math.round(h), state.baseImageData.height - sy);
  if (sw <= 0 || sh <= 0) return;

  ctx.save();
  ctx.filter = "blur(8px)";
  ctx.drawImage(canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, ann: Annotation) {
  const x = ann.x!;
  const y = ann.y!;
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  switch (ann.stampType) {
    case "counter": {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = ann.color;
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(ann.stampIndex || 1), x, y + 1);
      break;
    }
    case "check":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("✓", x, y);
      break;
    case "cross":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("✗", x, y);
      break;
    case "star":
      ctx.fillStyle = ann.color;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText("★", x, y);
      break;
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

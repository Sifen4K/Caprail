import type { EditorState } from "./editor-types";

const MIN_ZOOM = 0.1; // 10%
const MAX_ZOOM = 5;   // 500%
const ZOOM_STEP = 0.1; // 10% per wheel tick

/**
 * Apply zoom transform to the canvas
 * Canvas uses transform-origin: 0 0 (top-left)
 */
export function applyZoomTransform(state: EditorState) {
  const canvas = state.canvas;
  canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
}

/**
 * Handle mouse wheel zoom
 * Zooms centered at the mouse position
 *
 * Simple formula:
 * - Mouse position relative to wrapper: M = mouseX - wrapperLeft
 * - Canvas pixel under mouse (CSS): P = (M - panX) / zoom
 * - After zoom, that pixel should still be under mouse:
 *   newPanX = M - P * newZoom = M - (M - panX) * newZoom / zoom
 */
export function handleWheel(state: EditorState, e: WheelEvent) {
  e.preventDefault();

  // Calculate new zoom level
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom + delta));

  if (newZoom === state.zoom) return; // No change

  const wrapper = document.getElementById("canvas-wrapper");
  if (!wrapper) return;
  const wrapperRect = wrapper.getBoundingClientRect();

  // Mouse position relative to wrapper (CSS pixels)
  const M_X = e.clientX - wrapperRect.left;
  const M_Y = e.clientY - wrapperRect.top;

  // New pan to keep the canvas pixel under mouse
  // newPan = M - (M - pan) * newZoom / oldZoom
  const scale = newZoom / state.zoom;
  state.panX = M_X - (M_X - state.panX) * scale;
  state.panY = M_Y - (M_Y - state.panY) * scale;

  state.zoom = newZoom;

  applyZoomTransform(state);
}

/**
 * Start pan operation
 */
export function startPan(state: EditorState, _e: PointerEvent) {
  state.isPanning = true;
  state.canvas.style.cursor = "grabbing";
}

/**
 * End pan operation
 */
export function endPan(state: EditorState) {
  state.isPanning = false;
  state.canvas.style.cursor = "crosshair";
}

/**
 * Convert viewport coordinates to canvas physical pixel coordinates
 * accounting for zoom and pan
 */
export function getCanvasPosWithZoom(state: EditorState, e: MouseEvent): { x: number; y: number } {
  const canvas = state.canvas;

  // Use canvas's getBoundingClientRect which reflects the transformed position
  const canvasRect = canvas.getBoundingClientRect();

  // Mouse position relative to the canvas's visual position
  const mouseCanvasX = e.clientX - canvasRect.left;
  const mouseCanvasY = e.clientY - canvasRect.top;

  // Convert to physical pixel coordinates
  // canvasRect.width/height are the visual (CSS) dimensions after zoom
  // canvas.width/height are the physical pixel dimensions
  const scaleX = canvas.width / canvasRect.width;
  const scaleY = canvas.height / canvasRect.height;

  return {
    x: mouseCanvasX * scaleX,
    y: mouseCanvasY * scaleY,
  };
}
export type ToolType = "rect" | "ellipse" | "arrow" | "pen" | "text" | "mosaic" | "blur" | "stamp";
export type StampType = "counter" | "check" | "cross" | "star";

export interface Annotation {
  type: ToolType;
  color: string;
  lineWidth: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  text?: string;
  fontSize?: number;
  stampType?: StampType;
  stampIndex?: number;
}

export interface EditorState {
  currentTool: ToolType;
  currentColor: string;
  currentLineWidth: number;
  currentFontSize: number;
  currentStamp: StampType;
  stampCounter: number;
  annotations: Annotation[];
  redoStack: Annotation[];
  isDrawing: boolean;
  currentAnnotation: Annotation | null;
  baseImageData: ImageData | null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bufferCanvas: HTMLCanvasElement | null;
  bufferCtx: CanvasRenderingContext2D | null;
  baseCanvas: HTMLCanvasElement | null;
  dpiScale: number; // Physical pixels per CSS pixel
  // Zoom state
  zoom: number; // Scale factor (1 = 100%)
  panX: number; // Pan offset in CSS pixels
  panY: number;
  isPanning: boolean;
}

/**
 * resolution-context.test.ts
 *
 * Unit tests for ResolutionContext.
 *
 * Tauri APIs (availableMonitors, getCurrentWindow) are mocked so these tests
 * run in plain Node/jsdom without a real Tauri process.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Monitor } from "@tauri-apps/api/window";
import type { PhysicalPixel } from "./resolution-context";

// ─── Tauri API mocks ────────────────────────────────────────────────────────
//
// vi.mock is hoisted by vitest, so the factory cannot reference variables
// defined with const/let in module scope. We use vi.hoisted() to create the
// mock functions BEFORE the hoisting boundary.

const { mockAvailableMonitors, mockInnerSize, mockInnerPosition } = vi.hoisted(() => ({
  mockAvailableMonitors: vi.fn<() => Promise<Monitor[]>>(),
  mockInnerSize: vi.fn<() => Promise<{ width: number; height: number }>>(),
  mockInnerPosition: vi.fn<() => Promise<{ x: number; y: number }>>(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: mockAvailableMonitors,
  getCurrentWindow: () => ({
    innerSize: mockInnerSize,
    innerPosition: mockInnerPosition,
  }),
}));

// Import AFTER mocking
import { ResolutionContext } from "./resolution-context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMonitor(overrides: {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}): Monitor {
  return {
    name: "Test Monitor",
    scaleFactor: overrides.scaleFactor,
    position: { x: overrides.x, y: overrides.y } as { x: number; y: number } & { _type?: string },
    size: { width: overrides.width, height: overrides.height } as { width: number; height: number } & { _type?: string },
    workArea: {
      position: { x: overrides.x, y: overrides.y } as { x: number; y: number } & { _type?: string },
      size: { width: overrides.width, height: overrides.height } as { width: number; height: number } & { _type?: string },
    },
  } as unknown as Monitor;
}

function setupMocks(
  monitors: ReturnType<typeof makeMonitor>[],
  windowPos = { x: 0, y: 0 },
  windowSize = { width: 1920, height: 1080 }
) {
  mockAvailableMonitors.mockResolvedValue(monitors);
  mockInnerPosition.mockResolvedValue(windowPos);
  mockInnerSize.mockResolvedValue(windowSize);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ResolutionContext – single monitor (100% DPI)", () => {
  let ctx: ResolutionContext;

  beforeEach(async () => {
    setupMocks(
      [makeMonitor({ x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 })],
      { x: 100, y: 100 },
      { width: 1920, height: 1080 }
    );
    ctx = new ResolutionContext();
    await ctx.init();
  });

  it("exposes the monitor after init()", () => {
    expect(ctx.monitors).toHaveLength(1);
    expect(ctx.monitors[0].width).toBe(1920);
    expect(ctx.monitors[0].scaleFactor).toBe(1);
  });

  it("returns correct windowOrigin", () => {
    expect(ctx.windowOrigin.x).toBe(100);
    expect(ctx.windowOrigin.y).toBe(100);
  });

  it("getVirtualDesktopBounds() returns the single monitor area", () => {
    const bounds = ctx.getVirtualDesktopBounds();
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBe(1920);
    expect(bounds.h).toBe(1080);
  });

  it("getScaleFactorAtPhysical returns 1 inside the monitor", () => {
    expect(ctx.getScaleFactorAtPhysical(500 as PhysicalPixel, 300 as PhysicalPixel)).toBe(1);
  });

  it("getScaleFactorAtPhysical returns 1.0 (fallback) outside all monitors", () => {
    expect(ctx.getScaleFactorAtPhysical(9999 as PhysicalPixel, 9999 as PhysicalPixel)).toBe(1.0);
  });

  it("canvasToDesktopPhysical adds window origin", () => {
    const pt = ctx.canvasToDesktopPhysical(50 as PhysicalPixel, 80 as PhysicalPixel);
    // windowOrigin is { x:100, y:100 }
    expect(pt.x).toBe(150);
    expect(pt.y).toBe(180);
  });

  it("desktopPhysicalToCanvas subtracts window origin", () => {
    const pt = ctx.desktopPhysicalToCanvas(150 as PhysicalPixel, 180 as PhysicalPixel);
    expect(pt.x).toBe(50);
    expect(pt.y).toBe(80);
  });
});

describe("ResolutionContext – two monitors, mixed DPI", () => {
  // Primary: 1920×1080 @100%  origin (0,0)
  // Secondary: 2560×1440 @150%  origin (1920,0)
  let ctx: ResolutionContext;

  beforeEach(async () => {
    setupMocks([
      makeMonitor({ x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 }),
      makeMonitor({ x: 1920, y: 0, width: 2560, height: 1440, scaleFactor: 1.5 }),
    ]);
    ctx = new ResolutionContext();
    await ctx.init();
  });

  it("physical bounds span both monitors", () => {
    const physical = ctx.getVirtualDesktopBounds();
    expect(physical.x).toBe(0);
    expect(physical.w).toBe(1920 + 2560); // 4480
    expect(physical.h).toBe(1440);         // max of two monitors
  });

  it("getScaleFactorAtPhysical returns 1.5 for secondary monitor", () => {
    const sf = ctx.getScaleFactorAtPhysical(2000 as PhysicalPixel, 300 as PhysicalPixel);
    expect(sf).toBe(1.5);
  });

  it("getScaleFactorAtPhysical returns 1 for primary monitor", () => {
    const sf = ctx.getScaleFactorAtPhysical(500 as PhysicalPixel, 300 as PhysicalPixel);
    expect(sf).toBe(1);
  });

  it("getMonitorAtPhysicalPoint returns the correct monitor", () => {
    const mon = ctx.getMonitorAtPhysicalPoint(500 as PhysicalPixel, 200 as PhysicalPixel);
    expect(mon).not.toBeNull();
    expect(mon?.x).toBe(0); // primary (x=0)

    const mon2 = ctx.getMonitorAtPhysicalPoint(2000 as PhysicalPixel, 200 as PhysicalPixel);
    expect(mon2).not.toBeNull();
    expect(mon2?.x).toBe(1920); // secondary
  });

  it("getMonitorAtPhysicalPoint returns null for a point outside all monitors", () => {
    expect(ctx.getMonitorAtPhysicalPoint(99999 as PhysicalPixel, 0 as PhysicalPixel)).toBeNull();
  });
});

describe("ResolutionContext – negative origin (secondary monitor left of primary)", () => {
  let ctx: ResolutionContext;

  beforeEach(async () => {
    // Secondary monitor at x=-2560, primary at x=0
    setupMocks([
      makeMonitor({ x: -2560, y: 0, width: 2560, height: 1440, scaleFactor: 1.5 }),
      makeMonitor({ x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 }),
    ]);
    ctx = new ResolutionContext();
    await ctx.init();
  });

  it("physical bounds.x is negative", () => {
    const physical = ctx.getVirtualDesktopBounds();
    expect(physical.x).toBe(-2560);
    expect(physical.w).toBe(2560 + 1920);
  });
});

describe("ResolutionContext – fallback when no monitors loaded", () => {
  it("getVirtualDesktopBounds returns 1920x1080 default", () => {
    const ctx = new ResolutionContext();
    // no init()
    const bounds = ctx.getVirtualDesktopBounds();
    expect(bounds.w).toBe(1920);
    expect(bounds.h).toBe(1080);
  });

  it("windowOrigin is (0, 0) when no window info", () => {
    const ctx = new ResolutionContext();
    expect(ctx.windowOrigin.x).toBe(0);
    expect(ctx.windowOrigin.y).toBe(0);
  });
});

describe("ResolutionContext – onChange listener", () => {
  it("calls listener after refresh()", async () => {
    setupMocks(
      [makeMonitor({ x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 })],
    );
    const ctx = new ResolutionContext();
    const listener = vi.fn();
    ctx.onChange(listener);
    await ctx.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops future calls", async () => {
    setupMocks(
      [makeMonitor({ x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 })],
    );
    const ctx = new ResolutionContext();
    const listener = vi.fn();
    const unsub = ctx.onChange(listener);
    await ctx.refresh();
    unsub();
    await ctx.refresh();
    expect(listener).toHaveBeenCalledTimes(1); // only the first refresh
  });
});

describe("ResolutionContext – canvas coordinate round-trips", () => {
  let ctx: ResolutionContext;

  beforeEach(async () => {
    setupMocks(
      [makeMonitor({ x: 0, y: 0, width: 3840, height: 2160, scaleFactor: 2 })],
      { x: 200, y: 150 },
      { width: 3840, height: 2160 }
    );
    ctx = new ResolutionContext();
    await ctx.init();
  });

  it("canvasToDesktopPhysical(0,0) equals windowOrigin", () => {
    const pt = ctx.canvasToDesktopPhysical(0 as PhysicalPixel, 0 as PhysicalPixel);
    expect(pt.x).toBe(ctx.windowOrigin.x);
    expect(pt.y).toBe(ctx.windowOrigin.y);
  });

  it("round-trip: canvas → desktop → canvas is identity", () => {
    const cx = 400 as PhysicalPixel;
    const cy = 300 as PhysicalPixel;
    const desktop = ctx.canvasToDesktopPhysical(cx, cy);
    const back = ctx.desktopPhysicalToCanvas(desktop.x, desktop.y);
    expect(back.x).toBe(cx);
    expect(back.y).toBe(cy);
  });

  it("virtual desktop bounds stay in physical pixels on a 4K 200% monitor", () => {
    const bounds = ctx.getVirtualDesktopBounds();
    expect(bounds.w).toBe(3840);
    expect(bounds.h).toBe(2160);
  });
});

/**
 * resolution-context.ts
 *
 * Centralised physical-resolution module.
 *
 * Design goals
 * ────────────
 * • Single source of truth for monitor info and window geometry.
 * • Brand-typed physical pixel values so the compiler catches unit confusion
 *   at the call-site.
 * • Zero runtime overhead – brand types compile away to plain number.
 * • No automatic polling; callers drive refresh() at meaningful events
 *   (window resize, monitor change, etc.).
 *
 * Tauri API notes (all physical)
 * ──────────────────────────────
 * • availableMonitors()      → Monitor.position / .size  are PHYSICAL
 * • getCurrentWindow().innerSize()     → PhysicalSize   (PHYSICAL)
 * • getCurrentWindow().innerPosition() → PhysicalPosition (PHYSICAL)
 * • WebviewWindow constructor params are still logical, so callers should
 *   create windows with placeholder values and immediately apply physical
 *   geometry via `setPosition(new PhysicalPosition(...))` / `setSize(...)`.
 */

import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import type { Monitor } from "@tauri-apps/api/window";

// ─── Brand types ────────────────────────────────────────────────────────────

/** A measurement in physical (device) pixels. Runtime value is a plain number. */
export type PhysicalPixel = number & { readonly __brand: "physical" };

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface MonitorInfo {
  /** Physical x position on the virtual desktop (can be negative). */
  x: PhysicalPixel;
  /** Physical y position on the virtual desktop (can be negative). */
  y: PhysicalPixel;
  /** Physical width of the monitor. */
  width: PhysicalPixel;
  /** Physical height of the monitor. */
  height: PhysicalPixel;
  /** Scale factor (e.g. 1.5 for 150% DPI). */
  scaleFactor: number;
  /** Raw Tauri Monitor object (preserved for compatibility). */
  raw: Monitor;
}

export interface PhysicalPoint {
  x: PhysicalPixel;
  y: PhysicalPixel;
}

export interface PhysicalRect {
  x: PhysicalPixel;
  y: PhysicalPixel;
  w: PhysicalPixel;
  h: PhysicalPixel;
}

// ─── ResolutionContext ───────────────────────────────────────────────────────

type ChangeListener = () => void;

export class ResolutionContext {
  private _monitors: MonitorInfo[] = [];
  private _windowPhysicalInfo: { x: PhysicalPixel; y: PhysicalPixel; width: PhysicalPixel; height: PhysicalPixel } | null = null;
  private _listeners: ChangeListener[] = [];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialise the context. Call once at startup.
   * Equivalent to refresh() but communicates intent to callers.
   */
  async init(): Promise<void> {
    await this.refresh();
  }

  /**
   * Re-query Tauri for current monitor geometry and window position.
   * Call this whenever the window is resized or monitors change.
   */
  async refresh(): Promise<void> {
    const rawMonitors = await availableMonitors();
    this._monitors = rawMonitors.map((m) => ({
      x: m.position.x as PhysicalPixel,
      y: m.position.y as PhysicalPixel,
      width: m.size.width as PhysicalPixel,
      height: m.size.height as PhysicalPixel,
      scaleFactor: m.scaleFactor,
      raw: m,
    }));

    try {
      const [sz, pos] = await Promise.all([
        getCurrentWindow().innerSize(),
        getCurrentWindow().innerPosition(),
      ]);
      this._windowPhysicalInfo = {
        x: pos.x as PhysicalPixel,
        y: pos.y as PhysicalPixel,
        width: sz.width as PhysicalPixel,
        height: sz.height as PhysicalPixel,
      };
    } catch {
      // May fail in contexts without a window (e.g. unit tests)
      this._windowPhysicalInfo = null;
    }

    this._notifyListeners();
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** Snapshot of all monitors at the last refresh(). */
  get monitors(): readonly MonitorInfo[] {
    return this._monitors;
  }

  /**
   * Physical geometry of the current window's client area at the last refresh().
   * Returns null if refresh() has not been called or if no window is available.
   */
  get windowPhysicalInfo(): Readonly<{ x: PhysicalPixel; y: PhysicalPixel; width: PhysicalPixel; height: PhysicalPixel }> | null {
    return this._windowPhysicalInfo;
  }

  /**
   * Physical origin (top-left corner) of the current window's client area.
   * Returns { x: 0, y: 0 } as PhysicalPixels if windowPhysicalInfo is null.
   */
  get windowOrigin(): PhysicalPoint {
    const info = this._windowPhysicalInfo;
    if (!info) {
      return { x: 0 as PhysicalPixel, y: 0 as PhysicalPixel };
    }
    return { x: info.x, y: info.y };
  }

  // ── Virtual desktop bounds ─────────────────────────────────────────────────

  /**
   * Compute the physical bounding rectangle that contains all monitors.
   * Falls back to 1920×1080 at origin if no monitors have been loaded yet.
   */
  getVirtualDesktopBounds(): PhysicalRect {
    if (this._monitors.length === 0) {
      return { x: 0 as PhysicalPixel, y: 0 as PhysicalPixel, w: 1920 as PhysicalPixel, h: 1080 as PhysicalPixel };
    }

    let physMinX = Infinity, physMinY = Infinity;
    let physMaxX = -Infinity, physMaxY = -Infinity;

    for (const m of this._monitors) {
      physMinX = Math.min(physMinX, m.x);
      physMinY = Math.min(physMinY, m.y);
      physMaxX = Math.max(physMaxX, m.x + m.width);
      physMaxY = Math.max(physMaxY, m.y + m.height);
    }

    return {
      x: physMinX as PhysicalPixel,
      y: physMinY as PhysicalPixel,
      w: (physMaxX - physMinX) as PhysicalPixel,
      h: (physMaxY - physMinY) as PhysicalPixel,
    };
  }

  // ── Monitor lookup ────────────────────────────────────────────────────────

  /**
   * Find which monitor contains the given physical desktop point.
   * Returns null if the point lies outside all known monitors.
   */
  getMonitorAtPhysicalPoint(physX: PhysicalPixel, physY: PhysicalPixel): MonitorInfo | null {
    for (const m of this._monitors) {
      if (
        physX >= m.x &&
        physX < m.x + m.width &&
        physY >= m.y &&
        physY < m.y + m.height
      ) {
        return m;
      }
    }
    return null;
  }

  /**
   * Get the scale factor for a physical desktop point.
   * Falls back to 1.0 if the point is outside all known monitors.
   */
  getScaleFactorAtPhysical(physX: PhysicalPixel, physY: PhysicalPixel): number {
    return this.getMonitorAtPhysicalPoint(physX, physY)?.scaleFactor ?? 1.0;
  }

  // ── Canvas ↔ Desktop coordinate conversion ────────────────────────────────

  /**
   * Convert a canvas-relative physical point to a desktop physical point.
   *
   * Canvas coordinates: origin = window client-area top-left, physical pixels.
   * Desktop coordinates: virtual desktop space (can have negative x/y).
   *
   * canvasToDesktopPhysical(0, 0) === windowOrigin
   */
  canvasToDesktopPhysical(canvasX: PhysicalPixel, canvasY: PhysicalPixel): PhysicalPoint {
    const origin = this.windowOrigin;
    return {
      x: (origin.x + canvasX) as PhysicalPixel,
      y: (origin.y + canvasY) as PhysicalPixel,
    };
  }

  /**
   * Convert a desktop physical point to a canvas-relative physical point.
   *
   * desktopPhysicalToCanvas(windowOrigin) === { x: 0, y: 0 }
   */
  desktopPhysicalToCanvas(desktopX: PhysicalPixel, desktopY: PhysicalPixel): PhysicalPoint {
    const origin = this.windowOrigin;
    return {
      x: (desktopX - origin.x) as PhysicalPixel,
      y: (desktopY - origin.y) as PhysicalPixel,
    };
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  /**
   * Register a listener that is called after each refresh().
   * Returns an unsubscribe function.
   */
  onChange(listener: ChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  private _notifyListeners(): void {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error("ResolutionContext onChange listener threw:", e);
      }
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/** Shared singleton. Import this rather than constructing your own instance. */
export const resolution = new ResolutionContext();

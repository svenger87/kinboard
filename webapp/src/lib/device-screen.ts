/**
 * A screen's size, as it reports it on its check-in (devices.screen,
 * migrations/085_device_screen.sql).
 *
 *   viewportWidth/Height  the page's CSS pixels: what a layout is drawn in
 *   screenWidth/Height    the display's own pixels
 *   pixelRatio            the browser's scaling: 1.5 for Windows at 150%
 */
export interface DeviceScreen {
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  reportedAt?: string;
}

const PIXELS = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20000;

/** The body a screen sends, checked: whole pixels in a sane range and a ratio between 0.25 and 8. */
export function parseDeviceScreen(body: unknown): { ok: true; screen: DeviceScreen } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  for (const k of ["viewportWidth", "viewportHeight", "screenWidth", "screenHeight"] as const) {
    if (!PIXELS(b[k])) return { ok: false, error: `${k} must be a whole number of pixels, 1 to 20000` };
  }
  const ratio = b.pixelRatio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0.25 || ratio > 8) {
    return { ok: false, error: "pixelRatio must be a number from 0.25 to 8" };
  }
  return {
    ok: true,
    screen: {
      viewportWidth: b.viewportWidth as number,
      viewportHeight: b.viewportHeight as number,
      screenWidth: b.screenWidth as number,
      screenHeight: b.screenHeight as number,
      pixelRatio: Math.round(ratio * 100) / 100,
    },
  };
}

/**
 * This browser's size now. The display's pixels are the CSS screen size times
 * the ratio, rounded: Windows reports a 1080x1920 panel at 150% as 720x1280.
 */
export function readDeviceScreen(win: Pick<Window, "innerWidth" | "innerHeight" | "devicePixelRatio" | "screen">): DeviceScreen {
  const ratio = win.devicePixelRatio || 1;
  return {
    viewportWidth: Math.round(win.innerWidth),
    viewportHeight: Math.round(win.innerHeight),
    screenWidth: Math.round(win.screen.width * ratio),
    screenHeight: Math.round(win.screen.height * ratio),
    pixelRatio: Math.round(ratio * 100) / 100,
  };
}

/** Whether two reports describe the same size; the time is not part of it. */
export function sameDeviceScreen(a: DeviceScreen | null | undefined, b: DeviceScreen | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.screenWidth === b.screenWidth &&
    a.screenHeight === b.screenHeight &&
    a.pixelRatio === b.pixelRatio
  );
}

import type { LayoutItem } from "@/lib/layouts/types";

/**
 * Whether the screensaver may cover the screen right now. It is right about
 * idleness and wrong about what idleness means while something needs a
 * person: a ringing timer, a message being said to the house, a camera put
 * on the wall because the doorbell rang (#335), or an
 * assistant waiting for someone to allow a door or an alarm (RFC-011 §4.3),
 * or the outcome of one somebody allowed and has not read yet —
 * each of those arrives precisely when nobody is standing at the board, and
 * underneath a photo slideshow it would be missed.
 */
/**
 * Asks the screensaver to show itself right now (Settings -> Screensaver
 * -> Preview, and the layout editor's Preview). A window event, in the style
 * of the app's other same-tab signals ("kinboard:text-scale-change" and
 * friends): the page dispatches it, the ScreensaverProvider listens. The
 * preview ends at the next touch or keypress, like waking for real.
 */
export const SCREENSAVER_PREVIEW_EVENT = "kinboard:preview-screensaver";

/**
 * A layout to preview instead of the one this screen was given: the editor's
 * current arrangement, saved or not, for the screen size it was made for. It
 * is fitted to this screen as an assigned layout would be.
 */
export interface PreviewLayout {
  width: number;
  height: number;
  items: LayoutItem[];
}

/** Show the screensaver now: as set up for this screen, or with `layout`. */
export function previewScreensaver(layout?: PreviewLayout): void {
  window.dispatchEvent(new CustomEvent<PreviewLayout | null>(SCREENSAVER_PREVIEW_EVENT, { detail: layout ?? null }));
}

/** The layout a preview event carries, if it carries one. */
export function previewLayoutOf(e: Event): PreviewLayout | null {
  const detail = (e as CustomEvent<unknown>).detail as Partial<PreviewLayout> | null | undefined;
  if (!detail || typeof detail.width !== "number" || typeof detail.height !== "number" || !Array.isArray(detail.items)) return null;
  return { width: detail.width, height: detail.height, items: detail.items };
}

export function screensaverAllowed(state: {
  isIdle: boolean;
  skipPath: boolean;
  handheld: boolean;
  ringingTimer: boolean;
  takeoverMessage: boolean;
  pendingAssistantActions: number;
  /** Outcomes and errors of assistant requests still on screen, unread. */
  assistantActionNotices?: number;
  /** A camera `show_camera` put on this screen and showing: not closed here, and the camera still set up. */
  cameraTakeover?: boolean;
}): boolean {
  return state.isIdle
    && !state.skipPath
    && !state.handheld
    && !state.ringingTimer
    && !state.takeoverMessage
    && state.pendingAssistantActions === 0
    && (state.assistantActionNotices ?? 0) === 0
    && !state.cameraTakeover;
}

/**
 * Whether a touch, click or key wakes the screen from the screensaver (and
 * ends a preview): not while a modal is open (data-modal-open on body), and
 * not from an element marked data-no-wake or inside one — a news item opens
 * the news window, a creature hops, the weather effects stay out of the way.
 * The idle timer and the preview share this, so a preview behaves like the
 * real screensaver.
 */
export function wakesScreen(e: Event): boolean {
  if (typeof document !== "undefined" && document.body?.hasAttribute("data-modal-open")) return false;
  const target = e.target as Element | null;
  return !target?.closest?.("[data-no-wake]");
}

/**
 * The area a designed Home's grid gets: the screen less the navigation bar
 * at the bottom, which is not placeable (RFC-022 §3.5). One definition for
 * the editor, the server's check and the screen that draws the layout, so a
 * box the editor allowed is never refused on save or drawn under the bar.
 * The screen does not measure the bar: it uses these numbers too.
 */

/**
 * The navigation bar's real height at a screen width, in CSS pixels:
 * - below 768px, MobileNav: exactly --mobile-nav-height (2.8125rem, 45px;
 *   a phone's safe area comes on top, but a grid needs 600px and up);
 * - from 768px, DesktopNav: a 1px top border, 12px padding above and below
 *   and a 44px row of buttons (69px), which grow to 48px from 1024px (73px).
 * Note these are the bars as drawn, a pixel more than --nav-spacing at 768px
 * and up (the border), so a box never ends under the bar.
 */
export function navHeightAt(width: number): number {
  return width < 768 ? 45 : width < 1024 ? 69 : 73;
}

/** The size Home's grid is drawn at on a screen of this size. */
export function homeArea(width: number, height: number): { width: number; height: number } {
  return { width, height: Math.max(0, height - navHeightAt(width)) };
}

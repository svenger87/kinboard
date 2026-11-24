/**
 * The area a designed Home's grid gets: the screen less the navigation bar
 * at the bottom, which is not placeable (RFC-022 §3.5). One number for the
 * editor, the server's check and the screen that draws the layout, so a box
 * the editor allowed is never refused on save or drawn under the bar.
 *
 * The bar on a wall screen (desktop-nav.tsx at lg): a 48px row of buttons,
 * 12px padding above and below, and a 1px top border. Narrower screens draw
 * it 4px shorter; the grid then has those pixels to spare at the bottom edge.
 */
export const HOME_NAV_BAR = 73;

/** The size Home's grid is drawn at on a screen of this size. */
export function homeArea(width: number, height: number): { width: number; height: number } {
  return { width, height: Math.max(0, height - HOME_NAV_BAR) };
}

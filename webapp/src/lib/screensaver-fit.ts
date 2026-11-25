/**
 * How many entries of each list the built-in screensaver shows when its
 * column is shorter than the lists (#282).
 *
 * The events, birthdays and the children's lessons share one column, between
 * the weather and the bottom edge (landscape) or the top edge and the clock
 * (portrait). It used to grow upwards for as long as it had entries, so on a
 * 1280x800 tablet five events ran into the forecast. Now the column has a
 * height, and when the lists do not fit, entries give way one at a time, in
 * this order, until they do:
 *
 *   1. events, down to two
 *   2. birthdays, down to one
 *   3. events, down to one
 *   4. lessons (one row per child), down to one
 *   5. the birthdays, then the lessons, left out altogether
 *
 * The events go first because they are the longest list and the one with a
 * page of its own a tap away; the next event also stays under the clock. The
 * clock and the weather never give way. A list that leaves entries out ends
 * in a "+n" line, as the designed layouts' lists do.
 *
 * `cut` is how many of those steps are taken. The screensaver measures, takes
 * one more step while the lists overflow, and starts again from 0 when the
 * room or the lists change.
 */

export interface SaverListCounts {
  events: number;
  birthdays: number;
  lessons: number;
}

type List = keyof SaverListCounts;

function steps(totals: SaverListCounts): List[] {
  const out: List[] = [];
  const down = (list: List, from: number, to: number) => {
    for (let n = from; n > to; n--) out.push(list);
  };
  down("events", totals.events, 2);
  down("birthdays", totals.birthdays, 1);
  down("events", Math.min(totals.events, 2), 1);
  down("lessons", totals.lessons, 1);
  down("birthdays", Math.min(totals.birthdays, 1), 0);
  down("lessons", Math.min(totals.lessons, 1), 0);
  return out;
}

/** The most steps there are for these lists. */
export function saverListMaxCut(totals: SaverListCounts): number {
  return steps(totals).length;
}

/** How many entries of each list to show after `cut` steps. */
export function saverListPlan(totals: SaverListCounts, cut: number): SaverListCounts {
  const plan = { ...totals };
  for (const list of steps(totals).slice(0, Math.max(0, cut))) plan[list]--;
  return plan;
}

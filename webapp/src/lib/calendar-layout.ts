/**
 * Side-by-side placement for overlapping timed events in the week view.
 *
 * Without this, every event in a day column is positioned `left-1 right-1`
 * and two events at the same time render exactly on top of each other —
 * whichever sorts last wins and the other is invisible. This computes the
 * column layout every calendar app uses: overlapping events split the
 * column's width between them, and an event widens into the space to its
 * right when nothing is there to collide with.
 */

export interface LayoutableEvent {
  /**
   * Stable identity, used only as the final sort tiebreak. Without it,
   * two events with the same start *and* the same duration would be
   * ordered by their position in the input array — and the events query
   * doesn't guarantee a stable order for equal `start_at`, so the two
   * would visibly swap columns on an unrelated refetch.
   */
  id: string;
  start: Date;
  end: Date;
}

export interface EventPlacement<T> {
  event: T;
  /** Left offset as a fraction of the day column's width (0–1). */
  left: number;
  /** Width as a fraction of the day column's width (0–1). */
  width: number;
  /** How many events share this event's overlap cluster, itself included. */
  clusterSize: number;
}

/**
 * Shortest slot an event occupies for layout purposes.
 *
 * The renderer clamps every event to a minimum pixel height so a 5-minute
 * appointment stays readable. Layout has to use the same floor, or two
 * back-to-back short events would be computed as non-overlapping and then
 * drawn overlapping anyway. 24 minutes matches the 24px minimum at the
 * view's 60px-per-hour scale.
 */
const MIN_SLOT_MINUTES = 24;

function slotEnd(event: LayoutableEvent): number {
  const start = event.start.getTime();
  const end = event.end.getTime();
  return Math.max(end, start + MIN_SLOT_MINUTES * 60_000);
}

/**
 * Group events into clusters of transitively-overlapping events, then
 * assign columns within each cluster.
 *
 * Clusters matter because column count is a per-cluster property: three
 * events overlapping in the morning shouldn't squeeze an unrelated
 * afternoon event into a third of the width.
 */
export function layoutDayEvents<T extends LayoutableEvent>(
  events: T[],
): EventPlacement<T>[] {
  if (events.length === 0) return [];

  // Earlier first; on a tie the longer event leads, so it takes the
  // leftmost column and shorter events stack to its right — the reading
  // order people expect from a calendar.
  const sorted = [...events].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) return startDiff;
    const endDiff = slotEnd(b) - slotEnd(a);
    if (endDiff !== 0) return endDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const placements: EventPlacement<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length > 0) placements.push(...placeCluster(cluster));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    // A gap with no overlap ends the cluster: nothing after this point can
    // overlap anything before it, because the list is sorted by start.
    if (event.start.getTime() >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, slotEnd(event));
  }
  flush();

  return placements;
}

/** Assign columns within one cluster and widen events into free space. */
function placeCluster<T extends LayoutableEvent>(cluster: T[]): EventPlacement<T>[] {
  // columns[i] holds the events already placed in column i, in start order.
  const columns: T[][] = [];
  const columnOf = new Map<T, number>();

  for (const event of cluster) {
    // First column whose last event has finished — the classic greedy
    // interval-graph colouring. Checking only the last event is enough
    // because each column's events are appended in start order.
    let target = columns.findIndex((column) => {
      const last = column[column.length - 1];
      return slotEnd(last) <= event.start.getTime();
    });

    if (target === -1) {
      target = columns.length;
      columns.push([]);
    }
    columns[target].push(event);
    columnOf.set(event, target);
  }

  const columnCount = columns.length;

  return cluster.map((event) => {
    const column = columnOf.get(event) ?? 0;

    // Widen into the columns to the right for as long as none of them
    // holds something that overlaps this event. A 9–10 meeting next to a
    // 9:30–10 call shouldn't stay half-width for its first 30 minutes,
    // but it must stop before it reaches the call.
    let span = 1;
    for (let next = column + 1; next < columnCount; next++) {
      const blocked = columns[next].some(
        (other) =>
          other.start.getTime() < slotEnd(event) &&
          slotEnd(other) > event.start.getTime(),
      );
      if (blocked) break;
      span++;
    }

    return {
      event,
      left: column / columnCount,
      width: span / columnCount,
      clusterSize: cluster.length,
    };
  });
}

/**
 * The hour range the time grid has to cover.
 *
 * The grid was previously hard-coded to 6:00–22:00, which silently lost
 * events outside it: a 05:30 start produced a negative offset and drew
 * over the all-day row, and anything from 22:00 rendered past the bottom
 * of the container and was simply invisible. Keep 6–22 as the baseline
 * look, and widen only as far as the week's events actually require.
 */
export function visibleHourRange(
  events: LayoutableEvent[],
  baseStart = 6,
  baseEnd = 22,
): { startHour: number; endHour: number } {
  let startHour = baseStart;
  let endHour = baseEnd;

  for (const event of events) {
    startHour = Math.min(startHour, event.start.getHours());

    // An event ending exactly on the hour needs no extra row; one ending
    // at 22:15 needs the 22:00 row to be drawn.
    //
    // Callers pass single-day timed events only (anything crossing
    // midnight is rendered in the all-day row instead), so `end` is
    // always on the same calendar day as `start`.
    const end = new Date(slotEnd(event));
    const endsOnTheHour = end.getMinutes() === 0 && end.getSeconds() === 0;
    endHour = Math.max(endHour, endsOnTheHour ? end.getHours() : end.getHours() + 1);
  }

  return {
    startHour: Math.max(0, startHour),
    endHour: Math.min(24, Math.max(endHour, startHour + 1)),
  };
}

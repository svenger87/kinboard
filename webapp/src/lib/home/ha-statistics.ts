/**
 * Energy over a period from Home Assistant — the one code path behind both
 * the screens' `/api/homeassistant/statistics` and the Integration API's
 * `/energy/current`, so an assistant and the dashboard can never disagree
 * about how much the panels made today.
 *
 * It asks `GET /api/history/statistics` first. Home Assistant core serves
 * long-term statistics over its WebSocket API only (`recorder/
 * statistics_during_period`), so on a stock install that request is a 404
 * and the answer comes from the recorder's history instead: every numeric
 * state of each sensor from `start_time` to `end_time`, folded into one
 * period whose `change` is how much the counter grew.
 *
 * "Grew" is counted the way Home Assistant's own statistics count a
 * `total_increasing` sensor, so the number is right for both kinds of sensor
 * a household puts in the energy settings:
 *
 * - a lifetime counter (1,636 kWh and rising) grows by today's yield;
 * - a daily counter that resets to 0 shortly after midnight would otherwise
 *   come out as "today minus yesterday's total". A fall of more than 10% is
 *   a reset, and the value after it is growth from zero; a smaller dip is
 *   sensor noise and moves the reference without counting.
 */

import { HomeUpstreamError } from "@/lib/home/errors";
import { haConnection, haUrl, HA_STATES_MAX_BYTES, HA_TIMEOUT_MS, readJsonAtMost, type HaIo } from "@/lib/home/ha-client";
import type { StatisticsPeriod } from "@/types/home-assistant";

/** Why the statistics could not be read. `status` is Home Assistant's, or 0 for no answer. */
export class HaStatisticsError extends HomeUpstreamError {
  constructor(
    readonly stage: "statistics" | "history" | "connection",
    readonly status: number,
  ) {
    super(stage === "connection" ? "Home Assistant could not be reached" : `Home Assistant returned ${status} for ${stage}`);
    this.name = "HaStatisticsError";
  }
}

export interface HaStatisticsRequest {
  base: URL;
  token: string;
  ids: readonly string[];
  /** ISO instant. */
  startTime: string;
  /** ISO instant; Home Assistant's default when absent. */
  endTime?: string;
  /** `5minute`, `hour`, `day`, `week` or `month` — used by the statistics endpoint only. */
  period: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The most of one answer read. */
  maxBytes?: number;
  redirect?: RequestRedirect;
}

/** A Home Assistant state as a number, or null for `unavailable`, `unknown` and anything else. */
function numeric(state: unknown): number | null {
  if (typeof state === "number") return Number.isFinite(state) ? state : null;
  if (typeof state !== "string" || state.trim() === "") return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/**
 * How much a counter grew across `values` (in time order), with Home
 * Assistant's `total_increasing` reset rule: a fall below 90% of the previous
 * value is a reset and the new value counts in full; a smaller fall is a dip
 * and counts nothing.
 */
export function counterGrowth(values: readonly number[]): number {
  let growth = 0;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (cur >= prev) growth += cur - prev;
    else if (cur < 0.9 * prev) growth += cur;
  }
  return growth;
}

/**
 * The summed `change` of a sensor's periods — what the screens show — or
 * null when no period carries one: Home Assistant has no statistics for it,
 * which is not the same as "nothing produced".
 */
export function summedChange(periods: readonly StatisticsPeriod[] | undefined): number | null {
  let total: number | null = null;
  for (const p of periods ?? []) {
    if (typeof p.change === "number" && Number.isFinite(p.change)) total = (total ?? 0) + p.change;
  }
  return total;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Statistics for `ids` from `startTime`, keyed by entity ID — only IDs that
 * were asked for. Throws `HaStatisticsError` when Home Assistant cannot be
 * reached or answers with an error, `HomeUpstreamError` for an answer that is
 * too large or not the expected JSON.
 */
export async function fetchHaStatistics(req: HaStatisticsRequest): Promise<Record<string, StatisticsPeriod[]>> {
  const doFetch = req.fetch ?? fetch;
  const maxBytes = req.maxBytes ?? HA_STATES_MAX_BYTES;
  const wanted = new Set(req.ids);
  const get = async (url: URL): Promise<Response> => {
    try {
      return await doFetch(url, {
        headers: { Authorization: `Bearer ${req.token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(req.timeoutMs ?? HA_TIMEOUT_MS),
        cache: "no-store",
        redirect: req.redirect ?? "error",
      });
    } catch {
      throw new HaStatisticsError("connection", 0);
    }
  };
  const readJson = async (response: Response): Promise<unknown> => {
    try {
      return await readJsonAtMost(response, maxBytes);
    } catch (err) {
      if (err instanceof HomeUpstreamError) throw err;
      throw new HomeUpstreamError("Home Assistant returned an unexpected answer");
    }
  };

  const params = new URLSearchParams({ statistic_ids: req.ids.join(","), period: req.period, start_time: req.startTime });
  if (req.endTime) params.append("end_time", req.endTime);
  const statsUrl = haUrl(req.base, "/api/history/statistics");
  statsUrl.search = params.toString();
  const response = await get(statsUrl);

  if (response.ok) {
    const raw = await readJson(response);
    if (!isPlainObject(raw)) throw new HomeUpstreamError("Home Assistant returned an unexpected answer");
    const statistics: Record<string, StatisticsPeriod[]> = {};
    for (const [entityId, periods] of Object.entries(raw)) {
      if (!wanted.has(entityId) || !Array.isArray(periods)) continue;
      statistics[entityId] = periods.filter(isPlainObject).map((p) => ({
        start: p.start as string,
        end: p.end as string,
        mean: p.mean as number | undefined,
        min: p.min as number | undefined,
        max: p.max as number | undefined,
        sum: p.sum as number | undefined,
        change: p.change as number | undefined,
      }));
    }
    return statistics;
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 404) throw new HaStatisticsError("statistics", response.status);

  // No statistics endpoint (every stock Home Assistant): the recorder's history.
  const endTime = req.endTime ?? new Date().toISOString();
  const historyUrl = haUrl(req.base, `/api/history/period/${encodeURIComponent(req.startTime)}`);
  historyUrl.search = new URLSearchParams({ filter_entity_id: req.ids.join(","), end_time: endTime }).toString()
    + "&minimal_response&no_attributes";
  const history = await get(historyUrl);
  if (!history.ok) {
    await history.body?.cancel().catch(() => undefined);
    throw new HaStatisticsError("history", history.status);
  }
  const raw = await readJson(history);
  if (!Array.isArray(raw)) throw new HomeUpstreamError("Home Assistant returned an unexpected answer");

  const statistics: Record<string, StatisticsPeriod[]> = {};
  for (const entityStates of raw) {
    // minimal_response: only the first state of each list carries the entity ID.
    if (!Array.isArray(entityStates) || !isPlainObject(entityStates[0])) continue;
    const entityId = entityStates[0].entity_id;
    if (typeof entityId !== "string" || !wanted.has(entityId)) continue;

    const values = entityStates
      .map((s) => (isPlainObject(s) ? numeric(s.state) : null))
      .filter((v): v is number => v !== null);
    if (values.length === 0) {
      statistics[entityId] = [];
      continue;
    }
    statistics[entityId] = [{
      start: req.startTime,
      end: endTime,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      // A loop, not Math.min(...values): a day of a chatty sensor is tens of thousands of states.
      min: values.reduce((a, b) => Math.min(a, b)),
      max: values.reduce((a, b) => Math.max(a, b)),
      sum: values.reduce((a, b) => a + b, 0),
      change: counterGrowth(values),
    }];
  }
  return statistics;
}

/**
 * `fetchHaStatistics` with the family's own connection and the Integration
 * API's rules: no redirects, HA_TIMEOUT_MS, HA_STATES_MAX_BYTES.
 */
export async function getHaStatistics(
  familyId: string,
  ids: readonly string[],
  startTime: Date,
  endTime: Date,
  io: HaIo = {},
): Promise<Record<string, StatisticsPeriod[]>> {
  const { base, token } = await haConnection(familyId, io);
  return fetchHaStatistics({
    base, token, ids, period: "day",
    startTime: startTime.toISOString(), endTime: endTime.toISOString(),
    fetch: io.fetch,
  });
}

import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { codeOnly } from "./source-helpers";

/**
 * Pausing a timer, the wiring: the columns, the two session routes, the
 * widget's button and the strings. No stack. What a pause does is in
 * timer-math.spec.ts and integration-timers.spec.ts ("pausing");
 * timer-pause-ui.spec.ts drives it on a running stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("the migration adds the pause columns, idempotently", () => {
  const sql = codeOnly(read("docker/migration_timers_pause.sql"), { sql: true });
  expect(sql).toContain("ALTER TABLE public.timers ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;");
  expect(sql).toContain("ALTER TABLE public.timers ADD COLUMN IF NOT EXISTS paused_seconds INTEGER NOT NULL DEFAULT 0;");
  expect(sql).toContain("CHECK (paused_seconds >= 0)");
  expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
});

for (const action of ["pause", "resume"] as const) {
  test(`POST /api/timers/{id}/${action} checks the session and the family before it ${action}s, and says 409 when it can't`, () => {
    const route = codeOnly(read(`src/app/api/timers/[id]/${action}/route.ts`));
    const call = route.indexOf(`await ${action}Timer(supabase, familyId, id)`);
    expect(call, `${action} route calls ${action}Timer`).toBeGreaterThan(-1);
    for (const guard of ["requireSession(request)", "familyMatchesSession(auth.session, familyId)", 'rowInFamily(supabase, "timers", id, familyId)']) {
      const at = route.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, `${guard} comes first`).toBeLessThan(call);
    }
    expect(route).toContain("{ status: 409 }");
  });
}

test("the widget offers pause on a running timer and play on a paused one, and nothing on one that rings", () => {
  const widget = codeOnly(read("src/components/widgets/timer-widget.tsx"));
  expect(widget).toContain('{(state === "running" || state === "paused") && (');
  expect(widget).toContain('aria-label={state === "paused" ? t("resume") : t("pause")}');
  expect(widget).toContain('onClick={() => void togglePause(timer.id, state === "paused")}');
  // "Paused" sits under the time; the label stays the row's own child.
  expect(widget).toContain('{state === "paused" && (');
  expect(widget).toContain('{t("paused")}</span>');
  expect(widget).not.toContain('[timer.label, t("paused")]');
  // The clock is read as it starts again: it stood still while nothing ran.
  const clock = widget.slice(widget.indexOf("if (!hasRunning) return;"));
  expect(clock.indexOf("const first = setTimeout(tick, 0);")).toBeGreaterThan(-1);
  expect(clock.indexOf("const first = setTimeout(tick, 0);")).toBeLessThan(clock.indexOf("setInterval(tick, 1000)"));
  const hooks = codeOnly(read("src/hooks/use-timers.ts"));
  expect(hooks).toContain("fetch(`/api/timers/${id}/${action}`, {");
  // The tap's row goes into the cache, after any fetch already in flight is cancelled.
  const success = hooks.slice(hooks.indexOf("function useTimerAction"));
  expect(success.indexOf("await qc.cancelQueries(")).toBeLessThan(success.indexOf("qc.setQueryData<Timer[]>("));
});

test("an assistant is told a timer can be paused", () => {
  const mcp = read("src/lib/mcp/server.ts");
  expect(mcp).toContain("each running, paused or ringing timer");
  expect(mcp).toContain("ends_at null until it is resumed");
});

test("the strings exist in every language", () => {
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).timers;
    for (const key of ["pause", "resume", "paused", "pauseFailed", "resumeFailed"]) {
      expect(typeof strings[key], `${locale}.${key}`).toBe("string");
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
    }
  }
});

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIRM_LIMIT,
  CONFIRM_MAX_PENDING,
  CONFIRM_WINDOW_MS,
  DESTRUCTIVE_LIMIT,
  confirmLimitKey,
  confirmationBudget,
  destructiveLimitKey,
  destructiveLimitResponse,
  retryAfterSeconds,
} from "../src/lib/integration-limits";
import { hitLimit } from "../src/lib/rate-limit";

/**
 * Per-assistant abuse limits (RFC-011 §7, rulings 9 and 10). Pure and
 * process-local, so no stack: each test uses its own token id, which keeps
 * the shared in-memory buckets from leaking between tests.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
let seq = 0;
const freshToken = () => `limits-spec-${process.pid}-${Date.now()}-${seq++}`;

test.describe("confirmation budget (ruling 9)", () => {
  test("the constants are the ruling's", () => {
    expect([CONFIRM_MAX_PENDING, CONFIRM_LIMIT, CONFIRM_WINDOW_MS]).toEqual([2, 5, 600_000]);
    expect(confirmLimitKey("t")).toBe("integration:t:home-confirm");
  });

  test("two waiting refuse a third, until the earliest expires — and spend nothing", () => {
    let hits = 0;
    const hit = () => { hits++; return { limited: false, retryAfterMs: 0 }; };
    expect(confirmationBudget([at(90_000), at(30_000)], NOW, hit)).toEqual({ ok: false, retryAfterMs: 30_000 });
    expect(hits).toBe(0);
    expect(confirmationBudget([at(90_000)], NOW, hit)).toEqual({ ok: true });
    expect(hits).toBe(1);
  });

  test("a pending row past its expiry is not waiting", () => {
    const hit = () => ({ limited: false, retryAfterMs: 0 });
    expect(confirmationBudget([at(-1), at(-60_000), at(10_000)], NOW, hit)).toEqual({ ok: true });
    expect(confirmationBudget(["not a date", at(10_000)], NOW, hit)).toEqual({ ok: true });
  });

  test("five created in ten minutes, then 429 with the time until the oldest falls out", () => {
    const token = freshToken();
    const hit = () => hitLimit(confirmLimitKey(token), CONFIRM_LIMIT, CONFIRM_WINDOW_MS);
    for (let i = 0; i < 5; i++) expect(confirmationBudget([], NOW, hit), `#${i + 1}`).toEqual({ ok: true });
    const sixth = confirmationBudget([], NOW, hit);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.retryAfterMs).toBeGreaterThan(CONFIRM_WINDOW_MS - 5_000);
  });

  test("Retry-After is whole seconds and never 0", () => {
    expect([retryAfterSeconds(0), retryAfterSeconds(1), retryAfterSeconds(1000), retryAfterSeconds(1001)]).toEqual([1, 1, 1, 2]);
  });
});

test.describe("edits and deletes (ruling 10)", () => {
  test("30 per token in ten minutes, then 429 rate_limited with retry-after; other tokens unaffected", async () => {
    expect(DESTRUCTIVE_LIMIT).toBe(30);
    expect(destructiveLimitKey("t")).toBe("integration:t:destructive");
    const token = freshToken();
    for (let i = 0; i < 30; i++) {
      expect(destructiveLimitResponse({ tokenId: token, assistant: true }), `#${i + 1}`).toBeNull();
    }
    const res = destructiveLimitResponse({ tokenId: token, assistant: true });
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(590);
    expect(await res?.json()).toMatchObject({ code: "rate_limited" });
    expect(destructiveLimitResponse({ tokenId: freshToken(), assistant: true })).toBeNull();
  });

  test("a manually created token (assistant: false) is never limited, however many edits it sends", () => {
    const token = freshToken();
    for (let i = 0; i < 40; i++) {
      expect(destructiveLimitResponse({ tokenId: token, assistant: false }), `#${i + 1}`).toBeNull();
    }
  });

  // Every PATCH and DELETE of the Integration API spends the budget first,
  // before it reads or writes anything. A new edit/delete route without the
  // call turns this red.
  test("every Integration API PATCH/DELETE handler spends the budget before anything else", () => {
    const root = join(__dirname, "..", "src", "app", "api", "integration");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts") files.push(p);
      }
    };
    walk(root);
    let handlers = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/export async function (PATCH|DELETE)\(/g)) {
        handlers++;
        const body = src.slice(m.index!);
        const open = body.indexOf("async (context) => {");
        expect(open, `${file} ${m[1]} uses withIntegrationAuth`).toBeGreaterThan(-1);
        const first = body.slice(open + "async (context) => {".length).trimStart();
        expect(first.startsWith("const limited = destructiveLimitResponse(context);"), `${file} ${m[1]}`).toBe(true);
      }
    }
    // tasks+shopping (lists PATCH/DELETE), notes PATCH/DELETE, calendar PATCH/DELETE, meals DELETE,
    // timers DELETE, birthdays PATCH/DELETE, countdowns DELETE.
    expect(handlers).toBe(11);
  });
});

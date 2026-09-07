import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { codeOnly } from "./source-helpers";

/**
 * `useErroredQueryCount` must not set state from the query cache's callback.
 *
 * TanStack's query cache notifies subscribers *synchronously*, and one of the
 * things that notifies it is a component mounting an observer — which happens
 * during that component's render. The hook used `useState` + `useEffect` and
 * called `setCount` straight from the subscription, so mounting a widget set
 * state on whoever owns the hook in the middle of somebody else's render:
 *
 *   Cannot update a component (`ConnectivityBanner`) while rendering a
 *   different component (`ScheduleWidget`).
 *
 * Reproduced on the dashboard in 2 of 6 loads before the change, 0 of 6 after,
 * in both Chromium and WebKit. React strips the warning from production builds,
 * so nothing on a wall display ever showed it — which is exactly why it sat
 * there. It surfaced only because the WebKit smoke run prints console errors.
 *
 * `useSyncExternalStore` is the tool for this: React drives the read and
 * schedules the update, instead of being told about it mid-render.
 */

const hook = readFileSync("src/hooks/use-connectivity-status.ts", "utf8");
/* The hook's own doc comment names `useState` and `setCount` while explaining
   why neither is there any more, so the assertions below read the code alone. */
const code = codeOnly(hook);

test("the errored-query count is read through useSyncExternalStore", () => {
  expect(
    code,
    "the hook subscribes to the query cache; reading it any other way means " +
      "setting state from a synchronous notification",
  ).toContain("useSyncExternalStore");
});

test("it does not set state from the cache subscription", () => {
  /*
    The precise shape that caused it. `useState` here is not wrong in itself —
    calling its setter from inside `cache.subscribe(...)` is — but the hook has
    no other reason to hold state now, so its absence is the simplest thing to
    assert and the hardest to reintroduce by accident.
  */
  expect(
    code,
    "useState is back in this hook; if its setter is called from the cache " +
      "subscription, mounting a widget updates another component mid-render",
  ).not.toMatch(/useState/);
  expect(code).not.toMatch(/setCount/);
});

test("it still renders nothing on the server", () => {
  // A banner that flashed on hydration and vanished would be worse than one
  // that arrives a tick late.
  expect(code, "useSyncExternalStore needs a server snapshot or SSR throws").toMatch(
    /getServerSnapshot/,
  );
});

test("the count still means what the banner assumes", () => {
  // The banner's threshold of 2 only makes sense against *settled* errors on
  // queries something is actually observing (audit KB-05). Keep both filters.
  expect(code).toMatch(/status === "error"/);
  expect(code).toMatch(/getObserversCount\(\) > 0/);
});

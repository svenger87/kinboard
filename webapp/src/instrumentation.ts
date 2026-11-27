/**
 * Next calls register() once when a server starts.
 *
 * It starts the internal scheduler when KINBOARD_SCHEDULER=internal
 * (RFC-023 §4.5) and does nothing otherwise. Node runtime only: the
 * scheduler uses timers, child_process and the server's own port.
 *
 * Keep the import INSIDE `if (process.env.NEXT_RUNTIME === "nodejs") { … }`,
 * the shape Next documents. webpack also compiles this file for the edge
 * runtime, with NEXT_RUNTIME replaced by "edge", and drops the import only
 * when it sits in a branch that is dead. An early
 * `if (NEXT_RUNTIME !== "nodejs") return;` before the import is not enough:
 * the import after it is still bundled for edge, which cannot load
 * `node:child_process`, and `next dev --webpack` answers every request 500.
 * e2e/instrumentation-runtime-guard.spec.ts holds this shape.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.KINBOARD_SCHEDULER) return;
    const { startInternalScheduler } = await import("./lib/schedule/start");
    startInternalScheduler();
  }
}

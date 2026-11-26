/**
 * Next calls register() once when a server starts.
 *
 * It starts the internal scheduler when KINBOARD_SCHEDULER=internal
 * (RFC-023 §4.5) and does nothing otherwise. Node runtime only: the
 * scheduler uses timers, child_process and the server's own port.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.KINBOARD_SCHEDULER) return;
  const { startInternalScheduler } = await import("./lib/schedule/start");
  startInternalScheduler();
}

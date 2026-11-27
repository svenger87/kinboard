/**
 * The scheduled jobs: one table, read by both schedulers (RFC-023 §4.5).
 *
 * A git install runs these with ofelia, from the labels on the webapp
 * container in docker/docker-compose.yml; each label's command is a script
 * the image installs (image/Dockerfile), which calls its route through
 * /app/cron-call.sh. With KINBOARD_SCHEDULER=internal the webapp runs them
 * itself, from this table (./runner.ts).
 *
 * The labels and the scripts cannot be generated from here: compose reads
 * the labels from a static file a household keeps, and the Dockerfile is
 * static too. So e2e/schedule-parity.spec.ts is the guarantee instead: it
 * reads the labels and the Dockerfile and fails on any job, schedule,
 * command, route or no-overlap setting that differs from this table. Add a
 * job here, in the labels and in the Dockerfile, or the test goes red, and
 * prints the label block this table expects.
 *
 * Schedules are ofelia's syntax: six fields with seconds
 * (`sec min hour day-of-month month day-of-week`), or `@every <duration>`.
 * The fixed times are UTC, as ofelia's are today: its container sets no time
 * zone (RFC-023 §4.5, decided §11.1b). `@every` counts from the scheduler's
 * start, so installs spread across the day.
 */

export interface ScheduledJob {
  /** The ofelia job name (`ofelia.job-exec.<name>.*`) and the name in the logs. */
  name: string;
  /** ofelia's schedule string, verbatim. */
  schedule: string;
  /** The script ofelia runs inside the webapp container (`…command`). */
  command: string;
  /** The route the script calls: POST /api/cron/<route>. */
  route: string;
  /** Skip a run while the previous one is still going (`…no-overlap`). */
  noOverlap: boolean;
}

const job = (name: string, schedule: string, route: string = name): ScheduledJob => ({
  name,
  schedule,
  command: `/usr/local/bin/${name}`,
  route,
  noOverlap: true,
});

export const JOBS: readonly ScheduledJob[] = [
  job("google-sync", "@every 15m"),
  job("todo-reminders", "0 0 8 * * *"),
  // The Heute-Motor: rules that care about minutes cross their threshold once,
  // so five minutes is precise enough and early enough for the school run.
  job("evaluate-attention", "@every 5m"),
  job("process-notifications", "@every 30s"),
  job("schedule-event-reminders", "@every 5m"),
  job("extend-event-series", "0 20 3 * * *"),
  job("birthday-reminders", "0 0 7 * * *"),
  job("meal-prep-reminders", "0 0 18 * * *"),
  job("sync-ics", "@every 30m"),
  job("sync-caldav", "0 15,45 * * * *"),
  // #407: the two minutes Settings → Bring! "Auto sync" promises.
  job("sync-bring", "@every 2m"),
  // RFC-014 §5.2: daily, counted from start so installs spread across the day.
  job("sync-school-holidays", "@every 24h"),
  job("pocket-money-accrue-interest", "0 30 0 * * *", "accrue-interest"),
  job("pocket-money-commit-interest", "0 0 * * * *", "commit-interest"),
  job("pocket-money-process-allowance", "0 0 * * * *", "process-allowance"),
  // #341: a daily task's day closes at the family's midnight, so this runs often.
  job("close-task-days", "@every 15m"),
  job("purge-recycle-bin", "0 30 3 * * *"),
  job("purge-domain-events", "0 45 3 * * *"),
];

import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { JOBS, type ScheduledJob } from "../src/lib/schedule/jobs";
import { normaliseSchedule } from "../src/lib/schedule/cron";

/**
 * RFC-023 §4.5, "Parity": one job list, two schedulers.
 *
 * A git install runs the jobs with ofelia, from the labels on the webapp
 * service in docker/docker-compose.yml; each label's command is a script the
 * Dockerfile installs, which calls one /api/cron route. With
 * KINBOARD_SCHEDULER=internal the server runs src/lib/schedule/jobs.ts
 * instead. Neither file can be generated from the other (compose and the
 * Dockerfile are static files), so this holds them together: same job names,
 * same schedules (normalised: `@every 15m` = `@every 900s`), same commands,
 * same no-overlap, and each command's script calls the route the module
 * calls. A job added to one side only fails here, and the failure prints the
 * label block the module expects.
 */

const ROOT = join(__dirname, "..");
const COMPOSE = join(ROOT, "docker/docker-compose.yml");
const DOCKERFILE = join(ROOT, "image/Dockerfile");

type Job = Omit<ScheduledJob, "route"> & { route?: string };

/** ofelia's job-exec labels on one service, as jobs. Throws on a key the module does not model. */
function jobsFromLabels(labels: Record<string, string>): Job[] {
  const jobs = new Map<string, Partial<Job>>();
  for (const [key, value] of Object.entries(labels)) {
    const m = /^ofelia\.job-exec\.([^.]+)\.(.+)$/.exec(key);
    if (!m) continue;
    const [, name, field] = m;
    const job = jobs.get(name) ?? { name, noOverlap: false };
    if (field === "schedule") job.schedule = String(value);
    else if (field === "command") job.command = String(value);
    else if (field === "no-overlap") job.noOverlap = String(value) === "true";
    else throw new Error(`label ${key}: the job module has no "${field}"`);
    jobs.set(name, job);
  }
  return [...jobs.values()].map((j) => {
    if (!j.schedule || !j.command) throw new Error(`job ${j.name} lacks a schedule or a command label`);
    return j as Job;
  });
}

/** The Dockerfile's job scripts: `/usr/local/bin/<script>` → the route it calls. */
function scriptsFromDockerfile(text: string): Map<string, string> {
  const scripts = new Map<string, string>();
  for (const m of text.matchAll(/echo 'exec \/app\/cron-call\.sh ([\w-]+)' >> (\/usr\/local\/bin\/[\w-]+)/g)) {
    scripts.set(m[2], m[1]);
  }
  return scripts;
}

/** Every difference between the module and the legacy files, one line each. */
function drift(module: readonly ScheduledJob[], labels: Job[], scripts: Map<string, string>): string[] {
  const out: string[] = [];
  const byName = new Map(labels.map((j) => [j.name, j]));
  for (const m of module) {
    const l = byName.get(m.name);
    if (!l) {
      out.push(`${m.name}: in the job module, not in the compose labels`);
      continue;
    }
    if (normaliseSchedule(m.schedule) !== normaliseSchedule(l.schedule)) {
      out.push(`${m.name}: schedule "${m.schedule}" in the module, "${l.schedule}" in the labels`);
    }
    if (m.command !== l.command) out.push(`${m.name}: command "${m.command}" in the module, "${l.command}" in the labels`);
    if (m.noOverlap !== l.noOverlap) out.push(`${m.name}: no-overlap ${m.noOverlap} in the module, ${l.noOverlap} in the labels`);
    const route = scripts.get(m.command);
    if (route === undefined) out.push(`${m.name}: the Dockerfile installs no ${m.command}`);
    else if (route !== m.route) out.push(`${m.name}: ${m.command} calls "${route}", the module calls "${m.route}"`);
  }
  const names = new Set(module.map((m) => m.name));
  for (const l of labels) if (!names.has(l.name)) out.push(`${l.name}: in the compose labels, not in the job module`);
  return out;
}

function expectedLabels(module: readonly ScheduledJob[]): string {
  return module
    .flatMap((j) => [
      `ofelia.job-exec.${j.name}.schedule: "${j.schedule}"`,
      `ofelia.job-exec.${j.name}.command: "${j.command}"`,
      ...(j.noOverlap ? [`ofelia.job-exec.${j.name}.no-overlap: "true"`] : []),
    ])
    .map((l) => `      ${l}`)
    .join("\n");
}

function legacy() {
  const compose = yaml.load(readFileSync(COMPOSE, "utf8")) as {
    services: Record<string, { labels?: Record<string, string> | string[] }>;
  };
  const raw = compose.services.webapp.labels ?? {};
  const labels = Array.isArray(raw)
    ? Object.fromEntries(raw.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
    : raw;
  return { labels: jobsFromLabels(labels), scripts: scriptsFromDockerfile(readFileSync(DOCKERFILE, "utf8")) };
}

test.describe("the job module matches the legacy ofelia labels", () => {
  test("same jobs, schedules, commands, no-overlap and routes", () => {
    const { labels, scripts } = legacy();
    const found = drift(JOBS, labels, scripts);
    expect(
      found,
      `${found.join("\n")}\n\nThe labels the job module expects (docker/docker-compose.yml, webapp service):\n${expectedLabels(JOBS)}`,
    ).toEqual([]);
    // Not vacuous: the files really were read.
    expect(labels.length).toBe(18);
    expect(JOBS.length).toBe(18);
  });

  test("no other service carries ofelia jobs", () => {
    const compose = yaml.load(readFileSync(COMPOSE, "utf8")) as {
      services: Record<string, { labels?: Record<string, string> }>;
    };
    const others = Object.entries(compose.services)
      .filter(([name, svc]) => name !== "webapp" && JSON.stringify(svc.labels ?? {}).includes("ofelia.job-"))
      .map(([name]) => name);
    expect(others).toEqual([]);
  });

  test("every route the module calls exists and takes POST", () => {
    for (const job of JOBS) {
      const file = join(ROOT, "src/app/api/cron", job.route, "route.ts");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toMatch(/export (async )?function POST\b/);
    }
  });

  test("every schedule parses as ofelia's syntax", () => {
    for (const job of JOBS) expect(() => normaliseSchedule(job.schedule), job.name).not.toThrow();
  });
});

test.describe("the parity check catches drift (it is not vacuous)", () => {
  const base = () => {
    const { labels, scripts } = legacy();
    return { labels: labels.map((j) => ({ ...j })), scripts: new Map(scripts) };
  };

  test("a job only in the module", () => {
    const { labels, scripts } = base();
    const extra: ScheduledJob = { name: "new-job", schedule: "@every 1m", command: "/usr/local/bin/new-job", route: "new-job", noOverlap: true };
    expect(drift([...JOBS, extra], labels, scripts)).toEqual([
      "new-job: in the job module, not in the compose labels",
    ]);
  });

  test("a job only in the labels", () => {
    const { labels, scripts } = base();
    labels.push({ name: "new-job", schedule: "@every 1m", command: "/usr/local/bin/new-job", noOverlap: true });
    expect(drift(JOBS, labels, scripts)).toEqual(["new-job: in the compose labels, not in the job module"]);
  });

  test("a schedule, a command, no-overlap and a route that differ", () => {
    const { labels, scripts } = base();
    labels.find((j) => j.name === "todo-reminders")!.schedule = "0 0 9 * * *";
    labels.find((j) => j.name === "sync-ics")!.command = "/usr/local/bin/sync-ical";
    labels.find((j) => j.name === "sync-bring")!.noOverlap = false;
    scripts.set("/usr/local/bin/birthday-reminders", "todo-reminders");
    scripts.delete("/usr/local/bin/sync-caldav");
    expect(drift(JOBS, labels, scripts)).toEqual([
      'todo-reminders: schedule "0 0 8 * * *" in the module, "0 0 9 * * *" in the labels',
      'birthday-reminders: /usr/local/bin/birthday-reminders calls "todo-reminders", the module calls "birthday-reminders"',
      "sync-ics: command \"/usr/local/bin/sync-ics\" in the module, \"/usr/local/bin/sync-ical\" in the labels",
      "sync-caldav: the Dockerfile installs no /usr/local/bin/sync-caldav",
      "sync-bring: no-overlap true in the module, false in the labels",
    ]);
  });

  test("the same schedule spelled differently is not drift", () => {
    const { labels, scripts } = base();
    labels.find((j) => j.name === "google-sync")!.schedule = "@every 900s";
    labels.find((j) => j.name === "todo-reminders")!.schedule = "0 0 08 * * ?";
    expect(drift(JOBS, labels, scripts)).toEqual([]);
  });

  test("a label key the module does not model is refused", () => {
    expect(() => jobsFromLabels({ "ofelia.job-exec.x.schedule": "@every 1m", "ofelia.job-exec.x.user": "root" })).toThrow(
      /no "user"/,
    );
  });
});

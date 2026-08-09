import type { ProposedItem, Rule, Signals } from "./types";
import { localMinutes } from "./engine";

/**
 * The ten rules Kinboard ships with (plan §Phase 3).
 *
 * Every one of them is a pure function of the signals. Two constraints shaped
 * the set:
 *
 * - **A family without Home Assistant must get real value.** Eight of the ten
 *   use nothing but the family's own calendar, timetable, tasks and meal plan.
 *   The two that reach further degrade to silence rather than to an error.
 * - **Every hint has to be worth interrupting for.** The temptation is to
 *   surface everything that is true; what makes a wall display useful is that
 *   it stays quiet until something is actually actionable, so most of these
 *   are gated on a time of day when somebody can still do something about it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day as YYYY-MM-DD — the unit families actually think in. */
function localDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function sameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDay(a, timeZone) === localDay(b, timeZone);
}

/** 0 = Sunday, matching the schedules table's own CHECK constraint. */
function localDayOfWeek(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------

const leaveSoon: Rule = {
  id: "leave-soon",
  title: "Time to leave",
  description: "Says when the next appointment is close enough to start moving.",
  defaultConfig: { minutesBefore: 45 },
  evaluate(signals, { config }) {
    const window = num(config, "minutesBefore", 45) * 60 * 1000;
    return signals.events
      .filter((e) => !e.allDay)
      .filter((e) => {
        const delta = e.startAt.getTime() - signals.now.getTime();
        return delta > 0 && delta <= window;
      })
      .map((e) => {
        const minutes = Math.round((e.startAt.getTime() - signals.now.getTime()) / 60000);
        return {
          // Keyed on the event, not on the countdown: the same appointment
          // must stay the same item as the minutes tick down, or an
          // acknowledgement would be lost every sixty seconds.
          key: `leave-soon:${e.id}`,
          title: e.personName ? `${e.personName}: ${e.title}` : e.title,
          detail: e.location
            ? `In ${minutes} minutes, at ${e.location}.`
            : `In ${minutes} minutes.`,
          evidence: { eventId: e.id, startAt: e.startAt.toISOString(), minutes },
          priority: 10,
          subjectType: "event",
          subjectId: e.id,
        } satisfies ProposedItem;
      });
  },
};

const packTheSchoolBag: Rule = {
  id: "pack-the-school-bag",
  title: "Pack the school bag",
  description:
    "The evening before, lists what tomorrow's lessons need — sports kit, swimming things.",
  contexts: ["evening"],
  evaluate(signals) {
    const tomorrow = new Date(signals.now.getTime() + DAY_MS);
    const dow = localDayOfWeek(tomorrow, signals.timeZone);
    const day = localDay(tomorrow, signals.timeZone);

    const byPerson = new Map<string, { name: string; needs: Set<string> }>();
    for (const lesson of signals.lessons) {
      if (lesson.dayOfWeek !== dow || lesson.packList.length === 0) continue;
      const entry = byPerson.get(lesson.personId) ?? {
        name: lesson.personName,
        needs: new Set<string>(),
      };
      for (const thing of lesson.packList) entry.needs.add(thing);
      byPerson.set(lesson.personId, entry);
    }

    return [...byPerson.entries()].map(([personId, { name, needs }]) => ({
      key: `pack-the-school-bag:${day}:${personId}`,
      title: `${name} needs to pack for tomorrow`,
      detail: [...needs].sort().join(", "),
      evidence: { day, personId, needs: [...needs].sort() },
      priority: 30,
      subjectType: "person",
      subjectId: personId,
    }));
  },
};

const schoolTomorrow: Rule = {
  id: "school-tomorrow",
  title: "School tomorrow",
  description: "In the evening, says which children have school in the morning.",
  contexts: ["evening"],
  evaluate(signals) {
    const tomorrow = new Date(signals.now.getTime() + DAY_MS);
    const dow = localDayOfWeek(tomorrow, signals.timeZone);
    const day = localDay(tomorrow, signals.timeZone);

    const children = new Map<string, string>();
    for (const lesson of signals.lessons) {
      if (lesson.dayOfWeek === dow) children.set(lesson.personId, lesson.personName);
    }
    if (children.size === 0) return [];

    return [
      {
        key: `school-tomorrow:${day}`,
        title: `School tomorrow: ${[...children.values()].sort().join(", ")}`,
        // The absence of this item is information too — no lessons tomorrow
        // means a holiday, which is why this asks the timetable rather than
        // checking whether tomorrow is a weekday.
        detail: `${children.size} ${children.size === 1 ? "child has" : "children have"} lessons.`,
        evidence: { day, children: [...children.values()].sort() },
        priority: 60,
      },
    ];
  },
};

const overdueTasks: Rule = {
  id: "overdue-tasks",
  title: "Overdue tasks",
  description: "Raises tasks whose due date has passed.",
  evaluate(signals) {
    const overdue = signals.todos.filter(
      (t) => !t.completed && t.dueDate !== null && t.dueDate.getTime() < signals.now.getTime()
    );
    if (overdue.length === 0) return [];
    const day = localDay(signals.now, signals.timeZone);
    return [
      {
        // One item for all of them, not one each. Ten separate hints for ten
        // overdue tasks is a wall of red that gets ignored wholesale.
        key: `overdue-tasks:${day}`,
        title: `${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`,
        detail: overdue
          .slice(0, 3)
          .map((t) => t.title)
          .join(", "),
        evidence: { ids: overdue.map((t) => t.id).sort(), count: overdue.length },
        priority: 50,
      },
    ];
  },
};

const birthdayToday: Rule = {
  id: "birthday-today",
  title: "Birthday today",
  description: "Names whose birthday it is, first thing.",
  contexts: ["morning"],
  evaluate(signals) {
    return signals.birthdays
      .filter((b) => b.daysUntil === 0)
      .map((b) => ({
        key: `birthday-today:${localDay(signals.now, signals.timeZone)}:${b.id}`,
        title: `${b.name} has a birthday today`,
        evidence: { birthdayId: b.id, name: b.name },
        priority: 5,
        subjectType: "birthday",
        subjectId: b.id,
      }));
  },
};

const birthdaySoon: Rule = {
  id: "birthday-soon",
  title: "Birthday coming up",
  description: "Gives enough warning to buy a present.",
  defaultConfig: { daysAhead: 7 },
  evaluate(signals, { config }) {
    const ahead = num(config, "daysAhead", 7);
    return signals.birthdays
      .filter((b) => b.daysUntil === ahead)
      .map((b) => ({
        // Keyed on the birthday and the day it falls, so it is raised once per
        // year rather than once per evaluation.
        key: `birthday-soon:${b.id}:${localDay(b.date, signals.timeZone)}`,
        title: `${b.name} has a birthday in ${ahead} days`,
        detail: "Time to sort a present.",
        evidence: { birthdayId: b.id, daysUntil: b.daysUntil },
        priority: 70,
        subjectType: "birthday",
        subjectId: b.id,
      }));
  },
};

const nothingPlannedForDinner: Rule = {
  id: "nothing-planned-for-dinner",
  title: "No dinner planned",
  description: "In the evening, says if tomorrow has nothing planned to eat.",
  contexts: ["evening"],
  evaluate(signals) {
    const tomorrow = new Date(signals.now.getTime() + DAY_MS);
    const day = localDay(tomorrow, signals.timeZone);
    const planned = signals.meals.some(
      (m) => sameLocalDay(m.date, tomorrow, signals.timeZone) && m.title
    );
    if (planned) return [];
    // Only worth saying if the family uses the meal plan at all. Nagging a
    // household that has never planned a meal is noise, not help.
    if (signals.meals.length === 0) return [];
    return [
      {
        key: `nothing-planned-for-dinner:${day}`,
        title: "Nothing planned to eat tomorrow",
        evidence: { day },
        priority: 80,
      },
    ];
  },
};

const shoppingBeforeTheWeekend: Rule = {
  id: "shopping-before-the-weekend",
  title: "Shopping list before the weekend",
  description: "On Friday evening, mentions the list while the shops are still open.",
  contexts: ["afternoon", "evening"],
  evaluate(signals) {
    if (localDayOfWeek(signals.now, signals.timeZone) !== 5) return [];
    if (signals.shoppingItemCount === 0) return [];
    return [
      {
        key: `shopping-before-the-weekend:${localDay(signals.now, signals.timeZone)}`,
        title: `${signals.shoppingItemCount} things on the shopping list`,
        detail: "The weekend is close — worth a trip today.",
        evidence: { count: signals.shoppingItemCount },
        priority: 75,
      },
    ];
  },
};

const takeAnUmbrella: Rule = {
  id: "take-an-umbrella",
  title: "Take an umbrella",
  description: "Mentions rain when somebody is due out of the house.",
  contexts: ["morning"],
  evaluate(signals, { config }) {
    // Degrades to silence, not to an error: a family with no weather source
    // configured must not see a broken hint. Same for the rules below it.
    const weather = signals.weather;
    if (!weather || weather.precipitationChance === null) return [];

    const threshold = num(config, "chanceThreshold", 60);
    if (weather.precipitationChance < threshold) return [];

    const goingOut = signals.events.some(
      (e) => !e.allDay && sameLocalDay(e.startAt, signals.now, signals.timeZone)
    );
    if (!goingOut) return [];

    return [
      {
        key: `take-an-umbrella:${localDay(signals.now, signals.timeZone)}`,
        title: "Rain likely today",
        detail: `${weather.precipitationChance}% chance, and somebody is out.`,
        evidence: { precipitationChance: weather.precipitationChance },
        priority: 40,
      },
    ];
  },
  defaultConfig: { chanceThreshold: 60 },
};

const lockUpBeforeBed: Rule = {
  id: "lock-up-before-bed",
  title: "Lock up before bed",
  description:
    "Late in the evening, mentions a door or window Home Assistant still reports open.",
  contexts: ["evening", "quiet"],
  defaultConfig: {
    afterHour: 21,
    // Home Assistant's own device classes, not entity-id prefixes.
    //
    // The first version matched ids beginning `binary_sensor.door`. Measured
    // against a real installation that found ZERO entities out of 944: the
    // house is named in German, so its sensors are `haustur`, `fenster`,
    // `terrassentur`. A shipped rule cannot assume the language a household
    // names its things in, and device_class is Home Assistant's own answer to
    // "what kind of thing is this".
    deviceClasses: ["door", "window", "opening", "garage_door"],
    // Cars report door and window classes too, and "the Model Y's passenger
    // door is open" is worth knowing at 22:00 — but a family that disagrees
    // needs a way to say so without turning the whole rule off.
    excludePrefixes: [] as string[],
  },
  evaluate(signals, { config }) {
    const home = signals.home;
    if (!home) return [];

    if (localMinutes(signals.now, signals.timeZone) < num(config, "afterHour", 21) * 60) return [];

    const wanted = new Set(
      Array.isArray(config.deviceClasses)
        ? (config.deviceClasses as string[])
        : ["door", "window", "opening", "garage_door"]
    );
    const excluded = Array.isArray(config.excludePrefixes)
      ? (config.excludePrefixes as string[])
      : [];

    const open = Object.entries(home.states)
      .filter(([id, state]) => {
        if (state !== "on") return false;
        if (excluded.some((p) => id.startsWith(p))) return false;
        return wanted.has(home.deviceClasses[id] ?? "");
      })
      .map(([id]) => id)
      .sort();

    if (open.length === 0) return [];
    return [
      {
        key: `lock-up-before-bed:${localDay(signals.now, signals.timeZone)}`,
        title: `${open.length} still open`,
        detail: open.join(", "),
        evidence: { entities: open },
        priority: 20,
      },
    ];
  },
};

/**
 * Shipped in a fixed order so the set is reviewable as a list, and so two
 * evaluations cannot differ because of iteration order.
 */
export const RULES: Rule[] = [
  birthdayToday,
  leaveSoon,
  lockUpBeforeBed,
  packTheSchoolBag,
  takeAnUmbrella,
  overdueTasks,
  schoolTomorrow,
  birthdaySoon,
  shoppingBeforeTheWeekend,
  nothingPlannedForDinner,
];

export const RULES_BY_ID: Record<string, Rule> = Object.fromEntries(
  RULES.map((r) => [r.id, r])
);

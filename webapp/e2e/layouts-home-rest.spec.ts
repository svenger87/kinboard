import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { creatureGrid } from "../src/components/layouts/home-widgets/creatures";
import { personIdOf } from "../src/components/layouts/home-widgets/rest-shared";

/**
 * The "rest" group of Home widgets in a box (RFC-022 step 4, §3.1): week
 * overview, schedule, vehicles, stonks, pocket money, creatures, photos,
 * timers and media. Source guards: one component per widget in REST_WIDGETS,
 * the fixed kinds fit by dropping detail (useShrinkStep), the pocket-money
 * value grows through useFitToBox, touch targets are 48px, the widgets read
 * Home's shared data from the context where it has it, and each reuses its
 * card's logic rather than a copy. The boxes themselves are looked at on
 * /dev/home-rest-widgets.
 */

const DIR = "src/components/layouts/home-widgets";
const read = (p: string) => readFileSync(p, "utf8");
/** Source without comments, so a guard cannot be satisfied by prose. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES: Record<string, string> = {
  weekOverview: "week-overview",
  schedule: "schedule",
  vehicles: "vehicles",
  stonks: "stonks",
  pocketMoney: "pocket-money",
  creatures: "creatures",
  photos: "photos",
  timers: "timers",
  media: "media",
};

test("REST_WIDGETS has exactly the nine keys, one file each", () => {
  const src = code(`${DIR}/rest.ts`);
  const body = src.slice(src.indexOf("REST_WIDGETS"));
  const keys = [...body.matchAll(/^\s+(\w+): \w+HomeWidget,$/gm)].map((m) => m[1]);
  expect(keys.sort()).toEqual(Object.keys(FILES).sort());
  for (const [key, file] of Object.entries(FILES)) {
    expect(existsSync(`${DIR}/${file}.tsx`), key).toBe(true);
    expect(src, key).toContain(`from "./${file}";`);
  }
});

test("each key is a Home widget of the kind the catalogue says", () => {
  const widgets = read("src/lib/layouts/widgets.ts");
  for (const key of Object.keys(FILES)) {
    const m = widgets.match(new RegExp(`^\\s+${key}: home\\("(\\w+)"`, "m"));
    expect(m, key).toBeTruthy();
    expect(m![1], key).toBe(key === "pocketMoney" ? "value" : "fixed");
  }
});

test("fixed widgets drop detail by measuring; the value grows with useFitToBox", () => {
  for (const [key, file] of Object.entries(FILES)) {
    const src = code(`${DIR}/${file}.tsx`);
    if (key === "pocketMoney") {
      expect(src).toMatch(/import \{ useFitToBox \} from "@\/hooks\/use-fit-to-box"/);
      expect(src).toContain("useFitToBox(ref, valueBox(inner, item.text)");
    } else if (key !== "photos") {
      expect(src, key).toMatch(/useShrinkStep\(ref, /);
    }
  }
  // The photo fills its box whatever the shapes: cover, never contain.
  const photos = code(`${DIR}/photos.tsx`);
  expect(photos).toContain("object-cover");
  expect(photos).not.toContain("object-contain");
});

test("touch targets are at least 48px, not scaled with the text", () => {
  const shared = code(`${DIR}/rest-shared.tsx`);
  expect(shared).toContain('export const TOUCH = "min-h-[48px] min-w-[48px]";');
  // Every button in the timers and the media player carries it.
  for (const file of ["timers", "media"]) {
    const src = code(`${DIR}/${file}.tsx`);
    const buttons = src.match(/<Button\b[\s\S]*?>/g) ?? [];
    expect(buttons.length, file).toBeGreaterThan(0);
    for (const b of buttons) expect(b, file).toContain("TOUCH");
  }
  // The schedule's child switcher, the week's days and a creature's cell too.
  expect(code(`${DIR}/schedule.tsx`)).toMatch(/className=\{`\$\{TOUCH\} rounded-full/);
  expect(code(`${DIR}/week-overview.tsx`)).toMatch(/className=\{`flex min-h-\[48px\]/);
  expect(code(`${DIR}/creatures.tsx`)).toContain("min-h-[48px] min-w-[48px]");
});

test("shared data comes from Home's context, never a second request", () => {
  for (const file of ["week-overview", "schedule", "pocket-money", "creatures"]) {
    const src = code(`${DIR}/${file}.tsx`);
    expect(src, file).toContain("useHomeDataContext()");
    expect(src, file).not.toMatch(/\buse(HomeData|HomeEvents|Events|People|Todos|Birthdays)\(/);
  }
  // The cards' hooks take the shared rows and switch their own queries off.
  const week = code("src/components/widgets/week-overview-widget.tsx");
  expect(week).toContain("useTodos({ enabled: own })");
  expect(week).toContain("useBirthdays({ enabled: own })");
  const schedule = code("src/components/widgets/schedule-widget.tsx");
  expect(schedule).toContain("usePeople({ enabled: !shared })");
});

test("the widgets reuse their card's logic instead of copying it", () => {
  const uses: Record<string, string> = {
    "week-overview": 'import { useWeekOverview } from "@/components/widgets/week-overview-widget";',
    schedule: "useScheduleDay,",
    "pocket-money": "usePocketMoneyValue",
    creatures: 'import { useCreatureCell } from "@/components/widgets/creatures-widget";',
    photos: 'import { useRotatingPhoto } from "@/components/widgets/photos-widget";',
    timers: 'import { mmss, useTimerControls } from "@/components/widgets/timer-widget";',
    media: 'import { useNowPlaying } from "@/components/widgets/media-player-widget";',
    vehicles: 'import { readVehicle, type VehicleEntityConfig } from "@/plugins/vehicles/readings";',
    stonks: 'from "@/plugins/stonks/drivers/yahoo-finance";',
  };
  for (const [file, line] of Object.entries(uses)) expect(code(`${DIR}/${file}.tsx`), file).toContain(line);
  // The cards themselves draw from the same hooks.
  expect(code("src/components/widgets/week-overview-widget.tsx")).toContain("} = useWeekOverview();");
  expect(code("src/components/widgets/schedule-widget.tsx")).toContain("} = useScheduleDay(propPersonId);");
  expect(code("src/components/widgets/pocket-money-widget.tsx")).toContain("usePocketMoneyValue(child);");
  expect(code("src/components/widgets/creatures-widget.tsx")).toContain("= useCreatureCell(person, creature, account, earned);");
  expect(code("src/components/widgets/photos-widget.tsx")).toContain("= useRotatingPhoto();");
  expect(code("src/components/widgets/timer-widget.tsx")).toContain("= useTimerControls();");
  expect(code("src/components/widgets/media-player-widget.tsx")).toContain("= useNowPlaying();");
});

test("no clock of their own beyond the cards': rotation as on the card, a playhead only while it shows", () => {
  const intervals: Record<string, number> = {};
  for (const file of Object.values(FILES)) intervals[file] = (code(`${DIR}/${file}.tsx`).match(/setInterval\(/g) ?? []).length;
  // The cards' own eight-second rotation, and the media playhead the player card ticks too.
  expect(intervals).toEqual({
    "week-overview": 0, schedule: 0, vehicles: 1, stonks: 1, "pocket-money": 0,
    creatures: 0, photos: 0, timers: 0, media: 1,
  });
  expect(code(`${DIR}/media.tsx`)).toContain('const ticking = step.progress && state.status === "playing" && state.duration !== undefined;');
});

test("dialogs and sheets open over the layout, not in the box", () => {
  // The browse sheet is the card's Sheet (a portal over the page).
  expect(code(`${DIR}/media.tsx`)).toContain("<MediaBrowseSheet");
  expect(read("src/components/media/browse-sheet.tsx")).toMatch(/from "@\/components\/ui\/sheet"/);
});

test("personIdOf reads options.personId and nothing else", () => {
  expect(personIdOf({ options: { personId: "p1" } })).toBe("p1");
  expect(personIdOf({ options: { personId: "" } })).toBeUndefined();
  expect(personIdOf({ options: { personId: 4 } })).toBeUndefined();
  expect(personIdOf({})).toBeUndefined();
});

test("creatureGrid picks the columns that make the creatures largest", () => {
  // One creature takes the box's short side less its lines.
  expect(creatureGrid(1, 300, 200, 8, 40)).toEqual({ cols: 1, size: 160 });
  // Four in a wide, flat box: one row of four.
  expect(creatureGrid(4, 800, 200, 8, 0).cols).toBe(4);
  // Four in a tall, narrow box: one column.
  expect(creatureGrid(4, 200, 800, 8, 0).cols).toBe(1);
  // Four in a square: two by two.
  expect(creatureGrid(4, 400, 400, 8, 0)).toEqual({ cols: 2, size: 196 });
});

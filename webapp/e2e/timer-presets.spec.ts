import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_TIMER_PRESETS,
  MAX_TIMER_PRESETS,
  MAX_TIMER_PRESET_MINUTES,
  isDefaultTimerPresets,
  isTimerWidgetSettings,
  timerPresets,
  withTimerPreset,
  withoutTimerPreset,
} from "../src/lib/timer-presets";
import { MAX_TIMER_SECONDS } from "../src/lib/timers";
import { codeOnly } from "./source-helpers";

/**
 * The timer widget's presets, Settings → Widgets → Timers: what the settings
 * route stores, what the widget makes of a stored value, how the editor adds
 * and removes, and the strings. No stack; timer-presets-ui.spec.ts drives the
 * page itself.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("a preset can be as long as a timer, and no longer", () => {
  expect(MAX_TIMER_PRESET_MINUTES * 60).toBe(MAX_TIMER_SECONDS);
});

test("the settings route takes 1 to 8 different whole minutes, and nothing else", () => {
  for (const good of [
    { presets: [3, 5, 10, 15] },
    { presets: [1] },
    { presets: [MAX_TIMER_PRESET_MINUTES] },
    { presets: [15, 3] },
    { presets: [1, 2, 3, 4, 5, 6, 7, 8] },
  ]) {
    expect(isTimerWidgetSettings(good), JSON.stringify(good)).toBe(true);
  }
  for (const bad of [
    null,
    undefined,
    [3, 5],
    "3,5",
    {},
    { presets: null },
    { presets: "5" },
    { presets: [] },
    { presets: [0] },
    { presets: [-5] },
    { presets: [2.5] },
    { presets: ["5"] },
    { presets: [MAX_TIMER_PRESET_MINUTES + 1] },
    { presets: [5, 5] },
    { presets: [Number.NaN] },
    { presets: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { presets: [3, 5], extra: true },
  ]) {
    expect(isTimerWidgetSettings(bad), JSON.stringify(bad) ?? String(bad)).toBe(false);
  }
});

test("the widget shows the family's presets smallest first, and the defaults without any", () => {
  expect(timerPresets(null)).toEqual([3, 5, 10, 15]);
  expect(timerPresets(undefined)).toEqual([3, 5, 10, 15]);
  expect(timerPresets({ presets: [20, 1, 7] })).toEqual([1, 7, 20]);
  // A row the route would have refused, written some other way: what can be
  // started is kept, and the buttons never all go.
  expect(timerPresets({ presets: [7, "9", 0, 7, 2.5, 90] })).toEqual([7, 90]);
  expect(timerPresets({ presets: [] })).toEqual([3, 5, 10, 15]);
  expect(timerPresets({ presets: [0, -1, "5"] })).toEqual([3, 5, 10, 15]);
  expect(timerPresets({ presets: "5" })).toEqual([3, 5, 10, 15]);
  expect(timerPresets([5])).toEqual([3, 5, 10, 15]);
  expect(timerPresets({ presets: [9, 8, 7, 6, 5, 4, 3, 2, 1] })).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // The defaults are handed out as a copy, so nobody can change them.
  const shown = timerPresets(null);
  shown.push(99);
  expect(DEFAULT_TIMER_PRESETS).toEqual([3, 5, 10, 15]);
});

test("adding keeps the order and refuses a repeat, a bad number and a ninth", () => {
  expect(withTimerPreset([3, 5, 10, 15], 7)).toEqual([3, 5, 7, 10, 15]);
  expect(withTimerPreset([3, 5], 1)).toEqual([1, 3, 5]);
  expect(withTimerPreset([3, 5], 90)).toEqual([3, 5, 90]);
  expect(withTimerPreset([3, 5], 5)).toEqual([3, 5]);
  expect(withTimerPreset([3, 5], 0)).toEqual([3, 5]);
  expect(withTimerPreset([3, 5], 2.5)).toEqual([3, 5]);
  expect(withTimerPreset([3, 5], MAX_TIMER_PRESET_MINUTES + 1)).toEqual([3, 5]);
  const full = [1, 2, 3, 4, 5, 6, 7, 8];
  expect(full).toHaveLength(MAX_TIMER_PRESETS);
  expect(withTimerPreset(full, 9)).toEqual(full);
  // Every list the editor can make, the route accepts.
  expect(isTimerWidgetSettings({ presets: withTimerPreset([3, 5, 10, 15], 7) })).toBe(true);
});

test("removing never takes the last preset", () => {
  expect(withoutTimerPreset([3, 5, 10, 15], 15)).toEqual([3, 5, 10]);
  expect(withoutTimerPreset([3, 5], 3)).toEqual([5]);
  expect(withoutTimerPreset([5], 5)).toEqual([5]);
  expect(withoutTimerPreset([3, 5], 7)).toEqual([3, 5]);
});

test("only a list other than 3, 5, 10 and 15 counts as the family's own", () => {
  expect(isDefaultTimerPresets([3, 5, 10, 15])).toBe(true);
  expect(isDefaultTimerPresets(timerPresets(null))).toBe(true);
  expect(isDefaultTimerPresets([3, 5, 10])).toBe(false);
  expect(isDefaultTimerPresets([3, 5, 10, 15, 20])).toBe(false);
  expect(isDefaultTimerPresets([15, 10, 5, 3])).toBe(false);
});

test("the widget reads the family's presets, and has no list of its own", () => {
  const widget = codeOnly(read("src/components/widgets/timer-widget.tsx"));
  expect(widget).toContain("useTimerPresets()");
  expect(widget).toContain("presets.map(");
  expect(widget).not.toMatch(/\[\s*3\s*,\s*5\s*,\s*10\s*,\s*15\s*\]/);
  const hook = codeOnly(read("src/hooks/use-timer-presets.ts"));
  expect(hook).toContain("useSetting<unknown>(SETTINGS_KEYS.timerWidget, null)");
  expect(hook).toContain("timerPresets(data)");
});

test("while the family's presets load, or if reading them fails, the widget shows the defaults", () => {
  // useSetting's data is undefined until the read succeeds, and stays so if it fails.
  expect(timerPresets(undefined)).toEqual([...DEFAULT_TIMER_PRESETS]);
  const hook = codeOnly(read("src/hooks/use-timer-presets.ts"));
  expect(hook).toMatch(/const presets = timerPresets\(data\);/);
  // The widget does not hold its buttons back on loading or on an error.
  const widget = codeOnly(read("src/components/widgets/timer-widget.tsx"));
  expect(widget).toContain("{presets.map((minutes) => (");
  expect(widget).not.toMatch(/presetsLoading|isLoading|isError/);
});

test("the settings route checks the presets before anything is written", () => {
  const route = codeOnly(read("src/app/api/settings/route.ts"));
  const put = route.slice(route.indexOf("export async function PUT"), route.indexOf("export async function DELETE"));
  const check = put.indexOf("key === SETTINGS_KEYS.timerWidget && !isTimerWidgetSettings(value)");
  expect(check, "PUT checks the presets").toBeGreaterThan(-1);
  expect(check, "before the admin client is made").toBeLessThan(put.indexOf("createAdminClient()"));
  expect(put.slice(check, check + 300)).toContain("status: 400");
});

test("a save waits for the refetch, so the next tap starts from it", () => {
  const hook = codeOnly(read("src/hooks/use-timer-presets.ts"));
  const success = hook.slice(hook.indexOf("onSuccess"));
  expect(success).toContain("queryClient.setQueryData(queryKey, presets ? { presets } : null)");
  expect(success).toContain("return queryClient.invalidateQueries({ queryKey })");
  // Back to the defaults is no value: the setting is deleted.
  expect(hook).toContain('method: presets ? "PUT" : "DELETE"');
  const editor = codeOnly(read("src/components/settings/timer-presets-editor.tsx"));
  expect(editor).toContain("const busy = disabled || isLoading || save.isPending;");
  expect(editor).toContain("disabled={busy || presets.length === 1}");
  // A time typed while the last one saves is kept.
  expect(editor).toContain('setDraft((now) => (now === added ? "" : now))');
});

test("the editor sits under the Timers widget in Settings → Widgets", () => {
  const page = codeOnly(read("src/app/settings/widgets/page.tsx"));
  expect(page).toContain('{widget.key === "timers" && <TimerPresetsEditor disabled={!enabled} />}');
});

test("the editor's strings exist in every language, with their placeholders", () => {
  const placeholders: Record<string, string[]> = {
    timersPresetsLabel: [],
    timersPresetsDescription: ["{max}"],
    timersPresetsRemove: ["{minutes}"],
    timersPresetsMinutes: [],
    timersPresetsAddLabel: [],
    timersPresetsAdd: [],
    timersPresetsRange: ["{max}"],
    timersPresetsAlready: ["{minutes}"],
    timersPresetsFull: ["{max}"],
    timersPresetsReset: [],
    timersPresetsSaveFailed: [],
  };
  for (const locale of ["en", "de", "fr"]) {
    const strings = JSON.parse(read(`messages/${locale}.json`)).settings.widgets;
    for (const [key, needed] of Object.entries(placeholders)) {
      expect(typeof strings[key], `${locale}.${key}`).toBe("string");
      expect(strings[key].trim(), `${locale}.${key}`).not.toBe("");
      for (const placeholder of needed) expect(strings[key], `${locale}.${key}`).toContain(placeholder);
    }
  }
});

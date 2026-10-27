import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A palette is the overall colour of the screen; the month is the accent and
 * a wash over the page. In dark mode the palettes sat at 11-16% saturation and
 * 9-12% lightness, within 1.3-6 Delta E of each other (Sand and Warm grey
 * 1.3, i.e. the same colour), so on a wall display choosing one changed
 * nothing anyone could see. These pin that they stay apart, stay readable,
 * that the picker shows them as they are, and that the month's wash is on
 * every page. No stack.
 */
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const css = read("src/app/globals.css");
const themePage = read("src/app/settings/theme/page.tsx");

/** The custom properties of the first rule with exactly this selector. */
function tokens(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} is defined in globals.css`).not.toBeNull();
  return Object.fromEntries(
    [...match![2].matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

function rgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hsl: string) => {
  const [r, g, b] = rgb(hsl).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** CIE76 Delta E: about 2.3 is the smallest difference people notice. */
function deltaE(a: string, b: string): number {
  const lab = (hsl: string) => {
    const [r, g, bl] = rgb(hsl).map(linear);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// Sand is the base: no palette class, so its dark tokens are `.dark`.
const DARK: Record<string, string> = {
  sand: ".dark",
  salbei: ".dark.palette-salbei",
  warmgrey: ".dark.palette-warmgrey",
  graphite: ".dark.palette-graphite",
};
const LIGHT: Record<string, string> = {
  sand: ":root",
  salbei: ".palette-salbei",
  warmgrey: ".palette-warmgrey",
  graphite: ".palette-graphite",
};

test("in dark mode no two palettes look alike", () => {
  const ids = Object.keys(DARK);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [tokens(DARK[ids[i]]), tokens(DARK[ids[j]])];
      expect(deltaE(a.card, b.card), `${ids[i]} / ${ids[j]} cards`).toBeGreaterThanOrEqual(5);
      expect(deltaE(a.background, b.background), `${ids[i]} / ${ids[j]} backgrounds`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("the tinted dark palettes keep their text readable", () => {
  for (const id of ["sand", "salbei", "warmgrey"]) {
    const t = tokens(DARK[id]);
    for (const surface of ["background", "card", "secondary", "muted"]) {
      expect(contrast(t.foreground, t[surface]), `${id}: foreground on ${surface}`).toBeGreaterThanOrEqual(7);
      for (const text of ["muted-foreground", "label-foreground"]) {
        expect(contrast(t[text], t[surface]), `${id}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test("the picker's swatches are the palettes' own colours, in light and in dark", () => {
  for (const [id, mode, selector] of [
    ...Object.entries(LIGHT).map(([id, sel]) => [id, "light", sel]),
    ...Object.entries(DARK).map(([id, sel]) => [id, "dark", sel]),
  ]) {
    const t = tokens(selector);
    const entry = new RegExp(`id: "${id}",[\\s\\S]*?${mode}: \\{ bg: "([^"]+)", card: "([^"]+)", border: "([^"]+)"`).exec(themePage);
    expect(entry, `${id} ${mode} swatch`).not.toBeNull();
    expect([entry![1], entry![2], entry![3]], `${id} ${mode}`).toEqual([t.background, t.card, t.border]);
  }
  expect(themePage).toContain("({ id, ...(isDarkMode ? dark : light) })");
});

test("the month's wash is one layer behind every page, stronger in dark mode", () => {
  expect(css).toMatch(/body \{\s*position: relative;\s*z-index: 0;\s*\}/);
  const before = /body::before \{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const rule of ["position: fixed;", "inset: 0;", "z-index: -1;", "pointer-events: none;"]) {
    expect(before).toContain(rule);
  }
  expect(before).toContain("hsl(var(--month-primary) / var(--month-wash-top))");
  expect(before).toContain("hsl(var(--month-primary) / var(--month-wash-bottom))");
  const light = /:root \{ --month-wash-top: ([\d.]+); --month-wash-bottom: ([\d.]+); \}/.exec(css);
  const dark = /\.dark \{ --month-wash-top: ([\d.]+); --month-wash-bottom: ([\d.]+); \}/.exec(css);
  expect(light && dark).toBeTruthy();
  expect(Number(dark![1])).toBeGreaterThan(Number(light![1]));
  expect(Number(dark![1])).toBeGreaterThanOrEqual(0.1);
  // The old per-page gradient would draw a second wash over the first.
  expect(css).toMatch(/\.page-gradient \{\s*display: none;\s*\}/);
  // Nothing else may sit at a negative z-index: inside body's stacking
  // context it would land under the wash.
  expect(css.match(/z-index: *-/g)?.length).toBe(1);
});

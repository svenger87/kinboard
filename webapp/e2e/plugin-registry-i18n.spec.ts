import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every registered plugin and widget must have copy in every language.
 *
 * The Photos plugin shipped in 1.9.0-rc.7 without `settings.plugins.label.photos`,
 * and next-intl renders a missing key as the key — so the plugins page listed
 * a switch labelled `label.photos` on a kitchen wall. Nothing failed: the page
 * rendered, the switch worked, and the only symptom was a name no one had
 * written.
 *
 * The bundles are checked as data rather than through the app, because the
 * failure is a *missing* key and there is no screen that proves the absence of
 * one. These read the same registry the app does, so a plugin added tomorrow
 * is covered without touching this file.
 */

const SRC = join(__dirname, "..", "src");
const MESSAGES = join(__dirname, "..", "messages");
const LOCALES = ["en", "de", "fr"] as const;

const bundles = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(MESSAGES, `${l}.json`), "utf8"))]),
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

function lookup(bundle: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part];
    return undefined;
  }, bundle);
}

/** Plugin ids, read from the plugins the registry actually imports. */
function registeredPluginIds(): string[] {
  const registry = readFileSync(join(SRC, "plugins", "registry.ts"), "utf8");
  const ids: string[] = [];

  for (const dir of readdirSync(join(SRC, "plugins"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let source: string;
    try {
      source = readFileSync(join(SRC, "plugins", dir.name, "index.ts"), "utf8");
    } catch {
      continue;
    }
    const id = source.match(/\bid:\s*"([^"]+)"/)?.[1];
    const exported = source.match(/export const (\w+Plugin)\b/)?.[1];
    // Only the ones the registry lists — a directory alone is not registration.
    if (id && exported && new RegExp(`\\b${exported}\\b`).test(registry)) ids.push(id);
  }
  return ids;
}

/** Widget keys and the message keys the settings page asks for, from that page. */
function widgetMessageKeys(): { key: string; keys: string[] }[] {
  const page = readFileSync(join(SRC, "app", "settings", "widgets", "page.tsx"), "utf8");
  const out: { key: string; keys: string[] }[] = [];

  for (const line of page.split("\n")) {
    const key = line.match(/\{\s*key:\s*"([^"]+)"/)?.[1];
    if (!key) continue;
    const labelKey = line.match(/labelKey:\s*"([^"]+)"/)?.[1];
    const descriptionKey = line.match(/descriptionKey:\s*"([^"]+)"/)?.[1];
    if (!labelKey || !descriptionKey) continue;
    const previews = [...line.matchAll(/"(\w+Preview\d)"/g)].map((m) => m[1]);
    out.push({ key, keys: [labelKey, descriptionKey, ...previews] });
  }
  return out;
}


/** Each plugin's declared nav item: href and the label key it asks for. */
function pluginNavItems(): { id: string; href: string; labelKey: string }[] {
  const out: { id: string; href: string; labelKey: string }[] = [];

  for (const dir of readdirSync(join(SRC, "plugins"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let source: string;
    try {
      source = readFileSync(join(SRC, "plugins", dir.name, "index.ts"), "utf8");
    } catch {
      continue;
    }
    const id = source.match(/\bid:\s*"([^"]+)"/)?.[1];
    const nav = source.match(/navItem:\s*\{([\s\S]*?)\}/)?.[1];
    if (!id || !nav) continue;
    const href = nav.match(/href:\s*"([^"]+)"/)?.[1];
    const labelKey = nav.match(/labelKey:\s*"([^"]+)"/)?.[1];
    if (href && labelKey) out.push({ id, href, labelKey });
  }
  return out;
}

test.describe("plugin and widget copy", () => {
  test("the registry is not empty, so an empty pass cannot look green", () => {
    expect(registeredPluginIds().length).toBeGreaterThanOrEqual(5);
    expect(widgetMessageKeys().length).toBeGreaterThanOrEqual(10);
  });

  test("every registered plugin is named and described, in every language", () => {
    const missing: string[] = [];

    for (const id of registeredPluginIds()) {
      for (const locale of LOCALES) {
        for (const path of [`settings.plugins.label.${id}`, `settings.plugins.description.${id}`]) {
          const value = lookup(bundles[locale], path);
          if (typeof value !== "string" || value.trim() === "") {
            missing.push(`${locale}: ${path}`);
          }
        }
      }
    }

    expect(missing, `Plugins settings page would render the key itself:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  test("every widget the settings page offers has its copy", () => {
    const missing: string[] = [];

    for (const { key, keys } of widgetMessageKeys()) {
      for (const locale of LOCALES) {
        for (const name of keys) {
          const value = lookup(bundles[locale], `settings.widgets.${name}`);
          if (typeof value !== "string" || value.trim() === "") {
            missing.push(`${locale}: settings.widgets.${name} (widget "${key}")`);
          }
        }
      }
    }

    expect(missing, `Widget settings would render the key itself:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  test("a plugin with a dashboard widget can be switched on from the widgets page", () => {
    // The two lists are maintained by hand and in different files: a plugin can
    // ship a widget that nothing on /settings/widgets can enable, which is what
    // "make sure the user can enable it" means in practice.
    const widgetKeys = new Set(widgetMessageKeys().map((w) => w.key));
    const withWidgets: string[] = [];

    for (const dir of readdirSync(join(SRC, "plugins"), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      let source: string;
      try {
        source = readFileSync(join(SRC, "plugins", dir.name, "index.ts"), "utf8");
      } catch {
        continue;
      }
      if (!/dashboardWidget:\s*(?!undefined)\w/.test(source)) continue;
      const id = source.match(/\bid:\s*"([^"]+)"/)?.[1];
      if (id) withWidgets.push(id);
    }

    expect(withWidgets.length).toBeGreaterThan(0);

    // `pocket-money` is `pocketMoney` in the visibility blob — compare loosely.
    const normalise = (s: string) => s.replace(/[^a-z]/gi, "").toLowerCase();
    const normalised = new Set([...widgetKeys].map(normalise));
    const unreachable = withWidgets.filter((id) => !normalised.has(normalise(id)));

    expect(unreachable, `These plugins ship a dashboard widget with no switch: ${unreachable.join(", ")}`)
      .toEqual([]);
  });

  test("a plugin's nav entry is one the navigation can actually render", () => {
    // `useVisibleNavItems` *filters* NAV_ITEMS — it does not append plugin
    // entries — so a plugin that declares a navItem whose href is missing from
    // that list has an entry which can never appear, however its visibility
    // predicate answers. Photos shipped exactly that way in 1.9.0-rc.7: the
    // page existed, the plugin declared it, and the bottom bar never showed it.
    const constants = readFileSync(join(SRC, "lib", "constants.ts"), "utf8");
    const missing: string[] = [];

    for (const { id, href, labelKey } of pluginNavItems()) {
      if (!constants.includes(`href: "${href}"`)) {
        missing.push(`${id}: ${href} is not in NAV_ITEMS`);
        continue;
      }
      for (const locale of LOCALES) {
        const value = lookup(bundles[locale], `nav.${labelKey}`);
        if (typeof value !== "string" || value.trim() === "") {
          missing.push(`${id}: ${locale} nav.${labelKey} is missing`);
        }
      }
    }

    expect(missing, `Nav entries that cannot appear:\n  ${missing.join("\n  ")}`).toEqual([]);
  });
});

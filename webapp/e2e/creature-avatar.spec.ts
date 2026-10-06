import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatureAvatar } from "../src/components/pocket-money/creature-avatar";
import {
  AVATAR_STYLES,
  DRAWN_STYLES,
  effectiveStyle,
  hasDrawnArt,
  resolveStyle,
  restorableAvatarStyle,
  STYLES,
} from "../src/lib/pocket-money/creatures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import avatarCatalog from "../src/plugins/pocket-money/catalog/avatars.json";
import type { AvatarTier } from "../src/lib/pocket-money/types";

/**
 * The drawn avatars (lib/pocket-money/creatures, components/pocket-money/
 * creature-avatar): every style draws every stage, two creatures on one page
 * never share a gradient or filter id, and anything not drawn -- the classic
 * style, or a species without a module -- is the classic picture, unchanged.
 *
 * Rendered with react-dom/server, so no browser and no stack: these are unit
 * tests that happen to live with the other specs.
 */

const TIERS: AvatarTier[] = [1, 2, 3, 4, 5, 6, 7, 8];
const render = (props: Parameters<typeof CreatureAvatar>[0]) => renderToStaticMarkup(createElement(CreatureAvatar, props));
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refs = (html: string) => [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

test.describe("every style draws every stage", () => {
  for (const style of DRAWN_STYLES) {
    for (const tier of TIERS) {
      test(`${style}, stage ${tier}`, () => {
        const html = render({ species: "dragon", tier, style });
        expect(html).toContain(`data-avatar-style="${style}"`);
        expect(html).toContain(`data-tier="${tier}"`);
        expect(html).not.toContain("<img");
        // The style's own colours: the shell for the egg, the body (or its
        // gradient) once it has hatched.
        if (tier === 1) expect(html).toContain(STYLES[style].pal.shell);
        else expect(html).toContain(STYLES[style].glow ? "-body)" : STYLES[style].pal.body);
        // Every url(#…) points at an id this drawing defines.
        const own = new Set(ids(html));
        for (const ref of refs(html)) expect(own.has(ref), ref).toBe(true);
        // The stage's own parts: the egg has no eyes, the crown is stage 8's.
        expect(html.includes("creature-blink")).toBe(tier > 1);
        expect(html.includes('data-part="crown"')).toBe(tier === 8);
        expect(html.includes('data-part="wings"')).toBe(tier >= 5);
      });
    }
  }

  test("the stages differ from each other", () => {
    for (const style of DRAWN_STYLES) {
      const drawings = new Set(TIERS.map((tier) => render({ species: "dragon", tier, style })));
      expect(drawings.size).toBe(8);
    }
  });

  test("a cracked egg shows the crack, and only when asked", () => {
    expect(render({ species: "dragon", tier: 1, style: "gumdrop", cracked: true })).toContain('data-part="crack"');
    expect(render({ species: "dragon", tier: 1, style: "gumdrop" })).not.toContain('data-part="crack"');
  });

  test("sticker has outlines and the sticker edge; gumdrop has neither; storybook glows", () => {
    const sticker = render({ species: "dragon", tier: 6, style: "sticker" });
    expect(sticker).toContain('stroke="#2B2340"');
    expect(sticker).toMatch(/filter="url\(#[^)]+-sticker\)"/);
    const gumdrop = render({ species: "dragon", tier: 6, style: "gumdrop" });
    expect(gumdrop).not.toContain("<filter");
    expect(gumdrop).not.toContain("radialGradient");
    const storybook = render({ species: "dragon", tier: 6, style: "storybook" });
    expect(storybook).toMatch(/fill="url\(#[^)]+-glow\)"/);
  });

  test("sleepy closes the eyes and adds the z's", () => {
    const html = render({ species: "dragon", tier: 4, style: "gumdrop", mood: "sleepy" });
    expect(html).toContain("creature-zzz");
    expect(html).not.toContain("creature-blink");
  });

  test("idle motion only when animated", () => {
    expect(render({ species: "dragon", tier: 5, style: "gumdrop" })).toContain("creature-animated");
    expect(render({ species: "dragon", tier: 5, style: "gumdrop", animated: false })).not.toContain("creature-animated");
  });
});

test.describe("ids are unique per instance", () => {
  test("two creatures of the same style on one page define different ids", () => {
    for (const style of ["sticker", "storybook"] as const) {
      const html = renderToStaticMarkup(
        createElement("div", null,
          createElement(CreatureAvatar, { species: "dragon", tier: 6, style }),
          createElement(CreatureAvatar, { species: "dragon", tier: 6, style }),
          createElement(CreatureAvatar, { species: "dragon", tier: 1, style }),
        ),
      );
      const all = ids(html);
      expect(all.length).toBeGreaterThan(2);
      expect(new Set(all).size).toBe(all.length);
      // and each id is safe inside url(#…)
      for (const id of all) expect(id).toMatch(/^[A-Za-z0-9-]+$/);
      for (const ref of refs(html)) expect(all).toContain(ref);
    }
  });
});

test.describe("what is not drawn is the classic picture", () => {
  test("classic shows the classic SVG for every species and stage", () => {
    for (const s of avatarCatalog.species) {
      for (const tier of TIERS) {
        const html = render({ species: s.id, tier, style: "classic" });
        expect(html).toContain(`<img`);
        expect(html).toContain(`src="${s.stages[tier - 1].src}"`);
        expect(html).not.toContain("<svg");
      }
    }
  });

  test("a species without drawings is classic in every style", () => {
    const undrawn = avatarCatalog.species.map((s) => s.id).filter((id) => !hasDrawnArt(id));
    expect(undrawn.sort()).toEqual(["astronaut", "cat", "plant", "wizard"]);
    for (const species of undrawn) {
      for (const style of AVATAR_STYLES) {
        const html = render({ species, tier: 3, style });
        expect(html).toContain(`src="/pocket-money/avatars/${species}-3.svg"`);
        expect(html).not.toContain("<svg");
        expect(effectiveStyle(species, style)).toBe("classic");
      }
    }
  });

  test("no style, or one the app does not know, is classic", () => {
    for (const style of [undefined, null, "", "neon", "constructor"]) {
      expect(effectiveStyle("dragon", style)).toBe("classic");
      expect(render({ species: "dragon", tier: 2, style })).toContain(`src="/pocket-money/avatars/dragon-2.svg"`);
    }
  });

  test("the dragon in a drawn style is drawn", () => {
    for (const style of DRAWN_STYLES) expect(effectiveStyle("dragon", style)).toBe(style);
  });
});

test.describe("the look hook", () => {
  test("a look's palette overrides the style's, in one place, without touching the style", () => {
    const before = STYLES.gumdrop.pal.body;
    const resolved = resolveStyle("gumdrop", { palette: { body: "#123456" } });
    expect(resolved.pal.body).toBe("#123456");
    expect(resolved.pal.belly).toBe(STYLES.gumdrop.pal.belly);
    expect(STYLES.gumdrop.pal.body).toBe(before);
    const html = render({ species: "dragon", tier: 4, style: "gumdrop", look: { palette: { body: "#123456" } } });
    expect(html).toContain("#123456");
  });
});

test.describe("tapping", () => {
  test("a tappable avatar is one button with an accessible name, its drawing hidden from the reader", () => {
    const html = render({ species: "dragon", tier: 3, style: "gumdrop", tappable: true, tapLabel: "Tap Mo's dragon" });
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Tap Mo&#x27;s dragon"');
    expect(html).toContain('aria-hidden="true"');
  });
});

test.describe("export and import", () => {
  test("a restore writes one of the four styles: an unknown or missing value becomes classic", () => {
    for (const style of AVATAR_STYLES) expect(restorableAvatarStyle(style)).toBe(style);
    for (const bad of ["neon", "", null, undefined, 3, { s: "sticker" }]) expect(restorableAvatarStyle(bad)).toBe("classic");
  });

  test("the import runs it on every account row, and the export takes the whole row", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const imp = read("src/app/api/import/route.ts");
    const spec = imp.slice(imp.indexOf('spec("pocket_money_accounts"'), imp.indexOf('spec("pocket_money_goals"'));
    expect(spec).toContain("row.avatar_style = restorableAvatarStyle(row.avatar_style)");
    expect(imp).toMatch(/tableSpec\.normalize\?\.\(out\);\s*return out;/);
    const exp = read("src/app/api/export/route.ts");
    expect(exp).toMatch(/from\("pocket_money_accounts"\)\.select\("\*"\)/);
  });
});

import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CreatureAvatar } from "../src/components/pocket-money/creature-avatar";
import {
  AVATAR_CATALOG,
  DRAWN_SPECIES_IDS,
  DRAWN_STYLES,
  hasClassicArt,
  speciesArt,
  type OriginKind,
} from "../src/lib/pocket-money/creatures";
import type { AvatarTier } from "../src/lib/pocket-money/types";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";

/**
 * The fourteen drawn creatures (RFC-016 §3): every creature, in every style,
 * draws every stage -- something, not an empty frame -- with SVG ids unique
 * to the drawing; each grows the way the workshop drew it; the catalogue,
 * the allow-lists and the stage names in en/de/fr all know every one.
 *
 * Rendered with react-dom/server, so no browser and no stack.
 */

const TIERS: AvatarTier[] = [1, 2, 3, 4, 5, 6, 7, 8];
const render = (props: Parameters<typeof CreatureAvatar>[0]) => renderToStaticMarkup(createElement(CreatureAvatar, props));
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refs = (html: string) => [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
/** Shapes drawn: what a stage that "draws nothing" would lack. */
const shapes = (html: string) => (html.match(/<(path|circle|ellipse|rect)\b/g) ?? []).length;
const has = (html: string, part: string) => html.includes(`data-part="${part}"`);

const FOURTEEN = ["dragon", "cat", "axolotl", "owl", "robot", "unicorn", "fox", "penguin", "bunny", "rex", "trike", "stego", "princess", "prince"];
const NEW_SPECIES = FOURTEEN.filter((s) => s !== "dragon" && s !== "cat");

test("the fourteen are drawn, and nothing else is", () => {
  expect([...DRAWN_SPECIES_IDS].sort()).toEqual([...FOURTEEN].sort());
});

test.describe("every creature × style × stage renders", () => {
  for (const species of FOURTEEN) {
    test(species, () => {
      for (const style of DRAWN_STYLES) {
        const seen = new Set<string>();
        for (const tier of TIERS) {
          for (const mood of ["happy", "sleepy"] as const) {
            const html = render({ species, tier, style, mood });
            const where = `${species} ${style} ${tier} ${mood}`;
            expect(html, where).toContain(`data-avatar-style="${style}"`);
            expect(html, where).toContain(`data-tier="${tier}"`);
            expect(html, where).not.toContain("<img");
            expect(html, where).not.toMatch(/NaN|undefined|null/);
            // draws something: the shadow alone is one ellipse
            expect(shapes(html), where).toBeGreaterThan(tier === 1 ? 5 : 8);
            // every id is unique and url-safe, every url(#…) resolves
            const own = ids(html);
            expect(new Set(own).size, where).toBe(own.length);
            for (const id of own) expect(id, where).toMatch(/^[A-Za-z0-9-]+$/);
            for (const ref of refs(html)) expect(own, `${where}: ${ref}`).toContain(ref);
            // the style's effects
            expect(html.includes("<filter"), where).toBe(style === "sticker");
            expect(html.includes("radialGradient"), where).toBe(style === "storybook");
            if (mood === "happy") seen.add(html);
            // eyes open from the hatchling on (sleepy closes them)
            if (mood === "happy" && tier > 1) expect(html, where).toContain("creature-blink");
            if (mood === "sleepy" && tier > 1) expect(html, where).toContain("creature-zzz");
            // the crown is stage 8's, or the cushion's at stage 1
            const origin = speciesArt(species)!.origin ?? "egg";
            expect(has(html, "crown"), where).toBe(tier === 8 || (tier === 1 && origin === "cushion"));
          }
        }
        expect(seen.size, `${species} ${style}: eight different stages`).toBe(8);
      }
    });
  }

  test("two of every creature on one page never share an id", () => {
    for (const style of ["sticker", "storybook"] as const) {
      const html = renderToStaticMarkup(
        createElement(
          "div",
          null,
          ...FOURTEEN.flatMap((species) => [
            createElement(CreatureAvatar, { species, tier: 6, style, key: `${species}-a` }),
            createElement(CreatureAvatar, { species, tier: 6, style, key: `${species}-b` }),
          ]),
        ),
      );
      const all = ids(html);
      expect(all.length).toBeGreaterThanOrEqual(28);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

test.describe("each grows the way the workshop drew it", () => {
  const at = (species: string, tier: AvatarTier, style: "gumdrop" | "sticker" | "storybook" = "gumdrop") => render({ species, tier, style });

  test("each starts somewhere of its own", () => {
    const expected: Record<string, OriginKind> = {
      dragon: "egg", cat: "basket", axolotl: "jelly", owl: "egg", robot: "box", unicorn: "starEgg", fox: "leaves",
      penguin: "egg", bunny: "basket", rex: "egg", trike: "egg", stego: "egg", princess: "cushion", prince: "cushion",
    };
    for (const species of FOURTEEN) expect(speciesArt(species)!.origin ?? "egg", species).toBe(expected[species]);
    // the egg kinds crack before they hatch; a basket has nothing to crack
    for (const species of ["rex", "unicorn", "axolotl"]) expect(render({ species, tier: 1, style: "gumdrop", cracked: true })).toContain('data-part="crack"');
    expect(render({ species: "cat", tier: 1, style: "gumdrop", cracked: true })).not.toContain('data-part="crack"');
    // the star egg has stars where the egg has spots
    expect(at("unicorn", 1).match(/<circle/g)?.length ?? 0).toBeLessThan(at("rex", 1).match(/<circle/g)?.length ?? 0);
  });

  test("their own colours in every style", () => {
    for (const species of NEW_SPECIES.concat("cat")) {
      const body = speciesArt(species)!.colors!.body;
      for (const style of ["gumdrop", "sticker"] as const) expect(at(species, 5, style), `${species} ${style}`).toContain(body);
    }
    // the people's skin tone and hair
    expect(at("princess", 4)).toContain("#F2C8A0");
    expect(at("prince", 4)).toContain("#D9A27A");
    expect(at("princess", 4)).toContain("#8B5A2B");
  });

  test("the T-Rex: a ridge from 4, one spike more each stage, and teeth", () => {
    for (const tier of TIERS.slice(1)) {
      const html = at("rex", tier);
      expect(has(html, "ridge")).toBe(tier >= 4);
      expect(has(html, "teeth")).toBe(tier >= 4);
    }
    const spikes = (tier: AvatarTier) => at("rex", tier).split('data-part="ridge"')[1].split("</g>")[0].match(/<circle/g)!.length;
    expect([4, 5, 6, 7, 8].map((t) => spikes(t as AvatarTier))).toEqual([2, 3, 4, 5, 6]);
  });

  test("the unicorn: horn from 3, a rainbow mane from 5, wings from 6", () => {
    for (const tier of TIERS.slice(1)) {
      const html = at("unicorn", tier);
      expect(has(html, "horn")).toBe(tier >= 3);
      expect(has(html, "wings")).toBe(tier >= 6);
      expect(html.includes("#5FD39A")).toBe(tier >= 5);
    }
  });

  test("the cat: a scarf from 5, a mane from 6", () => {
    for (const tier of TIERS.slice(2)) {
      expect(has(at("cat", tier), "scarf")).toBe(tier >= 5);
      expect(has(at("cat", tier), "mane")).toBe(tier >= 6);
    }
  });

  test("the fox: one tail, three at 7, five at 8", () => {
    expect([3, 6, 7, 8].map((t) => at("fox", t as AvatarTier).match(/data-count="(\d)"/)![1])).toEqual(["1", "1", "3", "5"]);
  });

  test("the axolotl's gills wave and grow; it glows from 7", () => {
    const html = at("axolotl", 5);
    expect(html).toContain("creature-gill");
    expect(html).toContain("creature-gill-r");
    expect(has(at("axolotl", 6), "glow")).toBe(false);
    expect(has(at("axolotl", 7), "glow")).toBe(true);
    const gill = (t: AvatarTier) => Number(at("axolotl", t).match(/creature-gill"><ellipse cx="[^"]+" cy="[^"]+" rx="([^"]+)"/)![1]);
    expect(gill(8)).toBeGreaterThan(gill(3));
  });

  test("the robot's lights blink from 4; jets at 5, shoulder plates at 6", () => {
    expect(at("robot", 3)).not.toContain("creature-led");
    expect(at("robot", 4).match(/creature-led/g)!.length).toBe(4);
    expect(has(at("robot", 4), "jets")).toBe(false);
    expect(has(at("robot", 5), "jets")).toBe(true);
    expect(has(at("robot", 6), "shoulders")).toBe(true);
  });

  test("the owl: glasses from 6, the cap at 7 only; the penguin: scarf at 6, golden cheeks at 7", () => {
    expect(has(at("owl", 5), "glasses")).toBe(false);
    expect(has(at("owl", 6), "glasses")).toBe(true);
    expect([6, 7, 8].map((t) => has(at("owl", t as AvatarTier), "cap"))).toEqual([false, true, false]);
    expect(has(at("penguin", 6), "scarf")).toBe(true);
    expect(has(at("penguin", 6), "gold-cheek")).toBe(false);
    expect(has(at("penguin", 7), "gold-cheek")).toBe(true);
  });

  test("the bunny's ears grow every stage; a carrot from 6, the moon glow from 7", () => {
    const len = (t: AvatarTier) => Number(at("bunny", t).match(/data-len="([^"]+)"/)![1]);
    for (let t = 3; t < 8; t++) expect(len((t + 1) as AvatarTier)).toBeGreaterThan(len(t as AvatarTier));
    expect(has(at("bunny", 5), "carrot")).toBe(false);
    expect(has(at("bunny", 6), "carrot")).toBe(true);
    expect(has(at("bunny", 7), "moon-glow")).toBe(true);
  });

  test("the triceratops: nose horn from 3, brow horns from 4; the frill grows", () => {
    expect(has(at("trike", 3), "nose-horn")).toBe(true);
    expect(has(at("trike", 3), "brow-horns")).toBe(false);
    expect(has(at("trike", 4), "brow-horns")).toBe(true);
    const frill = (t: AvatarTier) => Number(at("trike", t).match(/data-part="frill"><ellipse cx="[^"]+" cy="[^"]+" rx="([^"]+)"/)![1]);
    expect(frill(8)).toBeGreaterThan(frill(3));
  });

  test("the stegosaurus: plates stand up in a row, more each stage, and a spiked tail from 5", () => {
    expect([3, 4, 5, 6, 7, 8].map((t) => at("stego", t as AvatarTier).match(/data-part="plates" data-count="(\d)"/)![1])).toEqual(["4", "5", "6", "7", "8", "9"]);
    for (const tier of [3, 8] as AvatarTier[]) {
      const plates = at("stego", tier).split('data-part="plates"')[1].split("</g>")[0];
      const placed = [...plates.matchAll(/translate\(([\d.-]+) ([\d.-]+)\) rotate\(([\d.-]+)\)/g)].map((m) => m.slice(1).map(Number));
      expect(placed.length).toBeGreaterThanOrEqual(4);
      for (const [x, y, rot] of placed) {
        // upright: never leaning more than 20 degrees (the workshop's fanned out to ±76)
        expect(Math.abs(rot)).toBeLessThanOrEqual(20);
        // above the shoulders and the back, within the body's width
        expect(x).toBeGreaterThanOrEqual(60);
        expect(x).toBeLessThanOrEqual(140);
        expect(y).toBeLessThan(138);
      }
    }
    expect(has(at("stego", 4), "tail-spikes")).toBe(false);
    expect(has(at("stego", 5), "tail-spikes")).toBe(true);
  });

  test("the princess: tiara 2-7, wand from 5, cape from 6; the prince: circlet 3-7, sword from 5, shield and cape from 6", () => {
    for (const tier of TIERS.slice(1)) {
      const p = at("princess", tier);
      expect(has(p, "tiara"), `princess ${tier}`).toBe(tier < 8);
      expect(has(p, "wand")).toBe(tier >= 5);
      expect(has(p, "cape")).toBe(tier >= 6);
      expect(has(p, "hair-back")).toBe(true);
      const q = at("prince", tier);
      expect(has(q, "circlet"), `prince ${tier}`).toBe(tier >= 3 && tier < 8);
      expect(has(q, "sword")).toBe(tier >= 5);
      expect(has(q, "shield")).toBe(tier >= 6);
      expect(has(q, "cape")).toBe(tier >= 6);
      expect(has(q, "hair")).toBe(true);
      expect(has(q, "hair-back")).toBe(false);
    }
  });
});

test.describe("the catalogue, the allow-lists and the names", () => {
  test("every drawn creature is in the catalogue, marked drawn; the new ones have no classic pictures", () => {
    const ids = AVATAR_CATALOG.map((s) => s.id);
    for (const species of FOURTEEN) {
      expect(ids, species).toContain(species);
      expect(AVATAR_CATALOG.find((s) => s.id === species)!.drawn, species).toBe(true);
    }
    for (const species of NEW_SPECIES) expect(hasClassicArt(species), species).toBe(false);
    for (const species of ["astronaut", "plant", "wizard"]) {
      expect(ids).toContain(species);
      expect(AVATAR_CATALOG.find((s) => s.id === species)!.drawn).toBeFalsy();
    }
    for (const s of AVATAR_CATALOG) expect(s.stages.map((st) => st.tier)).toEqual(TIERS);
  });

  test("both account routes take their allow-list from the catalogue", () => {
    for (const route of ["src/app/api/pocket-money/accounts/route.ts", "src/app/api/pocket-money/accounts/[id]/route.ts"]) {
      const src = readFileSync(join(process.cwd(), route), "utf8");
      expect(src, route).toMatch(/VALID_SPECIES[^=]*=\s*new Set\(\s*avatarCatalog\.species\.map\(\(s\) => s\.id\)/);
      expect(src, route).toContain("VALID_SPECIES.has(");
    }
  });

  test("every species has a name and eight stage names in en, de and fr", () => {
    for (const [lang, bundle] of [["en", en], ["de", de], ["fr", fr]] as const) {
      const species = (bundle as { pocketMoney: { species: Record<string, Record<string, string>> } }).pocketMoney.species;
      for (const s of AVATAR_CATALOG) {
        const names = species[s.id];
        expect(names, `${lang} ${s.id}`).toBeTruthy();
        expect(names.label?.trim(), `${lang} ${s.id}.label`).toBeTruthy();
        for (const st of s.stages) {
          expect(st.nameKey).toBe(`species.${s.id}.tier${st.tier}`);
          expect(names[`tier${st.tier}`]?.trim(), `${lang} ${st.nameKey}`).toBeTruthy();
        }
      }
    }
  });

  test("the workshop's stage names, in English", () => {
    const sp = en.pocketMoney.species as Record<string, Record<string, string>>;
    expect([sp.rex.tier1, sp.rex.tier8, sp.cat.tier1, sp.cat.tier8, sp.princess.tier8, sp.prince.tier6]).toEqual([
      "Egg", "Rex King", "Basket", "King of the Jungle", "Queen", "Knight",
    ]);
    const spDe = de.pocketMoney.species as Record<string, Record<string, string>>;
    expect([spDe.rex.tier8, spDe.princess.tier1, spDe.axolotl.tier8, spDe.fox.tier8, spDe.bunny.tier7, spDe.penguin.tier8]).toEqual([
      "Rex-König", "Kronkissen", "Seelegende", "Fuchsgeist", "Mondhase", "Pinguinkönig",
    ]);
  });
});

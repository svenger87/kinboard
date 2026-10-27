import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import postcss from "postcss";
import tailwind from "tailwindcss";

/**
 * Every rule in globals.css that sets design tokens (custom properties) must
 * survive Tailwind's build. Tailwind drops a rule inside @layer base when its
 * class never appears in the files `content` scans, and classes put on <html>
 * by a hook (palette-*, set from src/hooks) are easy to miss: the light-mode
 * neutral tones were compiled away for a month while their dark variants,
 * which also name the ubiquitous `dark`, survived.
 */
const webapp = path.resolve(__dirname, "..");

test("every token rule in globals.css is in the compiled CSS", async () => {
  test.setTimeout(60_000);
  const file = path.join(webapp, "src/app/globals.css");
  const source = fs.readFileSync(file, "utf8");

  const tokenRules = new Set<string>();
  postcss.parse(source).walkRules((rule) => {
    if (rule.nodes.some((n) => n.type === "decl" && n.prop.startsWith("--"))) tokenRules.add(rule.selector);
  });
  expect(tokenRules.size).toBeGreaterThan(20);

  const result = await postcss([tailwind({ config: path.join(webapp, "tailwind.config.ts") })]).process(source, { from: file });
  const compiled = new Set<string>();
  result.root.walkRules((rule) => {
    compiled.add(rule.selector);
  });

  expect([...tokenRules].filter((s) => !compiled.has(s))).toEqual([]);
});

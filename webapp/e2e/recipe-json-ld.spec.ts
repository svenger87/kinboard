import { expect, test } from "@playwright/test";
import { extractRecipeFromHtml, parseRecipeYield } from "../src/lib/recipe-json-ld";

function script(data: unknown, attributes = 'type="application/ld+json"'): string {
  return `<script ${attributes}>${JSON.stringify(data)}</script>`;
}

test("imports a Recipe from an unquoted @graph script as used by Love and Lemons", () => {
  const html = script(
    {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "Hummus" },
        { "@type": "Recipe", name: "BEST Hummus", recipeIngredient: ["chickpeas", "tahini"] },
      ],
    },
    "type=application/ld+json class=yoast-schema-graph"
  );

  expect(extractRecipeFromHtml(html)).toMatchObject({
    name: "BEST Hummus",
    recipeIngredient: ["chickpeas", "tahini"],
  });
});

test("finds a nested graph recipe with an array @type", () => {
  const html = script({
    "@graph": [{ mainEntity: { "@graph": [{ "@type": ["Thing", "Recipe"], name: "Nested" }] } }],
  });
  expect(extractRecipeFromHtml(html)?.name).toBe("Nested");
});

test("takes the first recipe when a graph contains multiple", () => {
  const html = script({ "@graph": [
    { "@type": "Recipe", name: "Main recipe" },
    { "@type": "Recipe", name: "Related recipe" },
  ] });
  expect(extractRecipeFromHtml(html)?.name).toBe("Main recipe");
});

test("keeps direct recipe and root-array formats working", () => {
  expect(extractRecipeFromHtml(script({ "@type": "Recipe", name: "Direct" }))?.name).toBe("Direct");
  expect(extractRecipeFromHtml(script([{ "@type": "WebPage" }, { "@type": "Recipe", name: "Array" }]))?.name).toBe("Array");
});

test("skips invalid JSON-LD and non-Recipe types", () => {
  const html = '<script type="application/ld+json">{broken</script>'
    + script({ "@type": "RecipeCollection", name: "Not a recipe" })
    + script({ "@type": "https://schema.org/Recipe", name: "Valid" }, "TYPE = 'APPLICATION/LD+JSON'");
  expect(extractRecipeFromHtml(html)?.name).toBe("Valid");
});

test("parses recipeYield arrays used by Love and Lemons", () => {
  expect(parseRecipeYield(["8"])).toBe(8);
  expect(parseRecipeYield("4 Portionen")).toBe(4);
  expect(parseRecipeYield({ value: 6 })).toBe(6);
});

import { test, expect } from "@playwright/test";
import { detectWasteType } from "../src/components/widgets/waste-collection-widget";

/**
 * Which bin a calendar entry is about.
 *
 * This is a keyword match over free text a council wrote, so the interesting
 * cases are the ones where a shorter keyword would win over a better one, and
 * the ones where an ordinary appointment happens to contain a bin word.
 *
 * Before this, only German matched. An English-speaking household saw an empty
 * widget with nothing to indicate the feature had simply never applied to them.
 */

const id = (title: string) => detectWasteType(title)?.id ?? null;

test.describe("German — what already worked, and must keep working", () => {
  test("matches the common bin names", () => {
    expect(id("Restmüll")).toBe("rest");
    expect(id("Bioabfall wird abgeholt")).toBe("bio");
    expect(id("Altpapier")).toBe("paper");
    expect(id("Gelber Sack")).toBe("recyclable");
    expect(id("Leichtverpackung")).toBe("packaging");
  });

  test("matches the real-world entry from this household's calendar", () => {
    // Taken verbatim from the calendar this was tested against.
    expect(id("Bioabfallbehaelter")).toBe("bio");
  });

  test("is case-insensitive", () => {
    expect(id("RESTMÜLL")).toBe("rest");
    expect(id("bioTonne")).toBe("bio");
  });
});

test.describe("English — silently unsupported before", () => {
  test("matches the names UK and US councils actually use", () => {
    expect(id("General waste collection")).toBe("rest");
    expect(id("Black bin")).toBe("rest");
    expect(id("Food waste")).toBe("bio");
    expect(id("Garden waste")).toBe("bio");
    expect(id("Brown bin")).toBe("bio");
    expect(id("Paper and cardboard")).toBe("paper");
    expect(id("Blue bin")).toBe("paper");
    expect(id("Recycling")).toBe("recyclable");
  });
});

test.describe("French", () => {
  test("matches with and without accents", () => {
    // A feed may or may not be accented; both are common.
    expect(id("Ordures ménagères")).toBe("rest");
    expect(id("Ordures menageres")).toBe("rest");
    expect(id("Déchets verts")).toBe("bio");
    expect(id("Dechets verts")).toBe("bio");
    expect(id("Bac jaune")).toBe("recyclable");
  });
});

test.describe("a specific match beats a general one", () => {
  test("light packaging is packaging, not recyclable", () => {
    // "packaging" appears in the recyclable list; "light packaging" is longer
    // and more specific, so it must win.
    expect(id("Light packaging")).toBe("packaging");
    expect(id("Leichtverpackung")).toBe("packaging");
  });

  test("garden waste is bio, not general waste", () => {
    // "waste" alone is not a keyword, but "general waste" and "garden waste"
    // both contain "waste" — the longer, specific term has to decide it.
    expect(id("Garden waste")).toBe("bio");
    expect(id("Food waste")).toBe("bio");
    expect(id("General waste")).toBe("rest");
  });
});

test.describe("an ordinary appointment is not a bin day", () => {
  test("returns null for unrelated entries", () => {
    expect(id("Zahnarzt")).toBeNull();
    expect(id("Enno Physio")).toBeNull();
    expect(id("Schulferien")).toBeNull();
    expect(id("Team meeting")).toBeNull();
    expect(id("")).toBeNull();
  });
});

/**
 * "Is this already on the list?" and "how much is that now?" — the rules an
 * assistant's shopping adds follow, so two recipes that both need milk leave
 * one milk on the list, not two.
 *
 * Pure: no database, no network. lib/shopping-enrich.ts (one item) and
 * lib/integration-recipes.ts (a recipe's worth) read the open items, plan
 * with these functions and write the plan.
 *
 * The rules, kept deliberately conservative:
 *
 *   - **Same item** means the same name after folding case, accents of the
 *     Unicode-composition kind (NFC), and runs of whitespace — plus simple
 *     plurals: one name is the other with "s", "es", "n" or "en" on the end
 *     ("egg"/"eggs", "tomato"/"tomatoes", "Zwiebel"/"Zwiebeln",
 *     "Tomate"/"Tomaten"), or "ies" for "y" ("berry"/"berries"). The shorter
 *     name must be at least three letters, so "Ei" (egg) and "Eis" (ice
 *     cream) stay two things. Nothing fuzzier: a wrong merge loses an item
 *     somebody needed, a missed one only shows it twice.
 *   - **Only unchecked items** are merged into. A ticked item was bought;
 *     needing it again is a new need.
 *   - **Quantities add up** when both are numbers in the same unit ("2" and
 *     "1" → 3; "500 g" and "250 g" → 750 g). No unit and "Stück" are both a
 *     count. Different units are not converted — "2" and "1 Packung" become
 *     "2 + 1 Packung", and a later "1 Packung" adds to that second part.
 *   - **No quantity is "some"**, not one: it adds nothing to a quantity
 *     already there, and two of them stay without one. "Salz" from two
 *     recipes is still just "Salz", not "2 Salz".
 *
 * Storage is the existing `quantity` (DECIMAL(10,2)) and `unit` (text)
 * columns. A combined quantity keeps its first part in those two columns and
 * appends the rest to `unit` ("2" + "Stück + 1 Packung"), which is exactly
 * how the shopping pages and the Bring! specification already print
 * `quantity unit` — so every screen, and Bring!, shows "2 Stück + 1 Packung"
 * without a new column.
 */

export interface Quantity {
  quantity: number | null;
  unit: string | null;
}

export interface OpenShoppingItem extends Quantity {
  id: string;
  name: string;
  checked?: boolean | null;
  notes?: string | null;
}

/** Longest quantity text accepted from a caller. */
export const MAX_QUANTITY_TEXT = 40;
/** `unit` stops growing past this; a further different unit is not appended. */
export const MAX_UNIT_LENGTH = 120;

const PLURAL_SUFFIXES = ["s", "es", "n", "en"];
const MIN_STEM = 3;

/** Lower case, NFC, single spaces, trimmed. */
export function normaliseItemName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
}

/** Whether two names are the same shopping item under the rules above. */
export function sameItemName(a: string, b: string): boolean {
  const x = normaliseItemName(a);
  const y = normaliseItemName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < MIN_STEM) return false;
  if (PLURAL_SUFFIXES.some((s) => long === short + s)) return true;
  // berry / berries
  return short.endsWith("y") && long === `${short.slice(0, -1)}ies`;
}

/** The first unchecked item with the same name, or null. A checked one never matches. */
export function findMergeTarget<T extends OpenShoppingItem>(items: readonly T[], name: string): T | null {
  return items.find((item) => item.checked !== true && sameItemName(item.name, name)) ?? null;
}

// ── units ───────────────────────────────────────────────────────────────────

/**
 * Spellings an assistant or a recipe might use, mapped to the labels the
 * shopping page offers (its UNITS list), so "500 gramm" and "500 g" are one
 * unit and a stored item reads the way a typed one does.
 */
const UNIT_LABELS: Record<string, string> = {
  g: "g", gr: "g", gramm: "g", gram: "g", grams: "g",
  kg: "kg", kilo: "kg", kilogramm: "kg", kilogram: "kg",
  l: "L", liter: "L", litre: "L", liters: "L", litres: "L",
  ml: "ml", milliliter: "ml", millilitre: "ml",
  el: "EL", "esslöffel": "EL", tbsp: "EL",
  tl: "TL", "teelöffel": "TL", tsp: "TL",
  "stück": "Stück", stk: "Stück", "stk.": "Stück", st: "Stück", "st.": "Stück",
  x: "Stück", "×": "Stück", pcs: "Stück", pc: "Stück", piece: "Stück", pieces: "Stück",
  packung: "Packung", pack: "Packung", packs: "Packung", pkg: "Packung", "pkg.": "Packung",
  "päckchen": "Packung", packet: "Packung", packets: "Packung", "packungen": "Packung",
  dose: "Dose", dosen: "Dose", can: "Dose", cans: "Dose", tin: "Dose", tins: "Dose",
  glas: "Glas", "gläser": "Glas", jar: "Glas", jars: "Glas",
  flasche: "Flasche", flaschen: "Flasche", bottle: "Flasche", bottles: "Flasche",
  bund: "Bund", "bündel": "Bund", bunch: "Bund", bunches: "Bund",
  scheibe: "Scheiben", scheiben: "Scheiben", slice: "Scheiben", slices: "Scheiben",
};

const COUNT = "Stück";

/** The label a unit is stored under: a known spelling becomes the page's label, anything else is kept as given. */
export function unitLabel(unit: string | null | undefined): string | null {
  const t = (unit ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return UNIT_LABELS[t.toLocaleLowerCase("de")] ?? t;
}

/** What decides "same unit": no unit and Stück are both a count. */
function unitKey(unit: string | null): string {
  const label = unitLabel(unit);
  return label === null || label === COUNT ? "" : label.toLocaleLowerCase("de");
}

// ── numbers ─────────────────────────────────────────────────────────────────

/** DECIMAL(10,2): what the column keeps. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 3, 1.5, 0.25 — never "3.00". */
export function formatNumber(n: number): string {
  return String(round2(n));
}

const NUMBER = /^(\d+(?:[.,]\d+)?)/;

/**
 * A caller's quantity text — "2", "2x", "500 g", "1,5 kg", "1 pack" — as a
 * number and a unit. A bare number is a count, stored as "Stück", which is
 * what the shopping page's parser makes of "2 Milch". Text that does not
 * start with a positive number is refused: a quantity nobody can add to is
 * a note, not a quantity.
 */
export function parseQuantityText(value: unknown): { ok: true; value: Quantity } | { ok: false; error: string } {
  const refuse = { ok: false as const, error: `\`quantity\` must be a number with an optional unit, at most ${MAX_QUANTITY_TEXT} characters — for example "2", "500 g" or "1 Packung"` };
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return refuse;
  let text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_QUANTITY_TEXT) return refuse;
  // "x2" / "×2" as well as "2x" / "2×".
  text = text.replace(/^[x×]\s*(?=\d)/i, "");
  const m = NUMBER.exec(text);
  if (!m) return refuse;
  const n = round2(parseFloat(m[1].replace(",", ".")));
  if (!(n > 0) || n >= 1e8) return refuse;
  const rest = text.slice(m[1].length).trim();
  // "1/2", "2-3": not a number this can add to.
  if (rest && !/^[\p{L}×]/u.test(rest)) return refuse;
  return { ok: true, value: { quantity: n, unit: unitLabel(rest) ?? COUNT } };
}

/** "2 Stück + 1 Packung", "500 g", "3" — or null when there is no quantity. */
export function formatQuantity(q: Quantity): string | null {
  if (q.quantity === null || q.quantity === undefined || !(Number(q.quantity) > 0)) return null;
  const n = formatNumber(Number(q.quantity));
  return q.unit ? `${n} ${q.unit}` : n;
}

// ── merging ─────────────────────────────────────────────────────────────────

interface Term {
  n: number;
  unit: string | null;
}

/**
 * A stored quantity as its parts. The first part is the columns; any
 * "+ <n> <unit>" after the first unit word is a further part. A part that
 * does not read as a number stays glued to the one before, unchanged.
 */
function toTerms(q: Quantity): Term[] {
  const first = q.quantity === null || q.quantity === undefined ? null : Number(q.quantity);
  if (first === null || !(first > 0)) return [];
  // "+ 1 Packung" is a bare first number followed by a further part.
  const raw = (q.unit ?? "").trim();
  const pieces = (raw.startsWith("+ ") ? ` ${raw}` : raw).split(" + ");
  const terms: Term[] = [{ n: first, unit: pieces[0].trim() || null }];
  for (const piece of pieces.slice(1).map((p) => p.trim())) {
    const m = NUMBER.exec(piece);
    if (m) {
      terms.push({ n: parseFloat(m[1].replace(",", ".")), unit: unitLabel(piece.slice(m[1].length)) });
    } else {
      const last = terms[terms.length - 1];
      last.unit = last.unit ? `${last.unit} + ${piece}` : piece;
    }
  }
  return terms;
}

function fromTerms(terms: Term[]): Quantity {
  if (terms.length === 0) return { quantity: null, unit: null };
  const [head, ...rest] = terms;
  const tail = rest.map((t) => (t.unit ? `${formatNumber(t.n)} ${t.unit}` : formatNumber(t.n)));
  const unit = [head.unit ?? "", ...tail].join(" + ").trim();
  return { quantity: round2(head.n), unit: unit || null };
}

/**
 * The quantity an item has after `added` is merged into `existing`, by the
 * rules at the top of this file. `existing` is returned unchanged when
 * appending would push `unit` past MAX_UNIT_LENGTH.
 */
export function mergeQuantities(existing: Quantity, added: Quantity): Quantity {
  const terms = toTerms(existing);
  const incoming = toTerms({ quantity: added.quantity, unit: unitLabel(added.unit) });
  if (incoming.length === 0) {
    return terms.length === 0 ? { quantity: null, unit: existing.unit ?? null } : fromTerms(terms);
  }
  if (terms.length === 0) return fromTerms(incoming);

  for (const t of incoming) {
    const same = terms.find((x) => unitKey(x.unit) === unitKey(t.unit));
    if (same) {
      same.n = round2(same.n + t.n);
      // A count keeps the label it had; "Stück" fills in a bare number.
      if (!same.unit && t.unit) same.unit = t.unit;
    } else {
      terms.push({ ...t });
    }
  }
  const merged = fromTerms(terms);
  if ((merged.unit ?? "").length > MAX_UNIT_LENGTH) return fromTerms(toTerms(existing));
  return merged;
}

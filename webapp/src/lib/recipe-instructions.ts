import type { RecipeInstruction } from "@/types/database";

/**
 * `recipes.instructions` is a `Json` column, so what comes back is whatever
 * was written: usually an array of steps, sometimes that array as a string
 * (importers vary), occasionally a plain paragraph someone pasted in.
 *
 * Every reader handled this differently. The recipe page and the edit page
 * both did a bare `JSON.parse` inside render — a paragraph in that column
 * throws a SyntaxError and blanks the page. The meal-planner dialog didn't
 * parse at all and fell back to `JSON.stringify(..., null, 2)`, so opening a
 * planned meal showed the raw `[{"step":1,"text":"..."}]` instead of the
 * recipe.
 *
 * One parser, total: anything unreadable comes back as an empty list or as a
 * single step holding the original text, never as an exception.
 */
export function parseInstructions(value: unknown): RecipeInstruction[] {
  if (!value) return [];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    // Only attempt JSON when it looks like JSON; a recipe that genuinely
    // begins with "[" is vanishingly rarer than one that doesn't, and
    // trying regardless means paying a throw on every plain-text recipe.
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseInstructions(JSON.parse(trimmed));
      } catch {
        // Malformed JSON — fall through and keep it as readable text
        // rather than losing the recipe entirely.
      }
    }
    return asSteps(trimmed);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry, index) => toInstruction(entry, index))
      .filter((entry): entry is RecipeInstruction => entry !== null);
  }

  // A lone object is a single step.
  const single = toInstruction(value, 0);
  return single ? [single] : [];
}

/** Split free text into steps on blank lines, else on newlines. */
function asSteps(text: string): RecipeInstruction[] {
  const parts = (text.includes("\n\n") ? text.split(/\n\s*\n/) : text.split("\n"))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part, index) => ({ step: index + 1, text: part }));
}

function toInstruction(entry: unknown, index: number): RecipeInstruction | null {
  if (typeof entry === "string") {
    const text = entry.trim();
    return text ? { step: index + 1, text } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const record = entry as Record<string, unknown>;
  // Importers disagree on the key; take the first that holds text.
  const text = [record.text, record.instruction, record.description, record.step_text].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
  );
  if (!text) return null;

  // Trust a stored step number only if it is a usable positive integer;
  // otherwise number by position so the list never shows "step 0" or gaps.
  const stored = record.step;
  const step =
    typeof stored === "number" && Number.isInteger(stored) && stored > 0 ? stored : index + 1;

  const imageUrl = record.image_url;
  return {
    step,
    text: text.trim(),
    ...(typeof imageUrl === "string" && imageUrl ? { image_url: imageUrl } : {}),
  };
}

import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `DialogContent` is a grid, and grid items default to `min-width: auto` —
 * they refuse to shrink below their content's min-content width. A dialog
 * whose child is a flex column full of nowrap content therefore renders its
 * *content* wider than the dialog box, and because the box is centred the
 * overflow splits across both edges.
 *
 * That is what the room entity picker did: measured on a 390px phone, the
 * dialog box was 390 wide and its content 471, putting the "add" button 66px
 * past the right edge with no way to reach it. On the portrait kiosk, where
 * the text scale is larger, it was worse.
 *
 * The fix is one utility on the shared component, which is exactly the kind of
 * thing a later refactor drops without noticing — so it is asserted here
 * rather than left to memory. Scroll containers inside a dialog cannot scroll
 * while their ancestor is sized by its own content.
 */

test("DialogContent lets its grid children shrink", () => {
  const source = readFileSync("src/components/ui/dialog.tsx", "utf8");

  // The class string, not the file: a first version of this test matched the
  // whole source and passed happily on the comment that explains the utility
  // while the utility itself had been deleted.
  const classLiteral = source.match(/"fixed left-\[50%\][^"]*"/)?.[0];
  expect(classLiteral, "DialogContent's class string was not found — did it move?").toBeTruthy();

  expect(
    classLiteral,
    "DialogContent must keep [&>*]:min-w-0 in its class string — without it a " +
      "dialog's content can render wider than the dialog itself and spill off " +
      "both screen edges",
  ).toContain("[&>*]:min-w-0");
});

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * DialogContent renders its own close button, pinned to the top-right corner.
 * A dialog that draws a second one puts two Xs in the same place — the room
 * entity picker did, and on a phone they overlapped.
 */
test("no dialog body renders a second close button", () => {
  const offenders: string[] = [];

  for (const file of tsxFiles("src/components").concat(tsxFiles("src/app"))) {
    if (file.endsWith("ui/dialog.tsx") || file.endsWith("ui/alert-dialog.tsx")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes("DialogContent")) continue;

    // A close control inside the dialog body: an icon button wired to the
    // same handler the overlay's own X already calls.
    const hasOwnClose =
      /<Button[^>]*onClick=\{[^}]*\bon(Cancel|Close)\b[^}]*\}[\s\S]{0,200}?<X\s/.test(src);
    if (hasOwnClose) offenders.push(file);
  }

  expect(
    offenders,
    `these render a close button inside a DialogContent that already has one: ${offenders.join(", ")}`,
  ).toEqual([]);
});

/**
 * Source-reading helpers for the specs that assert on code rather than on a
 * running page.
 *
 * Those specs keep tripping over their own prose. A spec that forbids a pattern
 * has to explain *why*, and the explanation names the pattern — so the file
 * fails its own assertion. It has happened three times: the #198 guard in
 * time-format.spec.ts, the migration scope check in meal-plan-week-start.spec.ts,
 * and this one. Strip the comments first and the question becomes "does the code
 * do this", which is what was meant.
 *
 * Lines are blanked rather than removed so reported line numbers still point at
 * the real file.
 */

/** Source with `//`, block and `--` comments blanked out. */
export function codeOnly(source: string, { sql = false }: { sql?: boolean } = {}): string {
  let inBlock = false;
  return source
    .split("\n")
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i++) {
        if (inBlock) {
          if (line.startsWith("*/", i)) { inBlock = false; i++; }
          continue;
        }
        if (line.startsWith("/*", i)) { inBlock = true; i++; continue; }
        if (line.startsWith("//", i)) break;
        if (sql && line.startsWith("--", i)) break;
        out += line[i];
      }
      return out;
    })
    .join("\n");
}

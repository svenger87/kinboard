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

/**
 * The GRANT statements in `sql` that give a browser role (anon,
 * authenticated, or PUBLIC, which both inherit) a write privilege on
 * public.<table>: any of ALL, INSERT, UPDATE, DELETE or TRUNCATE anywhere in
 * the privilege list, the table anywhere in the target list (or every table
 * in the schema), and the role anywhere in the grantee list. A regex over the
 * statement as a whole missed `GRANT SELECT, INSERT ... TO authenticated` and
 * `TO service_role, authenticated`.
 *
 * Reads statements as written; a GRANT built at run time with format() and
 * %I is out of its reach.
 */
export function browserWriteGrants(sql: string, table: string): string[] {
  const found: string[] = [];
  const statements = sql.matchAll(
    /\bGRANT\s+([\s\S]*?)\s+ON\s+(?:TABLE\s+)?([\s\S]*?)\s+TO\s+([\s\S]*?)(?:\s+WITH\s+GRANT\s+OPTION)?\s*;/gi,
  );
  for (const [statement, privileges, targets, grantees] of statements) {
    if (!/\b(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(privileges)) continue;
    const onTable =
      /^ALL\s+TABLES\s+IN\s+SCHEMA\s+public$/i.test(targets.trim()) ||
      targets.split(",").some((t) => t.trim().replace(/"/g, "").replace(/^public\./i, "").toLowerCase() === table);
    if (!onTable) continue;
    if (!grantees.split(",").some((g) => /^(?:anon|authenticated|public)$/i.test(g.trim()))) continue;
    found.push(statement.replace(/\s+/g, " "));
  }
  return found;
}

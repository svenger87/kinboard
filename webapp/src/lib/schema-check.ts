/**
 * The pure half of the deep health check (lib/deep-health.ts): which of the
 * tables and columns a build declares PostgREST does not serve. Kept apart so
 * it can be tested without a server client.
 */

/** PostgREST's OpenAPI `definitions`: one entry per table or view it exposes. */
export type Definitions = Record<string, { properties?: Record<string, unknown> } | undefined>;

/** "table" or "table.column" for each expected thing PostgREST does not expose. */
export function missingFromSchema(expected: Record<string, string[]>, definitions: Definitions): string[] {
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(expected)) {
    const def = definitions[table];
    if (!def) {
      missing.push(table);
      continue;
    }
    const props = def.properties ?? {};
    for (const c of columns) if (!(c in props)) missing.push(`${table}.${c}`);
  }
  return missing;
}

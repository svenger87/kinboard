/**
 * PostgREST's `or=(a,b)` filter, evaluated in JavaScript for the fake
 * database clients in the unit specs.
 *
 * Only the operators the app's `or` filters use: `is.null|true|false` and
 * `eq.<value>`, each optionally negated with `not.`. Anything else throws, so
 * a fake can never quietly accept a filter it does not understand and pass a
 * test by matching everything.
 *
 * `get` returns `undefined` for "there is no such row" -- an event whose
 * embedded calendar does not exist. With `!inner`, PostgREST drops that
 * parent, so the whole filter fails; it must not read the missing column as
 * NULL and pass `google_calendar_id.is.null`.
 */
export function matchesOr(expr: string, get: (column: string) => unknown): boolean {
  const terms = expr.split(",");
  if (terms.length === 0 || terms.some((t) => t.length === 0)) throw new Error(`bad or filter: ${expr}`);
  return terms.some((term) => {
    const m = /^([a-z_]+)\.(not\.)?(is|eq)\.(.+)$/.exec(term);
    if (!m) throw new Error(`unsupported or term: ${term}`);
    const [, column, not, op, raw] = m;
    const found = get(column);
    if (found === undefined) return false;
    const actual = found;
    let hit: boolean;
    if (op === "is") {
      if (raw === "null") hit = actual === null;
      else if (raw === "true") hit = actual === true;
      else if (raw === "false") hit = actual === false;
      else throw new Error(`unsupported is value: ${raw}`);
    } else {
      hit = String(actual) === raw;
    }
    return not ? !hit : hit;
  });
}

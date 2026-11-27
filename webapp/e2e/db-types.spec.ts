import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

type TypeRef = { name: string; typtype: string; schema: string; elem: TypeRef | null; domainBase: string | null; relkind: string | null };
interface RenderModule {
  checkedValues(checks: string[], column: string): string[] | null;
  render(model: unknown): string;
  tsType(t: TypeRef, schema?: string): string;
}
const renderModule: Promise<RenderModule> = import("../scripts/db-types/render.mjs");
const databaseModule: Promise<{ pinnedBaseImage(imageDir: string): string }> = import("../scripts/db-types/database.mjs");
let checkedValues: RenderModule["checkedValues"];
let render: RenderModule["render"];
let tsType: RenderModule["tsType"];
let pinnedBaseImage: (dockerDir: string) => string;
test.beforeAll(async () => {
  ({ checkedValues, render, tsType } = await renderModule);
  ({ pinnedBaseImage } = await databaseModule);
});

/*
  The database types generator (RFC-024 §4.6 step 4): scripts/db-types/.
  The renderer is a pure function of the catalogue model, pinned here; that
  the committed file matches the migrated schema is the CI job "Database
  types" (`npm run db:check`), which needs Docker.
*/

const text = (name: string): TypeRef => ({ name, typtype: "b", schema: "pg_catalog", elem: null, domainBase: null, relkind: null });
const col = (name: string, type = "text", extra: Record<string, unknown> = {}) => ({
  name,
  nullable: false,
  hasDefault: false,
  identityAlways: false,
  generated: false,
  type: text(type),
  ...extra,
});

test.describe("CHECK constraints become literal unions", () => {
  test("`= ANY (ARRAY[...])`, the form IN (...) is stored as", () => {
    expect(checkedValues(["CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))"], "status"))
      .toEqual(["pending", "approved", "denied"]);
  });

  test("a single value", () => {
    expect(checkedValues(["CHECK ((driver = 'home_assistant'::text))"], "driver")).toEqual(["home_assistant"]);
  });

  test("one value per branch of an OR, each ANDed with other conditions", () => {
    const def =
      "CHECK ((((kind = 'ha_entity'::text) AND (entity_id IS NOT NULL) AND (builtin_key IS NULL)) OR ((kind = 'builtin'::text) AND (builtin_key IS NOT NULL) AND (entity_id IS NULL))))";
    expect(checkedValues([def], "kind")).toEqual(["ha_entity", "builtin"]);
    // The other columns of that check are not confined to values.
    expect(checkedValues([def], "entity_id")).toBeNull();
  });

  test("`col IS NULL OR …` keeps the values (null is the column's nullability)", () => {
    expect(checkedValues(["CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['a'::text, 'b'::text]))))"], "kind")).toEqual(["a", "b"]);
  });

  test("varchar, with its casts", () => {
    expect(checkedValues(["CHECK (((mode)::text = ANY ((ARRAY['x'::character varying, 'y'::character varying])::text[])))"], "mode"))
      .toEqual(["x", "y"]);
  });

  test("quotes inside a literal, and an OR or AND inside one, don't split it", () => {
    expect(checkedValues(["CHECK ((v = ANY (ARRAY['it''s'::text, 'a OR b'::text, 'c AND d'::text])))"], "v"))
      .toEqual(["it's", "a OR b", "c AND d"]);
  });

  test("a check that doesn't confine the column leaves it a string", () => {
    expect(checkedValues(["CHECK ((char_length(name) <= 200))"], "name")).toBeNull();
    expect(checkedValues(["CHECK (((kind <> 'home'::text) OR (entity_id IS NOT NULL)))"], "kind")).toBeNull();
    expect(checkedValues(["CHECK ((rule ~ '^FREQ='::text))"], "rule")).toBeNull();
    // A branch that says nothing about the column lets anything through.
    expect(checkedValues(["CHECK (((kind = 'a'::text) OR (other > 1)))"], "kind")).toBeNull();
  });

  test("a NOT VALID check is ignored: old rows may break it", () => {
    expect(checkedValues(["CHECK ((s = ANY (ARRAY['a'::text]))) NOT VALID"], "s")).toBeNull();
  });

  test("two checks on one column: only what both allow", () => {
    expect(checkedValues([
      "CHECK ((s = ANY (ARRAY['a'::text, 'b'::text, 'c'::text])))",
      "CHECK ((s = ANY (ARRAY['b'::text, 'c'::text, 'd'::text])))",
    ], "s")).toEqual(["b", "c"]);
  });

  test("a prefix of the column's name is another column", () => {
    expect(checkedValues(["CHECK ((kind_extra = 'a'::text))"], "kind")).toBeNull();
  });
});

test("PostgreSQL types map as postgrest-js expects", () => {
  expect(tsType(text("int8"))).toBe("number");
  expect(tsType(text("numeric"))).toBe("number");
  expect(tsType(text("jsonb"))).toBe("Json");
  expect(tsType(text("timestamptz"))).toBe("string");
  expect(tsType(text("void"))).toBe("undefined");
  expect(tsType({ ...text("_uuid"), elem: text("uuid") })).toBe("string[]");
  expect(tsType({ ...text("_jsonb"), elem: text("jsonb") })).toBe("Json[]");
  expect(tsType({ name: "todos", typtype: "c", schema: "public", elem: null, domainBase: null, relkind: "r" }))
    .toBe('Database["public"]["Tables"]["todos"]["Row"]');
  expect(tsType({ name: "d", typtype: "d", schema: "public", elem: null, domainBase: "int4", relkind: null })).toBe("number");
  expect(tsType(text("some_extension_type"))).toBe("unknown");
});

test.describe("the rendered file", () => {
  const model = {
    schema: "public",
    tables: [{
      name: "things",
      columns: [
        col("id", "uuid", { hasDefault: true }),
        col("kind"),
        col("note", "text", { nullable: true }),
        col("n", "int8", { identityAlways: true, hasDefault: true }),
        col("total", "int4", { generated: true, hasDefault: true }),
      ],
      checks: ["CHECK ((kind = ANY (ARRAY['a'::text, 'b'::text])))"],
      relationships: [{ foreignKeyName: "things_owner_fkey", columns: ["owner"], isOneToOne: false, referencedRelation: "owners", referencedColumns: ["id"] }],
    }],
    views: [],
    functions: [
      { name: "f_none", returnsSet: false, args: [], outArgs: [], returns: text("uuid") },
      { name: "f_args", returnsSet: false, args: [{ name: "p_a", hasDefault: false, type: text("text") }, { name: "p_b", hasDefault: true, type: text("int4") }], outArgs: [], returns: text("jsonb") },
      { name: "f_table", returnsSet: true, args: [], outArgs: [{ name: "id", type: text("uuid") }, { name: "age", type: text("int4") }], returns: text("record") },
      { name: "f_unnamed", returnsSet: false, args: [{ name: "", hasDefault: false, type: text("text") }], outArgs: [], returns: text("text") },
    ],
    enums: [],
    composites: [],
  };
  let out = "";
  test.beforeAll(() => { out = render(model); });
  const section = (from: string, to: string) => out.slice(out.indexOf(from), out.indexOf(to, out.indexOf(from)));

  test("Row: every column, `| null` where nullable, CHECKed text as literals", () => {
    const row = section("        Row: {", "        Insert:");
    expect(row).toContain('          kind: "a" | "b"\n');
    expect(row).toContain("          note: string | null\n");
    expect(row).toContain("          id: string\n");
  });

  test("Insert: optional with a default or null; generated and identity-always columns can't be written", () => {
    const insert = section("        Insert: {", "        Update:");
    expect(insert).toContain("          id?: string\n");
    expect(insert).toContain('          kind: "a" | "b"\n');
    expect(insert).toContain("          note?: string | null\n");
    expect(insert).toContain("          n?: never\n");
    expect(insert).toContain("          total?: never\n");
  });

  test("Update: everything optional", () => {
    const update = section("        Update: {", "        Relationships:");
    expect(update).toContain('          kind?: "a" | "b"\n');
    expect(update).toContain("          id?: string\n");
  });

  test("Relationships in postgrest-js's shape", () => {
    expect(out).toContain(`            foreignKeyName: "things_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]`);
  });

  test("functions: no arguments is `never`, a default makes one optional, OUT/TABLE columns are the result", () => {
    expect(out).toContain("      f_none: {\n        Args: never\n        Returns: string\n      }");
    expect(out).toContain("          p_a: string\n          p_b?: number\n");
    expect(out).toContain("        Returns: {\n          id: string\n          age: number\n        }[]");
    // PostgREST calls a function by its arguments' names; one without is not callable.
    expect(out).not.toContain("f_unnamed");
  });

  test("empty sections are `{ [_ in never]: never }`, as postgrest-js's generic schema accepts", () => {
    expect(out).toContain("    Views: { [_ in never]: never }");
    expect(out).toContain("    Enums: { [_ in never]: never }");
  });
});

test.describe("wiring", () => {
  test("npm run db:generate runs the generator, db:check its check; the Supabase CLI is gone", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["db:generate"]).toBe("node scripts/db-types/generate.mjs");
    expect(pkg.scripts["db:check"]).toBe("node scripts/db-types/generate.mjs --check");
    expect(JSON.stringify(pkg)).not.toMatch(/supabase gen|"supabase":/);
    expect(existsSync("src/lib/database.types.ts")).toBe(false);
  });

  test("CI runs the check on every pull request", () => {
    const ci = readFileSync("../.github/workflows/ci.yml", "utf8");
    const job = ci.slice(ci.indexOf("\n  db-types:"), ci.indexOf("\n  changelog:"));
    expect(job).toContain("run: npm run db:check");
    expect(job).toContain("working-directory: webapp");
  });

  test("the database comes from kinboard-postgres's own pin, not a second copy", () => {
    const image = pinnedBaseImage("image");
    expect(image).toMatch(/^postgres:\d+-alpine@sha256:[0-9a-f]{64}$/);
    expect(readFileSync("scripts/db-types/database.mjs", "utf8")).not.toMatch(/sha256:[0-9a-f]{64}/);
  });

  test("the committed file is the generator's: its header, and the tables the hand-written file had missed", () => {
    const generated = readFileSync("src/types/database.generated.ts", "utf8");
    expect(generated.startsWith("// Generated from the migrated database by `npm run db:generate`")).toBe(true);
    for (const table of ["attention_items", "context_rules", "event_series", "kept_images"]) {
      expect(generated).toContain(`\n      ${table}: {\n        Row: {`);
    }
    // events → calendars, the relationship an embed in use-supabase-queries needs.
    expect(generated).toContain('foreignKeyName: "events_calendar_id_fkey"');
  });

  test("the app imports the adapter, never the generated file directly", () => {
    const adapter = readFileSync("src/types/database.ts", "utf8");
    expect(adapter).toContain('from "./database.generated"');
    // Every other importer goes through @/types/database.
    const hits = execFileSync("grep", ["-rlE", "from \"[^\"]*database\\.generated\"", "src", "e2e", "--include=*.ts", "--include=*.tsx"], { encoding: "utf8" })
      .trim().split("\n").filter((f) => f !== "e2e/db-types.spec.ts");
    expect(hits).toEqual(["src/types/database.ts"]);
  });

  test("the browser client is typed as strictly as the server's", () => {
    const src = readFileSync("src/lib/db/postgrest.ts", "utf8");
    expect(src).toContain("export type BrowserDbClient = DbClient;");
    expect(src).not.toMatch(/PostgrestClient<Database, ClientOptions, "public", any>/);
  });
});

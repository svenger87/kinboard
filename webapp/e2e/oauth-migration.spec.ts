import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { dbContainer, SKIP_WITHOUT_DATABASE } from "./whole-database";

const ROOT = process.cwd().replace(/\/webapp$/, "");

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c", sql],
    { encoding: "utf8" }).trim();
}
function applyMigration(): void {
  execFileSync("bash", ["-c",
    `docker exec -i ${dbContainer()} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < webapp/docker/migration_oauth_mcp.sql`],
    { cwd: ROOT, encoding: "utf8" });
}

test.skip(SKIP_WITHOUT_DATABASE, "no database container reachable");

test("the OAuth migration applies twice and leaves nothing reachable through PostgREST", () => {
  applyMigration();
  applyMigration(); // the entrypoint runs every migration on every start

  const cols = psql(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='integration_tokens'
    AND column_name IN ('oauth_client_id','resource','refresh_token_hash','refresh_expires_at')`);
  expect(cols).toBe("oauth_client_id,refresh_expires_at,refresh_token_hash,resource");

  for (const table of ["oauth_clients", "oauth_authorization_requests"]) {
    for (const role of ["anon", "authenticated"]) {
      expect(psql(`SELECT has_table_privilege('${role}', 'public.${table}', 'SELECT')`), `${role} on ${table}`).toBe("f");
    }
    expect(psql(`SELECT has_table_privilege('service_role', 'public.${table}', 'INSERT')`)).toBe("t");
  }
});

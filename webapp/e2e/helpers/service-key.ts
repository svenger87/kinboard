/**
 * The service-role key in the test runner's environment (RFC-024 §4.6).
 *
 * CI exports it as KINBOARD_SERVICE_ROLE_KEY; a runner set up before the
 * rename may still have SUPABASE_SERVICE_ROLE_KEY. The app's own reads go
 * through lib/env.ts `serviceRoleKey`; the specs ask here, so the names are
 * read in one place on each side (e2e/env-helper.spec.ts holds both to it).
 */

/** Every name a key can be under, newest first, plus the secrets it can be derived from. */
export const KEY_NAMES = ["KINBOARD_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"] as const;
const DERIVED_FROM = ["JWT_SECRET", "PGRST_JWT_SECRET"] as const;

/** Whether the runner was handed a service-role key under any of its names. */
export function hasServiceKey(env: Record<string, string | undefined> = process.env): boolean {
  return KEY_NAMES.some((name) => !!env[name]);
}

/** Set the key under its current name, which wins over every older one. */
export function setServiceKey(value: string): void {
  process.env.KINBOARD_SERVICE_ROLE_KEY = value;
}

/**
 * Run `fn` with no service-role key anywhere: no name set and nothing to
 * derive one from. Everything is put back afterwards, whatever `fn` does.
 */
export async function withoutServiceKey<T>(fn: () => Promise<T> | T): Promise<T> {
  const names = [...KEY_NAMES, ...DERIVED_FROM];
  const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  try {
    return await fn();
  } finally {
    for (const n of names) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
  }
}

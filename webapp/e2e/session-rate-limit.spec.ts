import { test, expect } from "@playwright/test";
import { sessionAttemptLimit } from "../src/lib/rate-limit";

// The join/create caps can be raised (CI joins dozens of devices from one IP),
// but never lowered below production and never set from nonsense.
const withEnv = (value: string | undefined, fn: () => void) => {
  const before = process.env.SESSION_RATE_LIMIT_PER_MINUTE;
  if (value === undefined) delete process.env.SESSION_RATE_LIMIT_PER_MINUTE;
  else process.env.SESSION_RATE_LIMIT_PER_MINUTE = value;
  try { fn(); } finally {
    if (before === undefined) delete process.env.SESSION_RATE_LIMIT_PER_MINUTE;
    else process.env.SESSION_RATE_LIMIT_PER_MINUTE = before;
  }
};

test("unset keeps the production caps", () => {
  withEnv(undefined, () => {
    expect(sessionAttemptLimit(10)).toBe(10);
    expect(sessionAttemptLimit(5)).toBe(5);
  });
});

test("a whole number raises the cap", () => {
  withEnv("1000", () => expect(sessionAttemptLimit(10)).toBe(1000));
});

test("it never lowers a cap below production", () => {
  withEnv("3", () => expect(sessionAttemptLimit(10)).toBe(10));
});

test("nonsense is ignored", () => {
  for (const v of ["", "abc", "0", "-5", "1.5", "99999", "1e3"]) {
    withEnv(v, () => expect(sessionAttemptLimit(10), v).toBe(10));
  }
});

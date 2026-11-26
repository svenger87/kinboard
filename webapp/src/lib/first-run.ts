/**
 * The first-run sequence (RFC-024 §8): the setup wizard a new family walks
 * through, and in front of it, once per install, two steps that belong to
 * the install rather than to a family: its address and the push contact.
 *
 * Pure: shared by the wizard, the setup routes and their specs.
 */

/** instance_settings keys. */
export const INSTANCE_SITE_URL_KEY = "site_url";
export const INSTANCE_VAPID_SUBJECT_KEY = "vapid_subject";
/**
 * Set once the install's own steps have been shown and left, by continuing
 * or skipping, or by finishing the wizard. Set by migration 094 on every
 * install that already had a family, so those never see them.
 */
export const INSTANCE_FIRST_RUN_KEY = "first_run_done";

/** What web-push has said since 2023 when nobody named a contact. */
export const DEFAULT_VAPID_SUBJECT = "mailto:admin@example.com";

export const INSTALL_STEPS = ["install", "push"] as const;
export const FAMILY_STEPS = ["region", "people", "calendar", "homeassistant", "weather", "pin", "done"] as const;
export type WizardStep = (typeof INSTALL_STEPS)[number] | (typeof FAMILY_STEPS)[number];

export interface InstanceSetupView {
  operator: boolean;
  firstRunDone?: boolean;
  /** The install's steps were closed by this family, i.e. in its own first run. */
  firstRunMine?: boolean;
}

/**
 * Whether /setup sends this family to the install's steps: only the
 * install's operator (INSTANCE_ADMIN_FAMILY_ID, or the first and only
 * family — #547's rule), and only until they have been left once.
 */
export function installStepsDue(i: InstanceSetupView | null | undefined): boolean {
  return !!i && i.operator && !i.firstRunDone;
}

/**
 * Whether the wizard's progress and Back include the install's steps: while
 * they are due, and for the rest of the wizard of the family that went
 * through them, so the count does not jump from "2 of 9" to "1 of 7". Never
 * for an install that had its first run before them (migration 094).
 */
export function installStepsListed(i: InstanceSetupView | null | undefined): boolean {
  return !!i && i.operator && (!i.firstRunDone || !!i.firstRunMine);
}

/** The stored marker: when, and which family closed the install's steps. */
export function firstRunRecord(familyId: string, now: Date): string {
  return JSON.stringify({ at: now.toISOString(), family_id: familyId });
}

/** The family that closed them, from the stored marker; null for migration 094's or anything unreadable. */
export function firstRunFamily(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const id = (o as Record<string, unknown>).family_id;
      return typeof id === "string" && id ? id : null;
    }
  } catch {
    // migration 094 writes a plain word
  }
  return null;
}

export function wizardSteps(installSteps: boolean): WizardStep[] {
  return installSteps ? [...INSTALL_STEPS, ...FAMILY_STEPS] : [...FAMILY_STEPS];
}

export function stepHref(step: WizardStep): string {
  return `/setup/${step}`;
}

/** The steps either side of `current`; a step not in the list (an install step reopened later) goes on to the first family step. */
export function stepNeighbours(steps: readonly WizardStep[], current: WizardStep): { back?: string; next: string } {
  const i = steps.indexOf(current);
  if (i < 0) return { next: stepHref(steps[0] ?? "done") };
  const back = i > 0 ? stepHref(steps[i - 1]) : undefined;
  const next = stepHref(steps[Math.min(i + 1, steps.length - 1)]);
  return { back, next };
}

export interface SetupProgress {
  has_holiday_region: boolean;
  has_people: boolean;
  has_calendar: boolean;
  has_home_assistant: boolean;
  has_weather_location: boolean;
  has_pin?: boolean;
}

/** Where /setup sends a family: the install's steps first while they are due, then the first family step not done. */
export function firstIncompleteStep(state: SetupProgress, installSteps: boolean): WizardStep {
  if (installSteps) return "install";
  if (!state.has_holiday_region) return "region";
  if (!state.has_people) return "people";
  if (!state.has_calendar) return "calendar";
  if (!state.has_home_assistant) return "homeassistant";
  if (!state.has_weather_location) return "weather";
  if (state.has_pin === false) return "pin";
  return "done";
}

/**
 * The address calendar links are built from: an http(s) origin, nothing
 * else. A path, a query or credentials are refused rather than dropped, so
 * what is saved is what was typed. A bare host is taken as http, as a
 * browser's address bar would.
 */
export function normaliseSiteUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!url.hostname) return null;
  return url.origin;
}

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;

/**
 * The contact push services are given (VAPID's "sub"): an email address,
 * stored as mailto:, or an https address. Anything else is refused.
 */
export function normaliseVapidSubject(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 254) return null;
  const mail = raw.toLowerCase().startsWith("mailto:") ? raw.slice(7) : raw;
  if (EMAIL.test(mail)) return `mailto:${mail}`;
  if (/^https:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && url.hostname && !url.username && !url.password) return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** The subject as a person would type it: the address without mailto:. */
export function subjectForDisplay(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject.toLowerCase().startsWith("mailto:") ? subject.slice(7) : subject;
}

export type InstanceValueSource = "environment" | "install" | "none";

/** The server's environment wins whenever it is set (RFC-024 §8: "The variable still wins when set"). */
export function resolveInstanceValue(
  env: string | undefined,
  stored: string | null | undefined,
): { value: string | null; source: InstanceValueSource } {
  const e = env?.trim();
  if (e) return { value: e, source: "environment" };
  const s = stored?.trim();
  if (s) return { value: s, source: "install" };
  return { value: null, source: "none" };
}

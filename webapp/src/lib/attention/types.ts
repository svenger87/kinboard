/**
 * The Heute-Motor's contract (plan §Phase 3).
 *
 * Rule-based, deterministic, local. No AI — a family display that says
 * something surprising and cannot say why is worse than one that says nothing,
 * and every hint here has to be explainable and switch-off-able from itself.
 */

/** The parts of the day the plan defines. */
export type DayContext = "morning" | "afternoon" | "evening" | "quiet";

/**
 * Everything a rule is allowed to look at.
 *
 * Passing signals in — rather than letting rules fetch — is what makes the
 * engine testable and the first exit criterion ("same data → same items")
 * achievable at all. A rule that could query would depend on the state of the
 * database at the moment it ran, and two runs a second apart could differ with
 * nothing to show for it.
 */
export interface Signals {
  /** Injected, never read from the clock inside a rule. See `now` below. */
  now: Date;
  timeZone: string;

  events: SignalEvent[];
  todos: SignalTodo[];
  lessons: SignalLesson[];
  meals: SignalMeal[];
  birthdays: SignalBirthday[];
  shoppingItemCount: number;

  /**
   * Weather and Home Assistant are optional on purpose. A family without Home
   * Assistant has to get real value (an exit criterion), so every rule that
   * uses these must degrade rather than fail — and the type says so, instead
   * of leaving each rule to remember.
   */
  weather?: SignalWeather;
  home?: SignalHome;
}

export interface SignalEvent {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  personId: string | null;
  personName: string | null;
}

export interface SignalTodo {
  id: string;
  title: string;
  dueDate: Date | null;
  completed: boolean;
  personId: string | null;
  personName: string | null;
}

export interface SignalLesson {
  personId: string;
  personName: string;
  /** 0 = Sunday, matching the schedules table's own CHECK constraint. */
  dayOfWeek: number;
  period: number;
  subject: string;
  /** Things the child has to bring for this lesson, if the family tracks them. */
  packList: string[];
}

export interface SignalMeal {
  date: Date;
  mealType: string;
  title: string | null;
}

export interface SignalBirthday {
  id: string;
  name: string;
  date: Date;
  daysUntil: number;
}

export interface SignalWeather {
  /** Celsius. */
  temperatureMin: number | null;
  temperatureMax: number | null;
  precipitationChance: number | null;
  condition: string | null;
}

export interface SignalHome {
  /** Entity id -> state, exactly as Home Assistant reports it. */
  states: Record<string, string>;
  /**
   * Entity id -> device_class.
   *
   * Carried because entity ids are written in the household's own language:
   * matching `binary_sensor.door` finds nothing in a German house, where the
   * same sensor is `binary_sensor.haustur`. device_class is Home Assistant's
   * own language-independent answer to "what kind of thing is this", and it is
   * the only way a shipped rule can work on an installation it has never seen.
   */
  deviceClasses: Record<string, string>;
}

/**
 * What a rule produces. Note what is absent: no id, no timestamps, no state.
 *
 * A rule describes a situation; it does not know whether this is the first
 * time it has been seen or the hundredth, and it must not, or it would stop
 * being a pure function of the signals.
 */
export interface ProposedItem {
  /**
   * Stable identity for "this rule, about this thing".
   *
   * Must be derived from what the item is *about*, never from the clock or a
   * counter. `sport-kit:2026-08-11:henrik` is right; anything containing the
   * current minute would produce a new item every evaluation and lose the
   * acknowledgement the family already made.
   */
  key: string;
  /**
   * English, and the fallback.
   *
   * Kept because Home Assistant and the summary endpoint need *a* string, and
   * because an item raised before a translation existed must still say
   * something rather than showing a key.
   */
  title: string;
  detail?: string;
  /**
   * What the item means, for anything that can choose its own words.
   *
   * The locale is per device in Kinboard — a cookie, not a family setting — so
   * a household can have a German wall tablet and an English phone. Rendering
   * the wording server-side would pick one language for both. The rule
   * therefore states the message and its values, and the surface that displays
   * it decides how to say it.
   */
  messageKey?: string;
  params?: Record<string, string | number>;
  /** The inputs behind it, so "why am I seeing this?" needs no re-run. */
  evidence?: Record<string, unknown>;
  priority?: number;
  context?: DayContext;
  subjectType?: string;
  subjectId?: string;
}

export interface RuleContext {
  /** Per-family settings for this rule, defaulted by the rule itself. */
  config: Record<string, unknown>;
  /** Which part of the day it is, already resolved from `now`. */
  dayContext: DayContext;
}

export interface Rule {
  /** Stable across releases: a family's "off" switch is keyed on it. */
  id: string;
  /** Shown in settings, next to the switch. */
  title: string;
  /** One sentence a person can read to decide whether they want it. */
  description: string;
  /** Which contexts this rule may speak in. Empty means any. */
  contexts?: DayContext[];
  defaultConfig?: Record<string, unknown>;
  evaluate: (signals: Signals, ctx: RuleContext) => ProposedItem[];
}

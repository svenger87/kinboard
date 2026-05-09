import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * v0.1 contract — surface plugins only (net-new pages like Vehicles,
 * future Robot-Vacuums, Garden-Watering). Provider plugins (alternative
 * backends for an existing surface, e.g. ICS as a Calendar provider)
 * are deliberately not modeled until a second concrete provider exists
 * to design against.
 *
 * Plugins are registered at build time in `registry.ts`. Runtime plugin
 * loading is out of scope for v0.1.
 */

/**
 * Inputs available to a plugin's nav-gating predicate. Kept small on
 * purpose — only data the existing `useVisibleNavItems` hook already
 * pulls from React Query is in scope.
 */
export type NavGatingContext = {
  /** True iff the family has Home Assistant URL + access_token saved. */
  haConnected: boolean;
  /** True iff any HA-dependent query is still pending; predicates that
   *  depend on HA should return "loading" to suppress the nav item
   *  (existing pattern: hide rather than flash). */
  haLoading: boolean;
  /** Plugin-owned counter — populated by the plugin's own count hook
   *  via the registry. Vehicles fills this with vehicle row count;
   *  unused plugins return undefined. */
  ownDataCount: number | undefined;
  /** True iff the plugin's own count query is still pending. */
  ownDataLoading: boolean;
};

export type NavGatingResult = boolean | "loading";

export interface SurfacePlugin {
  /** Stable kebab-case id. */
  id: string;

  /** Bottom-nav entry. */
  navItem: {
    href: `/${string}`;
    icon: LucideIcon;
    /** i18n key under `nav.*`. */
    labelKey: string;
  };

  /** Settings-landing entry. */
  settingsItem: {
    href: `/settings/${string}`;
    icon: LucideIcon;
    /** i18n key under `settings.<plugin id>.title`. */
    titleKey: string;
    /** i18n key under `settings.<plugin id>.description`. */
    descriptionKey: string;
  };

  /** Optional dashboard widget. Wired up in Task 10. */
  dashboardWidget?: ComponentType<object>;

  /** Predicate evaluated by `useVisibleNavItems`. */
  isNavVisible: (ctx: NavGatingContext) => NavGatingResult;

  /** Hook the registry calls (from `useVisibleNavItems`) to populate
   *  `ownDataCount` / `ownDataLoading` for this plugin's nav-gating
   *  predicate. Plugins without their own data return
   *  `{ count: undefined, loading: false }`.
   *
   *  INVARIANT — Rules of Hooks: implementations MUST be unconditional
   *  hooks. The registry's `PLUGINS` array is module-level and
   *  fixed-length, so iterating it inside `useVisibleNavItems` is safe.
   *  Do NOT introduce conditional plugin registration (e.g. feature
   *  flags that evaluate at runtime to add/remove entries from PLUGINS)
   *  — that would change the hook call count between renders and break
   *  the rules. Static-build feature flags that branch at module-eval
   *  time (e.g. process.env at build) are fine.
   */
  useOwnDataCount: () => { count: number | undefined; loading: boolean };

  /** i18n namespace at the top of `messages/{en,de}.json`. */
  i18nNamespace: string;
}

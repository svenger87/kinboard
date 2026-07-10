import { useSetting, useUpdateSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

export type EnabledPluginsMap = Record<string, boolean>;

const SETTING_KEY = SETTINGS_KEYS.enabledPlugins;

// All plugins are considered enabled by default. The "missing key
// means enabled" rule lets new plugins ship enabled-by-default and
// keeps existing families (whose enabled_plugins blob predates a new
// plugin's id) from silently disabling it.
const DEFAULT_ENABLED_PLUGINS: EnabledPluginsMap = {};

export function useEnabledPlugins() {
  return useSetting<EnabledPluginsMap>(SETTING_KEY, DEFAULT_ENABLED_PLUGINS);
}

export function useUpdateEnabledPlugins() {
  return useUpdateSetting<EnabledPluginsMap>();
}

/**
 * Whether a specific plugin is enabled for the current family.
 * Returns true if:
 *  - the plugin's id is missing from the saved blob (default-on)
 *  - the plugin's id is present and set to true
 * Returns false only when explicitly set to false.
 *
 * While the underlying useSetting query is loading, returns true so
 * UI doesn't flash plugin items in/out on a fresh page load (mirrors
 * the loading-state policy in useVisibleNavItems).
 */
export function useIsPluginEnabled(pluginId: string): boolean {
  const { data: enabledPlugins, isPending } = useEnabledPlugins();
  if (isPending) return true;
  if (!enabledPlugins) return true;
  if (enabledPlugins[pluginId] === false) return false;
  return true;
}

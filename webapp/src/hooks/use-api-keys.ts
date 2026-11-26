"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import type { ApiKeyName, ApiKeysStatus } from "@/lib/api-key-status";

/**
 * The install keys a family sets in Settings (RFC-023 §4.4), through
 * /api/settings/keys. The browser only ever holds where each key comes from
 * and a masked hint; a value goes up, never down, except a newly generated
 * presence token, which comes back once.
 */

const KEY = "api-keys";

/** `keys` is null when a change was stored but its status could not be read back. */
async function call(method: string, body?: unknown): Promise<{ keys: ApiKeysStatus | null; token?: string }> {
  const response = await fetch("/api/settings/keys", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    if (await isPinRequired(response)) {
      // PinGuard puts the PIN screen back up; the caller shows no error of its own.
      relockSettings();
      throw new Error("pin_required");
    }
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

export function useApiKeys() {
  const { family } = useFamilyStore();
  return useQuery({
    queryKey: [KEY, family?.id],
    queryFn: async () => {
      const { keys } = await call("GET");
      if (!keys) throw new Error("no_status");
      return keys;
    },
    enabled: !!family?.id,
  });
}

/** Whatever answers from a key: the weather, the city search, Google's setup probe. */
function useAfterChange() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  return (name: ApiKeyName, keys: ApiKeysStatus | null) => {
    if (keys) queryClient.setQueryData([KEY, family?.id], keys);
    else void queryClient.invalidateQueries({ queryKey: [KEY, family?.id] });
    if (name === "openweathermap") void queryClient.invalidateQueries({ queryKey: ["weather"] });
    if (name === "google_oauth_client") void queryClient.invalidateQueries({ queryKey: ["google-configured"] });
  };
}

export function useSaveApiKey() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async ({ name, values }: { name: ApiKeyName; values: Record<string, string> }) =>
      (await call("PUT", { key: name, values })).keys,
    onSuccess: (keys, { name }) => after(name, keys),
  });
}

export function useClearApiKey() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async (name: ApiKeyName) => (await call("DELETE", { key: name })).keys,
    onSuccess: (keys, name) => after(name, keys),
  });
}

/** A new presence token, stored; the value is returned to show once. */
export function useGeneratePresenceToken() {
  const after = useAfterChange();
  return useMutation({
    mutationFn: async () => {
      const { keys, token } = await call("POST", { key: "presence_sensor", action: "generate" });
      return { keys, token: token ?? "" };
    },
    onSuccess: ({ keys }) => after("presence_sensor", keys),
  });
}

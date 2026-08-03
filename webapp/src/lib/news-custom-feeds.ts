import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { validateExternalUrl } from "@/lib/validate-external-url";
import { CUSTOM_FEED_PREFIX, type CustomFeed } from "@/lib/news-providers";

/**
 * Load a family's own RSS feeds, server-side.
 *
 * The client sends feed *ids*, never URLs. That's the whole point: if
 * `/api/news` accepted a URL it would be a general-purpose fetch proxy
 * for anyone who can reach the box. Ids resolve here, against the row
 * the family saved, so the only URLs the server ever fetches are ones
 * that were validated when they were added.
 *
 * "Validated when added" is a weaker guarantee than it sounds, though —
 * settings are written through `/api/settings`, so a client could store
 * a URL without ever going through discovery. Hence `validateExternalUrl`
 * runs again here on the way out. A stored URL earns no trust from being
 * stored; every feed is checked on the read path that actually fetches it.
 */

const MAX_CUSTOM_FEEDS = 20;
const MAX_NAME_LENGTH = 80;

function sanitize(raw: unknown): CustomFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const feed = raw as Record<string, unknown>;

  const id = typeof feed.id === "string" ? feed.id : "";
  const url = typeof feed.url === "string" ? feed.url.trim() : "";
  const name = typeof feed.name === "string" ? feed.name.trim() : "";
  if (!id.startsWith(CUSTOM_FEED_PREFIX) || !url) return null;

  const checked = validateExternalUrl(url);
  if (!checked.ok) return null;

  return {
    id,
    url: checked.url.href,
    // Fall back to the host so a feed always has something to badge
    // items with, even if the name was cleared.
    name: (name || checked.url.hostname).slice(0, MAX_NAME_LENGTH),
  };
}

export async function loadCustomFeeds(familyId: string): Promise<CustomFeed[]> {
  if (!familyId) return [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await (supabase as any)
      .from("settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", SETTINGS_KEYS.newsCustomFeeds)
      .maybeSingle();

    if (error || !data) return [];

    const value = data.value;
    if (!Array.isArray(value)) return [];

    const feeds: CustomFeed[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      const feed = sanitize(entry);
      if (!feed || seen.has(feed.id)) continue;
      seen.add(feed.id);
      feeds.push(feed);
      if (feeds.length >= MAX_CUSTOM_FEEDS) break;
    }
    return feeds;
  } catch (err) {
    // News is a decorative panel; a settings read failure should cost
    // the custom feeds, not the whole page.
    console.error("[news] loading custom feeds failed:", err);
    return [];
  }
}

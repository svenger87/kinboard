import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { DEFAULT_MONTHLY_TERMS } from "@/lib/unsplash-defaults";

interface UnsplashSettings {
  access_key: string;
  monthly_terms?: Record<string, string[]>;
}

interface UnsplashPhoto {
  id: string;
  alt_description: string | null;
  urls: {
    raw: string;
  };
  user: {
    name: string;
    links: {
      html: string;
    };
  };
  location?: {
    name: string | null;
  };
  links: {
    // Unsplash requires a request to this URL when an app does something
    // "similar to a download" — their own example includes setting an image
    // as a header. Showing one as wallpaper is that event.
    download_location: string;
  };
}

/**
 * Unsplash's guidelines: "All links back to Unsplash should use utm
 * parameters in the `?utm_source=your_app_name&utm_medium=referral`."
 */
const UTM = "utm_source=kinboard&utm_medium=referral";

function withUtm(url: string): string {
  return url.includes("?") ? `${url}&${UTM}` : `${url}?${UTM}`;
}

// How many distinct search terms to use per fetch, and how many random photos
// to pull per term. Using /photos/random gives genuine per-call randomness
// (unlike /search/photos which is deterministic relevance-sorted). Combining
// multiple terms dilutes thematic overrepresentation (e.g. chimneys swamping
// November), while still respecting the user-curated monthly term list.
// Five terms rather than three. Each month now offers fourteen, so three was
// sampling under a quarter of the month's variety per fetch — and the set only
// refreshes hourly, so whatever those three returned was the entire hour's
// wallpaper. Five calls an hour is nothing against Unsplash's rate limits.
const TERMS_PER_FETCH = 5;
// Below this the rotation starts repeating inside a single hour however well
// it shuffles, so it's worth spending another request or two to get there.
const MIN_POOL_SIZE = 40;
const COUNT_PER_TERM = 12; // Unsplash /photos/random max is 30 per call.

// Fisher-Yates shuffle for an unbiased random sample.
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchRandomPhotos(
  accessKey: string,
  query: string,
  count: number,
): Promise<UnsplashPhoto[]> {
  const url = new URL("https://api.unsplash.com/photos/random");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      "Accept-Version": "v1",
    },
    // No cache — each call should be genuinely random.
    cache: "no-store",
  });

  if (!response.ok) {
    console.error(`Unsplash /photos/random failed for "${query}":`, response.status);
    return [];
  }

  const data = await response.json();
  // With count > 1 Unsplash returns an array; with count = 1 it returns a single object.
  return Array.isArray(data) ? (data as UnsplashPhoto[]) : [data as UnsplashPhoto];
}

// GET: Fetch a diverse pool of random photos matching the current month's search terms.
// Spends the family's own Unsplash access key, and the search terms come back
// with it — a small window onto what a household has configured.
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Get Unsplash settings (with secrets merged in) from Supabase
  const unsplashSettings = await getMergedSetting<UnsplashSettings>(familyId, "unsplash");

  if (!unsplashSettings) {
    return NextResponse.json(
      { error: "Unsplash not configured" },
      { status: 401 }
    );
  }

  if (!unsplashSettings.access_key) {
    return NextResponse.json(
      { error: "Unsplash access key not configured" },
      { status: 401 }
    );
  }

  // Pick up to 3 distinct terms from the current month's array
  const currentMonth = String(new Date().getMonth() + 1);
  const monthlyTerms = unsplashSettings.monthly_terms ?? DEFAULT_MONTHLY_TERMS;
  const termsSource = monthlyTerms[currentMonth] ?? DEFAULT_MONTHLY_TERMS[currentMonth];
  const termsList = Array.isArray(termsSource) ? termsSource : [termsSource];

  if (termsList.length === 0) {
    return NextResponse.json([], { status: 200 });
  }

  const ordered = shuffle(termsList);
  const pickedTerms = ordered.slice(0, Math.min(TERMS_PER_FETCH, termsList.length));
  // If fewer terms are available than TERMS_PER_FETCH, pull more per term so total ~30+.
  const countPerTerm = pickedTerms.length >= 2 ? COUNT_PER_TERM : 30;

  try {
    const seen = new Set<string>();
    const combined: UnsplashPhoto[] = [];

    const collect = async (terms: string[]) => {
      const batches = await Promise.all(
        terms.map((term) => fetchRandomPhotos(unsplashSettings.access_key, term, countPerTerm)),
      );
      for (const batch of batches) {
        for (const photo of batch) {
          // The random endpoint can return the same photo for overlapping
          // queries, and a narrow term can return almost nothing.
          if (seen.has(photo.id)) continue;
          seen.add(photo.id);
          combined.push(photo);
        }
      }
    };

    await collect(pickedTerms);

    // A term can be narrow enough that Unsplash has barely any portrait
    // photos for it — "sunflowers tall rows" returned exactly one. Without
    // this, one such term in the draw shrinks the whole hour's wallpaper,
    // and the screensaver cycles a handful of pictures until the next
    // refetch. Top up from the terms we didn't draw rather than let that
    // happen; the rate limit has ample room for a couple of extra calls.
    let nextTerm = pickedTerms.length;
    while (combined.length < MIN_POOL_SIZE && nextTerm < ordered.length) {
      const topUp = ordered.slice(nextTerm, nextTerm + 2);
      nextTerm += topUp.length;
      await collect(topUp);
    }

    // Final shuffle so photos from different terms are interleaved, not grouped.
    const shuffled = shuffle(combined);

    const photos = shuffled.map((photo) => ({
      id: photo.id,
      url: `/api/unsplash/image?family_id=${familyId}&photo_url=${encodeURIComponent(photo.urls.raw + "&w=1080&h=1920&fit=crop&q=80")}`,
      photographer: photo.user.name,
      photographerUrl: withUtm(photo.user.links.html),
      // Passed through so the screensaver can report the display event; the
      // access key needed to call it stays on the server.
      downloadLocation: photo.links?.download_location ?? null,
      location: photo.location?.name ?? null,
      description: photo.alt_description ?? null,
    }));

    return NextResponse.json(photos);
  } catch (err) {
    console.error("Error fetching Unsplash photos:", err);
    return NextResponse.json(
      { error: "Failed to connect to Unsplash" },
      { status: 500 }
    );
  }
}

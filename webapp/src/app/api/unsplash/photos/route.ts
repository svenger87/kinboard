import { NextRequest, NextResponse } from "next/server";
import { getMergedSetting } from "@/lib/integration-secrets";
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
}

// How many distinct search terms to use per fetch, and how many random photos
// to pull per term. Using /photos/random gives genuine per-call randomness
// (unlike /search/photos which is deterministic relevance-sorted). Combining
// multiple terms dilutes thematic overrepresentation (e.g. chimneys swamping
// November), while still respecting the user-curated monthly term list.
const TERMS_PER_FETCH = 3;
const COUNT_PER_TERM = 15; // Unsplash /photos/random max is 30 per call.

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
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
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

  const pickedTerms = shuffle(termsList).slice(0, Math.min(TERMS_PER_FETCH, termsList.length));
  // If fewer terms are available than TERMS_PER_FETCH, pull more per term so total ~30+.
  const countPerTerm = pickedTerms.length >= 2 ? COUNT_PER_TERM : 30;

  try {
    const perTermResults = await Promise.all(
      pickedTerms.map((term) => fetchRandomPhotos(unsplashSettings.access_key, term, countPerTerm)),
    );

    // Flatten + dedup by id (the random endpoint can occasionally return the same photo for overlapping queries)
    const seen = new Set<string>();
    const combined: UnsplashPhoto[] = [];
    for (const batch of perTermResults) {
      for (const photo of batch) {
        if (seen.has(photo.id)) continue;
        seen.add(photo.id);
        combined.push(photo);
      }
    }

    // Final shuffle so photos from different terms are interleaved, not grouped.
    const shuffled = shuffle(combined);

    const photos = shuffled.map((photo) => ({
      id: photo.id,
      url: `/api/unsplash/image?family_id=${familyId}&photo_url=${encodeURIComponent(photo.urls.raw + "&w=1080&h=1920&fit=crop&q=80")}`,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
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

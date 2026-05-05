import { NextResponse } from "next/server";
import { NEWS_PROVIDERS } from "@/lib/news-providers";

// Lists all RSS sources Kinboard knows how to fetch. Consumed by the
// /settings/news page to render the picker. Static — no per-family data.
export async function GET() {
  return NextResponse.json({
    providers: NEWS_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      lang: p.lang,
      homepage: p.homepage,
    })),
  });
}

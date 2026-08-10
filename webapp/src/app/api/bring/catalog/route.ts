import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BRING_WEB_URL = "https://web.getbring.com";

// Raw catalog item from Bring! API
interface RawCatalogItem {
  itemId: string;
  name: string;
}

// Raw catalog section from Bring! API
interface RawCatalogSection {
  sectionId: string;
  name: string;
  items: RawCatalogItem[];
}

// Raw catalog response from Bring! API
interface RawCatalogResponse {
  language: string;
  catalog: {
    sections: RawCatalogSection[];
  };
}

// Transformed catalog item for our use
export interface BringCatalogItem {
  itemId: string;
  name: string;
  sectionId: string;
  sectionName: string;
}

export async function GET(request: NextRequest) {
  try {
    // Bring publishes one catalogue per locale. The caller passes the
    // household's; the fallback used to be de-DE, which handed German article
    // names to anybody whose request lost the parameter.
    const locale = request.nextUrl.searchParams.get("locale") || "en-US";
    const catalogUrl = `${BRING_WEB_URL}/locale/catalog.${locale}.json`;

    console.log("Fetching Bring catalog from:", catalogUrl);

    const response = await fetch(catalogUrl, {
      headers: {
        "Accept": "application/json",
      },
      cache: "no-store", // Disable cache for debugging
    });

    console.log("Catalog response status:", response.status);

    if (!response.ok) {
      throw new Error(`Failed to fetch catalog: ${response.status}`);
    }

    const rawData: RawCatalogResponse = await response.json();

    console.log("Catalog raw data - language:", rawData.language, "sections count:", rawData.catalog?.sections?.length);

    // Transform the nested structure into a flat articles array
    // Structure: { language: "de-DE", catalog: { sections: [{ sectionId, name, items: [...] }] } }
    const sections: string[] = [];
    const articles: BringCatalogItem[] = [];

    if (rawData.catalog?.sections) {
      for (const section of rawData.catalog.sections) {
        sections.push(section.name);
        if (section.items && Array.isArray(section.items)) {
          for (const item of section.items) {
            articles.push({
              itemId: item.itemId,
              name: item.name,
              sectionId: section.sectionId,
              sectionName: section.name,
            });
          }
        }
      }
    }

    console.log("Catalog processed - sections:", sections.length, "articles:", articles.length);

    return NextResponse.json({
      sections,
      articles,
      totalItems: articles.length,
    });
  } catch (error) {
    console.error("Bring catalog error:", error);
    return NextResponse.json(
      { error: "Failed to fetch catalog", details: String(error) },
      { status: 500 }
    );
  }
}

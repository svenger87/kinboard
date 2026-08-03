import { searchSafeImages } from "@/lib/safe-image-search";

/**
 * Web image search backend for goal-image-search.
 *
 * Used as a fallback when the curated `item_catalog` doesn't have a good
 * match for what the kid wants — brand-new toys, specific LEGO sets,
 * video games and the like.
 *
 * This used to scrape DuckDuckGo directly via the two-step `vqd` token
 * dance. That token is bound to a query, and when the scrape drifted the
 * endpoint started answering with results for something else entirely —
 * unrelated images, unfiltered. On a screen children use unsupervised
 * that is not an acceptable failure mode, so the scraper is gone and
 * this now delegates to the shared safe-image-search module.
 *
 * `mode: "general"` rather than `"product"`: goals are toys and games,
 * which the Open Food Facts grocery database doesn't carry.
 */

export interface WebImageResult {
  url: string;
  title: string;
}

export async function searchWebImages(
  query: string,
  limit = 12,
  familyId?: string,
): Promise<WebImageResult[]> {
  const results = await searchSafeImages(query, {
    limit,
    familyId,
    mode: "general",
  });

  return results.map((result) => ({ url: result.url, title: result.title }));
}

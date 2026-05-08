// /einkaufen exists as a real Next route (not a rewrite to /shopping)
// because Next App Router layouts apply based on the file-system route
// at request time. The Shopping PWA's per-route metadata
// (manifest-shopping.json, shopping icons, "Einkauf" appleWebApp.title)
// lives in `./layout.tsx` — moving /einkaufen to a rewrite would
// short-circuit that layout and serve the root layout's Kinboard
// metadata instead, breaking Add-to-Home-Screen as the Shopping PWA.
//
// The page itself is a one-line re-export of /shopping/page.tsx so
// there's still a single canonical implementation. Earlier in the
// project's history a separate 793-line /einkaufen/page.tsx had
// silently diverged from /shopping/page.tsx — this re-export
// pattern keeps the URL alias without re-introducing that drift.
export { default } from "../shopping/page";

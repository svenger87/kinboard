# RFC-009 — Uploaded photo library

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-16 |
| **Target release** | unscheduled |
| **Depends on** | the photo source contract (`src/hooks/use-photo-source.ts`), Supabase storage, `sharp` |
| **Source** | Discussion #264, brainstorm 2026-09-16 |

---

## 1. What this is for

From discussion #264:

> Bei den Bildern - wäre es nicht möglich, als weitere Quell-Option einfach
> einen Ordner auf dem Rechner anzugeben, in dem die Bilder lokal liegen?
> Das wäre für mich das einfachste.

The literal request is a directory path. That answers it for people who can
edit a compose file and breaks for everyone else, and a folder inside a
container is not the folder on the asking person's laptop. The decision taken
in the brainstorm was the one already floated in the discussion reply: photos
are **uploaded through the webapp** and become a library Kinboard owns.

So this is a fifth photo source, sitting beside Immich, Unsplash, DLNA and
iCloud, and the first one whose contents Kinboard stores rather than borrows.

## 2. What already exists

- **A source contract.** `usePhotoSource` (screensaver) and `usePhotoLibrary`
  (the Photos page) switch on a `photo_source` setting. Adding a source means
  a branch in each and a settings section — a well-worn path, four times over.
- **An upload path.** `/api/recipes/upload-image` writes to storage with
  `createAdminClient()` after `requireSession` + `familyMatchesSession`.
- **A hard-won storage security rule.** `migration_device_images_bucket.sql`
  records it: the anon key ships to every browser, and with a client-facing
  write policy in place a plain `curl` uploaded an arbitrary object through
  Kong and could have overwritten a household's pictures. Buckets therefore
  carry **no** client-facing INSERT/UPDATE/DELETE policy; the server route is
  the only way in.
- **`sharp`**, already a dependency.

## 3. Decisions

### 3.1 Private bucket, signed URLs

The four existing buckets are `public = true`. This one is not.

Recipe photos and vehicle photos are things; these are pictures of somebody's
children, on an instance that — for `kinboard.app` and the demo — is reachable
from the internet. A public bucket means any URL that escapes is world-readable
for good. So: `family-photos` is private, and an authenticated route mints
short-lived signed URLs for the photos the caller's family owns.

Rejected: proxying every image through Next, like `/api/dlna/image`. That route
exists because a DLNA server speaks http to an https page — a mixed-content
problem, not an authorisation one. Here it would put every photo byte of a
cycling screensaver through the app server for no security gain over a signed
URL that expires.

Writes follow §2's rule exactly: no client-facing storage policy, one server
route holding `createAdminClient()`.

### 3.2 A table, not just a bucket

`family_photos` carries one row per photo: storage path, thumbnail path, mime,
byte size, **width, height**, `taken_at` from EXIF, `uploaded_at`.

Listing a bucket would have been less code and no migration. It also returns
names and sizes and nothing else — no capture date to order by, no dimensions,
and therefore no way to adapt to a photo's shape without downloading it first.
§3.4 is the reason this is not negotiable.

### 3.3 `sharp` runs once, on ingest

On upload: auto-rotate by the EXIF orientation flag so the stored pixels are
upright, record the post-rotation dimensions, and write one thumbnail beside
the original.

Rotating on ingest rather than trusting the browser matters because the
dimensions are being stored: a photo whose EXIF says "rotate 90°" is 4032x3024
on disk and 3024x4032 on screen, and a stored width that disagrees with what
the viewer sees would make every orientation decision in §3.4 wrong for
exactly the photos that need it most — phone portraits.

### 3.4 Orientation and aspect ratio

Every photo surface is `object-cover` today — `screensaver.tsx:569` and `:579`,
`photos-widget.tsx:111` inside a fixed `aspect-[4/3]`. On a 16:9 wall panel a
portrait phone photo is therefore cropped to its middle third: the faces go.

This is not an upload problem, it is a Kinboard problem, and it is fixed for
**all five sources**:

- The screensaver compares the photo's aspect with the viewport's. Close
  enough, and `object-cover` still wins — it fills the screen and crops
  nothing that matters. Far apart, and the photo is drawn `object-contain`
  over a blurred, darkened copy of itself, so a portrait keeps its whole
  subject and the panel keeps a full-bleed background.
- The widget stops forcing `aspect-[4/3]` on whatever it is given.

Sources that cannot report dimensions fall back to today's behaviour rather
than guessing; the uploaded library always can.

## 4. Phases

**M1 (this RFC's scope).** Migration, upload route for one or a few files at a
time, list and delete routes, signed URLs, the `upload` source wired into both
hooks, a Settings → Photos section, and §3.4 in full.

**M2.** The folder drop: many files at once, a progress list, resume after a
failed file, duplicate detection. M1's route is the thing M2 calls repeatedly,
so M2 is UI and orchestration rather than new plumbing.

## 5. Risks

**HEIC.** iPhones produce `image/heic`. `sharp`'s prebuilt binaries generally
ship without HEIF decode, so these uploads would fail — and iPhone owners are a
large part of who asked. M1 rejects unsupported types with a message naming the
format rather than a generic failure; deciding between client-side conversion
and a decoder is left to M2, informed by whether anyone actually hits it.

**Disk.** A family library is unbounded and lands on the self-hoster's disk.
M1 enforces a per-file size cap and shows the library's total size; it does not
impose a quota, because it is their disk.

## 6. Testing

Pure logic — the aspect decision, the mime/size gate — is unit-tested. The
storage rules get the same treatment `rls-coverage.spec.ts` gives the others:
assert the bucket is private and that no client-facing write policy exists,
and prove the guard by breaking it.

# RFC-015 — More languages, and a place for translators

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-02 |
| **Target release** | unscheduled. §4 is worth doing whether or not a translation tool is ever adopted. |
| **Depends on** | RFC-014 (`holiday_region`, Settings → Holidays). The CONTRIBUTING.md "Licensing of contributions" grant. |
| **Source** | An i18n evaluation of `main` at `5f3945a` (2026-10-01), re-checked in the code for this RFC. Vendor pricing, terms and docs read on 2026-10-02, with pricing pages rendered in a browser because their numbers are drawn by JavaScript (§14). |

---

## 1. Why

Kinboard ships English, German and French. The maintainer writes German, and
French has been kept in step by hand since a contributor added it in #9. None of
the 19 issues or 11 discussions asks for another language. The code points at
two gaps all the same: the Netherlands is the only holiday country without a UI
language, and German-speaking families in Austria and Switzerland get German
formatting. RFC-014 fixes their holidays; this RFC fixes the formatting. The
maintainer also asked: *"Let's see if we may add proper Crowdin support or a
better community tool."* §5 answers that.

This RFC makes adding a language cheap and safe. Today a new language touches
14 places, and a partly translated one sends pushes that show raw key names. It
also picks a tool for outside translators and says when that tool becomes worth
running. It is a design document; no code.

---

## 2. Current state, in numbers

Paths are under `webapp/` at `5f3945a`.

| | |
|---|---|
| Library | `next-intl ^4.11.0`, with no locale in the URL. The locale comes from the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en` (`src/i18n/locales.ts`). |
| Bundles | `messages/{en,de,fr}.json`: **3,896 leaf keys each**, 54 namespaces, full parity |
| Source size | en has **14,456 words**. de has 13,613 and fr 16,583. |
| ICU | 72 `plural` messages, 0 `select`, 344 with placeholders, 11 rich-text. There are 0 argument-name mismatches between en and de/fr (parsed with `@formatjs/icu-messageformat-parser`). |
| Growth | en.json had 2,893 keys on 1 July, 3,465 on 1 September and 3,896 on 1 October: **+1,003 in three months, about 330 a month**, or roughly 1,200 source words a month at 3.7 words per key. 11 of the 82 commits on main in September touched en.json, and all 11 also touched fr.json. |
| Fallback (UI) | `src/i18n/request.ts` deep-merges the locale over en, so a missing key shows English |
| Fallback (server) | `src/lib/notifications/messages.ts`: `MESSAGES = { en, de, fr }`, with **no merge with English**. An unknown locale gets **German**, and a missing key renders as its path (`push.messageTitle`). |
| Family language | `getFamilyLocale()` falls back to **`de`**. `integration-attention.ts:75` falls back to **`en`**. A family with no `locale` row therefore gets German pushes and English Integration API texts. |
| Hardcoded German | `cron/todo-reminders/route.ts:182-187` ("Aufgabe fällig", "+N weitere"), `notifications/send-test/route.ts:57`, and push times formatted with `toLocaleTimeString("de-DE")` (`notifications/format.ts:25`) |
| CI | The `i18n-validate` job in `ci.yml` names the three files three times over. It enforces parity for `de` only (`STRICT = ["de"]`) and does **not** parse ICU. |
| Docs | CONTRIBUTING.md says adding a locale takes two steps and "you don't touch anything else". `docs/wiki/Themes.md` says "2200+ strings", lists `{en,de}`, and shows a registry API that no longer exists. |
| HACS integration | `kinboard-homeassistant/custom_components/kinboard/translations/en.json` only: **94 strings**, mirrored in `strings.json`. MIT-licensed. |

**What adding `xx` touches today**, beyond the registry and the bundle:

| Site | Effect if forgotten |
|---|---|
| `lib/date-fns-locale.ts`, `components/ui/calendar.tsx:19` (`RDP_LOCALES`) | English month names and date picker |
| `lib/notifications/messages.ts` | Pushes in German |
| `ci.yml` (three lists) | The file is not validated at all |
| `api/weather/route.ts:60`, `forecast/route.ts:80` (`["de","en","fr"]`, plus their own label tables) | English weather, German labels |
| `app/global-error.tsx` (inline `{en,de,fr}`) | English error screen |
| `app/shopping/page.tsx:176` (`recognition.lang`) | Voice input listens for English |
| `lib/safe-image-search.ts`, `lib/month-names.ts` | US image results; Immich albums not matched |
| `components/screensaver.tsx:1089` (`locale === "de" ? "d. MMMM" : "MMMM d"`) | Wrong birthday date order |
| `lib/waste-types.ts`, `lib/shopping-categories.ts`, the Bring catalogue | Bins and shopping categories not recognised |

**German-only data.** About 2,000 locale-specific data entries (shopping
keywords, units, the Bring catalogue, school pack lists, waste keywords) are
German-first or de/en/fr-only. §4.6 lists them with what a new language needs.

---

## 3. What this RFC decides

| Question | Decision |
|---|---|
| Where translations live | **In git**, `messages/*.json`, as now. Any tool syncs to the repo and never becomes the source of truth. |
| What to build first | The groundwork in §4, about 5–6 days, before any new language |
| Formatting for AT/CH | **From RFC-014's region**, not from new bundles. `de` plus `AT-9` formats as `de-AT`. |
| Tool | **No platform now.** Machine drafts plus a named reviewer per language, through pull requests. When outside translators arrive (§5.6), **self-host Weblate** on its own small server. **Do not pay for Crowdin.** |
| Languages | nl, a generated de-CH overlay, then it/es/pl only when a reviewer volunteers. **At most four maintained languages.** |

---

## 4. The groundwork, needed whatever tool is chosen

### 4.1 Server-side locale handling

1. **One family-locale helper, one fallback.** Fold the `integration-attention.ts`
   reader into `getFamilyLocale()`. An idempotent migration writes
   `locale = 'de'` for every family without a row (`ON CONFLICT DO NOTHING`;
   migrations run twice here), so existing installs stay German. After that the
   fallback is `DEFAULT_LOCALE` (`en`) everywhere.
2. **Server translators merge with English**, as `request.ts` does, and take
   their message map from the registry. A partial language then sends an English
   push title, not `push.messageTitle`.
3. **No hardcoded German.** `todo-reminders`, `send-test` and `debug-trigger`
   move into the `push` namespace with ICU plurals. So does the
   `use-meal-planner.ts:528` note ("Für N Rezepte").
4. **Locale-aware formatting.** Push times use the family's Intl tag (§4.3).
   `formatCents` takes the app locale instead of `undefined`. `settings/photos`
   drops `en-US`, and bare `toLocaleDateString()` calls get a locale.
5. Delete the dead German label maps in `types/home-assistant.ts`, and translate
   `Toggle theme` and the five literal `alt`/`aria-label` values.

**Family language, made explicit.** Today the last device to switch language
sets the family language (`POST /api/locale` with `familyId`), so one French
phone turns the kitchen's pushes French. Settings → Language gains a separate
**Family language** control ("used for notifications and assistants"). A
device switch writes the family row only if there is none.

### 4.2 One registry, so a language is one file plus one entry

`LOCALES` entries gain fields:

```ts
{ code: "nl", native: "Nederlands", bcp47: "nl-NL",
  status: "community",            // "maintained" | "community"
  parent: undefined,              // "de" for de-CH
  dir: "ltr" }
```

- A sibling `src/i18n/locale-data.ts` maps each code to its date-fns and
  react-day-picker locale, split between server and client so date-fns stays out
  of the registry. `getDateFnsLocale`, `RDP_LOCALES`, the weather allowlist and
  labels (moved into `messages`), `recognition.lang` (from `bcp47`),
  `month-names` and the image-search region are derived from it.
- `global-error.tsx` keeps its inline dictionary, because it has no provider. A
  unit test asserts that it has an entry for every registry code.
- `negotiateLocale` picks the **longest** matching tag, so `de-CH` beats `de`.
  `request.ts` chains the merge through `parent`: en, then de, then de-CH.
- **Locale content** moves to `src/lib/locale-content/<code>.ts`: shopping
  keywords, units, waste keywords, pack-item defaults and subject colours, with
  an English fallback. Minimal **en** and **fr** keyword lists come first, since
  English and French households get no automatic categories today.
- A unit test iterates `LOCALES` and fails when a data hook has neither an entry
  nor an explicit fallback. Forgetting a site becomes a red test, like
  `plugin-registry-i18n.spec.ts`.

### 4.3 Intl formatting from the RFC-014 region

RFC-014 adds `holiday_region = { code, chosen }`; the country is the first two
letters of `code`, and the region is never derived from the UI language. This
RFC uses it the other way round: **the region shapes formatting, never the
language.** `getIntlLocale(locale, region)` returns `${locale}-${country}` when
`Intl.DateTimeFormat.supportedLocalesOf` accepts it, else the registry's
`bcp47`. The client reads the region through `useSetting`, the server through
RFC-014's `familyHolidayRegion()`.

| Language + region | Intl tag | Visible difference |
|---|---|---|
| de + `AT-9` | `de-AT` | "Jänner", AT number style |
| de + `CH-ZH` | `de-CH` | `1’234.50` |
| fr + `CH-VD` | `fr-CH` | Swiss number style |
| en + `GB-ENG` | `en-GB` | day before month. A fix, but it goes in the changelog. |
| any + no region yet | registry `bcp47` | none: exactly as today |

Explicit settings still win: `week_start`, the 24-hour clock, `currency` and
`weather_units`. The Bring catalogue is chosen the same way
(`catalog.de-CH.json` when Bring publishes it, else the language default).
RFC-014's suggested rename to **"Language & region"** fits this too.

### 4.4 ICU checks in CI

`webapp/scripts/check-i18n.mjs` replaces the inline node in `ci.yml`. It globs
`messages/*.json` and reads `status` from the registry. It checks:

| Check | Maintained | Community |
|---|---|---|
| Valid JSON, no keys absent from en, no empty values | fail | fail |
| Missing keys | fail | report coverage |
| ICU parse (`@formatjs/icu-messageformat-parser`, already installed) | fail | fail |
| Argument names match en | fail | fail |
| Every `plural` has `other` | fail | fail |
| Plural categories required by `Intl.PluralRules(locale)` (`few`/`many` for pl) | fail | report |
| A de-CH overlay equals `de.json` with ß replaced, apart from listed exceptions | fail | — |

It writes a coverage table to the job summary. **Prove it fails** before trusting
it: break a placeholder in fr, drop `few` from a pl plural, and confirm both go
red.

### 4.5 Maintained and community languages

| | Maintained | Community |
|---|---|---|
| Coverage | 100%, enforced in CI | any |
| Review | A named native reviewer, listed in the registry comment and in CONTRIBUTING | best effort |
| New keys | Machine-drafted in the same PR as the English key (§7) | filled in by volunteers |
| In the switcher | as now | with a "Community · 74%" badge |
| README | listed | listed once it is at least 90% complete and reviewed |
| Cap | **four**: en, de, fr, plus one | none |

The cap exists because of churn: at about 330 keys a month, each maintained
language costs 1–2 hours a month of drafting and review. An unowned community
language drifts, which is acceptable because missing keys fall back to English.

### 4.6 The data a new language needs

| Data | Today | What a new language brings | Without it |
|---|---|---|---|
| Shopping keywords, units (`lib/shopping-categories.ts`, `shopping-input.ts`, recipe import) | About 1,735 German keywords, German units (EL, TL, Prise). "milk" and "lait" land in *Other*. | A keyword list and a unit table in `locale-content/<code>.ts` | English keywords, metric units |
| Waste keywords (`lib/waste-types.ts`) | de/en/fr. No GFT/PMD/restafval, no Kehricht/Grüngut. | Terms per bin type | English terms |
| Pack lists, subject colours (`lib/schedule-pack-items.ts`) | German for every family ("Sport → Sportkleidung") | Defaults keyed by local subject names | English defaults |
| Bring (`lib/catalog-search.ts:17`, `catalog-match.ts:19`) | Fixed to `catalog.de-DE.json` | Nothing, if Bring publishes the catalogue (nl-NL, de-AT, de-CH, it-IT, es-ES, pl-PL do) | language default, then de-DE |
| Recipe search (`api/recipes/search`) | Chefkoch, `de-DE` | **Nothing for now.** A provider abstraction is a separate RFC; the UI already says "Search Chefkoch.de". | German results, labelled |
| Recipe import | Sends `Accept-Language: de-DE` | Derived from the locale, plus the unit table | metric units only |
| News providers | `lang: "de" \| "en"` | Providers in the language, if any | English providers |
| Weather, voice, image search, Immich months | Hand-written lists | Nothing: derived from the registry (§4.2) | — |
| Holidays | RFC-014 | Nothing: date-holidays names in the UI language where it has them | English, then native |

### 4.7 CONTRIBUTING.md and the wiki

Rewrite CONTRIBUTING.md §Translations with the real steps, the two tiers,
`npm run i18n:missing -- nl` and how to propose a reviewer, and say that the
"Licensing of contributions" grant covers translations (§6.3). Fix
`docs/wiki/Themes.md`: the key count, `{en,de}`, the obsolete registry steps,
and the claim that the English fallback is "standard next-intl behavior" (it is
our `deepMerge`). Add a "Translate Kinboard into …" issue template that asks who
will review, and pin a discussion for the first volunteers.

---

## 5. The tool decision

### 5.1 What the tool has to do

Read and write nested next-intl JSON and hand back a **pull request**, so
squash-merge and CI stay the gate. Treat ICU as ICU. Let translators start
without git, ideally with a GitHub login. Offer translation memory, machine
suggestions and a reviewed state. Show the contribution terms before anyone
translates (§6.3). Cost little in money and maintainer time, and be easy to
leave.

### 5.2 Crowdin

**Pricing** (crowdin.com/pricing, rendered 2026-10-02, EUR excluding VAT). A
hosted word is "the number of words that should be translated multiplied by the
number of the project's target languages".

| Plan | Hosted words | Annual billing, per month | Monthly billing | Notes |
|---|---|---|---|---|
| **Free** | up to 60K | €0 | €0 | "Unlimited public projects", 1 integration, 1 branch, 3 file formats. Translators: "Public projects only". "*Users on a free plan donate translations to Crowdin's translation memory.*" |
| Pro | 60K / 80K / 110K / 160K | €46 / €61 / €68 / €81 | €54 / €72 / €81 / €96 | 2 integrations, 2 branches, **no in-context editor** |
| Team | 100K / 150K / 200K | €138 / €160 / €172 | €164 / €191 / €206 | In-context editor, webhooks, unlimited branches |

| Target languages on Crowdin | Hosted words now | Growth per month | Plan |
|---|---|---|---|
| fr, nl (de stays maintainer-written) | 28.9K | +2.4K | Free for about 13 months, then Pro 80K at **€61/month** |
| de, fr, nl | 43.4K | +3.7K | Free for **about 4 months**, then Pro 80K at €61/month |
| de, fr, nl, it, es, pl | 86.7K | +7.3K | Pro 110K at **€68/month**, then 160K at €81 within about 3 months |

A generated de-CH overlay lives in the repo and never counts.

**A free tier still exists, and it is not gated on an OSI licence.** That
corrects the evaluation, which looked only at the OSS programme. The catch is in
the terms. Crowdin Terms §12.6 covers data posted "publicly and/or via Public
Projects":

> "Client or User hereby grants Supplier and other Clients a perpetual,
> irrevocable, nonexclusive, royalty free license under all rights necessary to
> incorporate, publish, reproduce, distribute, modify, adapt, prepare derivative
> works of, publicly display, publicly perform, exploit and use such Client
> Data, unless otherwise stated in a written contract…"

A public Kinboard project would grant every Crowdin customer a royalty-free
licence to exploit the English copy and every translation. Under PolyForm
Noncommercial, with commercial licences on offer, the project should not make
that grant, unless `messages/` moves to a permissive licence anyway (§6.2).

**The OSS programme** lists nine conditions. Two fail on their face: "The
project is licensed under an approved license from an open-source initiative"
and "You do not have any commercial products related to the open-source project
you are requesting a license for." The pricing page says the programme is for
"non-profit projects". **An exception is implausible.** To ask anyway, use the
OSS form (licence "Other", plus the free-text description) or
crowdin.com/contacts, and ask in writing: (1) can a PolyForm Noncommercial
project with dual commercial licensing get the OSS plan; (2) if not, can a
written agreement exclude the project from §12.6; (3) can the free plan's
translation-memory donation be switched off?

**Integration**, from Crowdin's docs:

| | |
|---|---|
| GitHub | OAuth integration or the Crowdin GitHub Action, "Free" in the Crowdin Store. Syncs hourly by default and opens a PR from a service branch (`l10n_main`). |
| `crowdin.yml` | `source: /webapp/messages/en.json`, `translation: /webapp/messages/%two_letters_code%.json`, with `languages_mapping` for `de-CH`. Not next-intl's suggested `%locale%`, which would write `nl-NL.json`. |
| ICU | Arguments highlighted, syntax errors flagged, and "Copy Source" inserts "the number of plural categories right for the current target language". The JSON format itself says "Supports pluralization: No": ICU lives inside the string. |
| In-context | A pseudo-language build plus a JS snippet, **Team plan and up** (€138/month or more), and a special build that our cookie-based locale makes awkward |
| Screenshots, accounts | Screenshots on all plans. Translators need a Crowdin account; sign-in offers GitHub, GitLab and Google. |

**Verdict.** Technically the smoothest option. But the free plan's licence grant
conflicts with how Kinboard is licensed, the OSS plan is closed to it, and the
paid plans cost €61–81 a month for features we would barely use. **Not
recommended**, unless `messages/` is relicensed permissively and the maintainer
wants zero operations (§5.5).

### 5.3 The alternatives

Repository data was taken from GitHub on 2026-10-02.

| Tool | Licence, cost | Hosting | Translator login | ICU | next-intl JSON | GitHub PR flow | TM / MT | Review | Activity |
|---|---|---|---|---|---|---|---|---|---|
| **Weblate, self-hosted** | GPL-3.0, €0, every feature | Docker: weblate, PostgreSQL, Valkey. Minimum **3 GB RAM, 2 cores** | Own accounts. **GitHub login** is configurable. | `icu-message-format` check: syntax, placeholders, plural sub-messages. The translator edits the ICU text. | "JSON nested structure" format | **Native**: the GitHub pull-request backend pushes to a fork and opens or updates one PR | Built-in TM. MT via DeepL, LibreTranslate, OpenAI-compatible APIs and others. | Translated, needs editing and approved states, with dedicated reviewers. A **contributor agreement** must be accepted before translating. | Very active: `weblate-2026.10` released 2026-10-01, about 6.1k stars |
| Weblate, hosted | Libre plan needs OSI/FSF ("a license approved as libre by OSI or recognized as libre by FSF"). Paid: hosted strings = source strings × (languages + 1). | none | Weblate account, GitHub login | as above | as above | as above | as above | as above | as above |
| **Tolgee, self-hosted** | Apache-2.0 core, `ee/` under its own licence. Free **up to 10 seats**. SSO and "granular permissions" need a licence. | JVM and PostgreSQL. Minimum **4 GB RAM, 2 cores**, recommended 16 GB | Own accounts, GitHub login | **ICU-native**: the editor shows the plural forms per language | `JSON_ICU` with `.` as the nesting delimiter | **None built in**: `tolgee pull` in a scheduled GitHub Action, plus a create-pull-request step | TM, MT with your own keys | Untranslated, translated, reviewed | Very active: v3.224.11 on 2026-10-01, about 4.1k stars |
| Tolgee Cloud | Free: 30,000 words, 3 seats. Words count the base **and** every translation. Translate tier: 50K €58, 75K €74, 150K €113 per month, billed annually. OSS: "just email us, with no OSI-license gate". | none | as above | as above | as above | as above | 400K MT credits included | as above | as above |
| inlang (SDK, CLI, plugins) | No repo-level licence. Plugins on npm. €0. | none | n/a | `plugin-icu1` parses plurals and select. The **next-intl plugin does not** ("Plurals (ICU) ❌ Not supported"). Nested keys in `icu1` were not verified. | partial | Plain git, since it edits files in place | `machine translate` via the CLI | via PRs | Active: commits on 2026-10-01 |
| Fink (inlang editor) | **FCL-1.0-MIT** (source-available, MIT later). "Free Beta". | hosted at fink.inlang.com | not documented on its page | as inlang | as inlang | the page does not document how changes return | — | — | **Dormant**: package at `0.0.0`, last code change January 2026, and the README still asks people to upvote "a full release of Fink on the inlang sdk v2" |
| Sherlock (VS Code) | MIT | none | n/a: a developer tool | via inlang plugins | via plugin | n/a | — | — | Active (2026-09-16) |
| Pontoon | BSD-3-Clause, self-host only. Mozilla's instance serves Mozilla's projects, and the README sends "3rd party deployments" to GitHub Discussions. | Docker, PostgreSQL. Mozilla's own deployment docs are written for GCP. | GitHub, GitLab, Google or Mozilla accounts (allauth) | Built around Fluent. JSON only as key-value, with no ICU awareness. | key-value JSON | Commits to the repo directly | TM, MT | Yes | Active: v2026.09.23 |
| Traduora | AGPL-3.0, self-host | NestJS, MySQL | own accounts | none found | flat and nested JSON | none (only an unofficial CLI) | — | basic | Slow: v0.21.0 in June 2025, dependency bumps in July 2026 |
| Localazy | Free: **200 source keys**. Autopilot covers 3,500 keys (too few). Business: 10,000 keys at **$175/month** billed annually. Non-profits: "basic Localazy accounts for free"; more needs its Ambassador Program. | none | Localazy account | not verified | JSON supported | CLI, scriptable from an Action | ShareTM, MT | — | commercial |
| POEditor | OSS plan: "Open Source software projects with an OSI-approved licence" | none | account | — | — | — | — | — | ruled out for the free plan; paid tiers not priced here |
| Transifex | OSS: "OSI-approved license" and "no funding, revenue, or commercialization model" | none | — | — | — | — | — | — | ruled out |
| GitLocalize | Aimed at Markdown documentation. Its pricing page returns 404, and its blog was last updated in 2020. | none | GitHub | no | no | yes | TM | — | **Not a fit** |

### 5.4 The comparison that decides it

Assume three target languages (de, fr, nl) now and six later. Money is per
month, excluding VAT. Maintainer time is the ongoing cost, not the setup.

| | Money, 3 languages | Money, 6 languages | Maintainer time | Translator friction | Lock-in | Licence fit |
|---|---|---|---|---|---|---|
| **Git + machine drafts + reviewers** (no tool) | €0, plus a few euros of LLM tokens | same | Drafting is scripted, review is the reviewer's | **High**: a GitHub account, a 3,900-key file, rebases | none | clean |
| **Weblate, self-hosted** | €0 software, plus **a separate small server** (§5.6) | same | About 1–2 h/month: monthly releases, backups, spam accounts | Low: a web editor with GitHub login. Raw ICU text is harder than Tolgee's plural UI. | Low: files stay in git, Weblate pushes PRs | clean: own terms, CLA prompt built in |
| Weblate, hosted (paid) | 15.6K strings, 40K plan: **€58** (€700/year) | 27.3K, 40K plan, then 160K at €95 after about 5 months | none | Low | Low, and it is the same tool as self-hosted | the sign-in summary says contributions are under "the license defined by each project"; read the full terms before signing |
| Tolgee, self-hosted | €0 plus a server needing at least 4 GB | same | About 1–2 h/month, and a JVM | **Lowest** for plurals. In-context would mean replacing next-intl with `@tolgee/react` in 186 files, so in practice it is not available. | Low to medium: there is no native git sync, so we own an Action | clean |
| Tolgee Cloud | about 60K words, 75K tier: €74 | about 107K, 150K tier: €113 | none | Lowest | Medium | Free only if Tolgee says yes to an email |
| Crowdin Free, then Pro | €0 for about 4 months, then €61 | €68, then €81 | none | Low | Medium | **§12.6 grant and TM donation** |
| inlang / Fink | €0 | €0 | Low, but on a dormant beta | Unknown: Fink's write-back is undocumented | none | Fink is source-available (FCL) |
| Localazy | $175 | $175 | none | Low | Medium | non-profit route unclear |

### 5.5 Recommendation, and the fallback

1. **Now: no platform.** Build §4, then keep translations in git with machine
   drafts and a named reviewer per maintained language (§7). It costs €0 and is
   how fr is effectively maintained today. A platform helps only outside
   translators, and there are none yet.
2. **When §5.6's trigger fires: self-host Weblate** on its own small server,
   with GitHub login, the GitHub pull-request backend, the `icu-message-format`
   and `plurals` checks, and CONTRIBUTING's grant as the contributor agreement.
   It beats Tolgee here on four counts: it is PR-native (Tolgee needs an Action
   we would maintain); nothing is gated (Tolgee caps free seats at 10 and
   licenses granular permissions); the agreement is built in; and it can move to
   Weblate's paid hosting (€700 a year) without translators noticing.
3. **Do not pay for Crowdin.** The paid tiers buy nothing Weblate lacks for our
   use, and the free tier asks for a licence grant the project should not make.

**Fallbacks.** If translators struggle with raw ICU plurals in Weblate, switch
to **Tolgee self-hosted**; the files are the same, so that is about a day. If
the maintainer won't run a server: **hosted Weblate** at €700 a year, or, once
`messages/` is permissively licensed (§6.2), **Crowdin Free** with fr and nl,
which covers about a year of growth at €0. Not **inlang/Fink** while Fink is a
dormant beta and the next-intl plugin cannot read our plurals. **Sherlock** is
a harmless developer convenience.

### 5.6 When a platform becomes worth it, and where it runs

**Trigger:** at least **three people outside the maintainer** have contributed
translations in the last three months, **or** a fourth maintained language gets
a reviewer who will not use git. Until then a platform is a public,
authenticated service secured for nobody.

**Hosting.** The server that runs kinboard.app and the demo was checked on
2026-10-02 and has nowhere near the free memory either tool needs:
**Weblate's 3 GB minimum and Tolgee's 4 GB minimum do not fit**, and rescaling
it would put an account-holding service beside the public demo. Use a
**separate** 4 vCPU / 8 GB cloud server (CX33 or CAX21 class) at
`translate.kinboard.app`; check the current price in the console, since the
price list did not render during research. Back it up like prod, with a
verified `pg_dump` before every upgrade.

---

## 6. The licence question

This is the maintainer's call. These are options, not recommendations.

**6.1 Ask a vendor for an exception.** Crowdin: unlikely, because two of nine
conditions fail outright, but the §12.6 carve-out is worth asking about
(§5.2). Tolgee: possible, since it advertises "no OSI-license gate"; email
info@tolgee.io and get the answer in writing. Weblate Libre: unlikely
(OSI/FSF), and its paid hosting is cheap enough not to need it.

**6.2 A separate licence for `webapp/messages/`.** Add
`webapp/messages/LICENSE` (MIT or CC BY 4.0) and a NOTICE line saying that
PolyForm does not cover that folder. Translations are then contributed under it.

- *What it changes:* translators license under terms they know, and anyone,
  commercial forks included, may reuse the UI copy. The code stays PolyForm.
  It removes the Crowdin §12.6 conflict. It also matches history: the French
  translation (#9, 2026-06-04) was contributed while Kinboard was MIT. The
  project went PolyForm on 2026-09-30 (#291).
- *Which licence:* MIT is OSI-approved. CC BY 4.0 is recognised by the FSF as
  free for non-software works but is **not** OSI-approved, so it helps only
  where FSF recognition counts (Weblate).
- *What it does not change:* every platform judges the project, not a folder.
  Crowdin requires that "the **project** is licensed under…", and separately
  that there are no related commercial products, which still fails. Transifex
  requires "publicly available **source codes** licensed under an OSI-approved
  license" and "no … commercialization model", which still fails. POEditor
  covers "Open Source **software projects**", and the software stays PolyForm.
  Weblate's "your libre project" is the one case where a component holding only
  MIT JSON might be judged differently. Ask; don't assume.

So a folder licence does not open the OSS programmes. It settles what
translators license, and it makes a Crowdin public project acceptable.

**6.3 A CLA or translation terms.** CONTRIBUTING.md's grant (PolyForm, plus a
perpetual licence to Sven Rosema to relicense) already covers translations sent
by PR. Platform translators never see CONTRIBUTING. Weblate's per-project
**contributor license agreement** must be accepted before translating, so the
same text goes there; Crowdin and Tolgee offer only a project description. Keep
the grant even under §6.2, since it is what allows relicensing later.
**Trademark:** "Kinboard" stays untranslated (a "do not translate" glossary
entry). Under TRADEMARK.md, a third party publishing a translated build under
the Kinboard name is distributing "a modified version under the name Kinboard"
and needs permission, which is one more reason to steer translators upstream.
A hub at `translate.kinboard.app` is the project's own use of the name.

---

## 7. Workflow: how a key reaches translators and back

**Without a platform** (from §4 onwards):

1. A feature PR adds the English key and the German text, written by the
   maintainer.
2. `npm run i18n:draft` fills the other **maintained** languages with an LLM
   draft, using the namespace and neighbouring keys as context. It records the
   keys in `messages/.review/<locale>.json`, the unreviewed list.
3. CI runs §4.4. A draft counts as complete. CI checks correctness; the review
   list tracks quality.
4. A scheduled job keeps one issue per maintained language current ("nl: 42
   keys awaiting review") and pings its reviewer, whose PR clears the list.
5. Community languages get no drafts. Volunteers run `i18n:missing` and send a
   PR. Missing keys show English.

**With Weblate** (after §5.6): steps 1–3 are unchanged. Weblate picks up new
keys from `main` by webhook. Drafts arrive as "needs editing", and reviewers
approve them. Weblate keeps **one** open PR, "Translations update from
Weblate", which is squash-merged and checked like any other. Weblate's states
replace the review list.

**Who reviews.** de: the maintainer. fr: a French reviewer still to be found;
until then fr is maintained but marked "drafts unreviewed". nl: whoever
volunteers, and nl stays community until someone does.

**Releases.** The RC window is the translation window. There is no string
freeze, because churn makes one impractical. For a stable release, maintained
languages must be complete, and unreviewed drafts may ship if the release notes
give the count per language. Community languages ship at any coverage, with
their badge. A community language **below 50%** is hidden from the switcher,
unless a device already uses it.

---

## 8. Language priorities

| Order | Language | Tier | Why | Effort |
|---|---|---|---|---|
| 1 | **nl** | community, then maintained once reviewed | The only holiday country without a UI language. Bring nl-NL exists. OpenWeatherMap supports it. No new plural categories. | About 1 day of draft plus review time. About 0.5 day of data (waste, keywords, units). |
| 2 | **de-CH** overlay | follows de | 53 of 3,896 German strings contain ß. The overlay is generated by replacing ß with ss, then checked by hand, and CI keeps it in sync (§4.4). | About 0.5 day after §4.2 |
| — | de-AT, de-CH, fr-CH formatting | not a bundle | §4.3, from RFC-014's region | included in §4.3 |
| 3 | **it** | community | Switzerland's third language (it-CH Bring), and Italy | About 1 day of draft, plus a reviewer |
| 4 | **es** | community | The largest reach, but no signal yet | same |
| 5 | **pl** | community | The first language needing `few`/`many`, which tests §4.4 | same |
| — | sv, da | on request | OpenWeatherMap yes; Bring sv-SE yes, da-DK no | — |
| — | RTL (ar, he) | not now | 546 physical Tailwind utilities against 3 logical ones, and 107 directional icons. About 1–2 weeks. | — |

Languages 3–5 ship only with a volunteer reviewer, or as labelled community
languages. **Four maintained languages at most** (§4.5).

---

## 9. The HACS integration

`kinboard-homeassistant` has only `translations/en.json`: 94 strings across
`config`, `entity` and `services`, mirrored in `strings.json`. Home Assistant
shows the HA user's language, whatever language Kinboard runs in. Add `de.json`
first, then `fr.json` and `nl.json`, at about 1–2 hours each, and add a test
that every file has exactly the keys of `strings.json`. Ninety-four rarely
changing strings don't need a tool; a PR per language is enough. The
integration is MIT, so it would qualify for OSS plans on its own, but at this
size that doesn't matter. Values that come from Kinboard, such as attention
titles, already arrive in the family language.

---

## 10. Phasing

| Phase | What | Effort (focused days) | Ships behaviour? |
|---|---|---|---|
| **0** | §4.1: one family-locale helper and its migration, server merge with English, the German pushes, formatting leaks, the Family language control | **1.5–2** | yes: correct push language and time format for fr families and future languages |
| **1** | §4.2 and §4.3: registry fields, `locale-data`, derived sites, longest-match negotiation, parent chain, `locale-content` with en/fr keywords, region-derived Intl tag and Bring catalogue. Needs RFC-014 Phase 1 for the region. | **2.5–3** | yes: de-AT, de-CH, fr-CH and en-GB formatting; shopping categories for en/fr |
| **2** | §4.4 CI script, proved to fail | **0.5** | no |
| **3** | §4.7 docs, `i18n:missing`, `i18n:draft`, review issue job, issue template | **0.5–1** | no |
| **4** | nl (community), de-CH overlay, HACS de/nl | **2.5**, plus review time | yes |
| **5** | Only on the §5.6 trigger: Weblate on its own server, GitHub login, PR backend, checks, agreement, glossary, backups | **1–1.5**, plus about 1–2 h/month | yes, for translators |

**Phases 0–4 total about 7.5–9 focused days.** Phase 0 stands on its own.
Phase 1 waits for RFC-014's region, apart from the registry part. Phase 5 may
never happen, and that is fine.

---

## 11. Testing

- **Server fallback:** a partial locale gives an English push title, never a
  key path. After the migration, an old family gets German and a new one
  English. A second migration run changes nothing.
- **Registry:** every `LOCALES` entry resolves at every derived site. Removing
  `nl` from `locale-data` turns the spec red.
- **Intl:** de with `AT-9` renders "Jänner", de with `CH-ZH` renders
  `1’234.50`, and a null region matches today's output. Run in WebKit too.
- **Negotiation:** `de-CH` gives de-CH, `de-AT` gives de, `nl-BE` gives nl.
- **CI script:** the three sabotage cases in §4.4 go red.
- **Switcher:** the community badge, and hiding below 50%, checked in WebKit
  with long labels.

---

## 12. Out of scope

RTL. A recipe-provider abstraction. Translating Integration API errors and MCP
tool descriptions, which stay English by design. A UI language per person.
Paid translation services.

---

## 13. Risks and open questions

- **The licence of `messages/` (§6.2).** This is the biggest open question. It
  decides whether any hosted platform's terms are acceptable and what
  translators license, and it is cheaper to settle before the first outside
  translation.
- **Churn.** At 330 keys a month, an unowned language decays within a quarter.
  The mitigations are the cap, same-PR drafts and the review issue. **Open:** is
  a fourth maintained language worth having before nl has a reviewer?
- **Unreviewed drafts** can pass for reviewed. The review list and the
  release-note counts make them visible, but someone has to read them.
- **Family language.** **Open:** a separate control (§4.1), or a "use for
  notifications" checkbox? And should setup ask for it, as RFC-014's wizard asks
  for the region?
- **Weblate operations** add a public service that holds accounts. If 1–2 hours
  a month turns into more, Weblate's hosted plan keeps the same tool and PR
  flow.
- **Vendor terms change.** Crowdin's free tier, Tolgee's OSS offer and
  Localazy's limits are as read on 2026-10-02. Re-read them before acting.
- **Not verified here:** whether inlang's `icu1` plugin handles nested JSON, how
  Fink authenticates and writes back, and Hetzner's current price for an 8 GB
  server.

---

## 14. Sources

Read on 2026-10-02.

- **Crowdin:** pricing, rendered with the calculator, <https://crowdin.com/pricing>;
  terms §5.6 and §12.6, <https://support.crowdin.com/terms/>; OSS conditions,
  <https://crowdin.com/page/open-source-project-setup-request>; GitHub,
  <https://support.crowdin.com/github-integration/> and
  <https://store.crowdin.com/github>; config,
  <https://support.crowdin.com/developer/configuration-file/>; ICU,
  <https://support.crowdin.com/icu-message-syntax/>; JSON,
  <https://store.crowdin.com/json/>; in-context,
  <https://support.crowdin.com/in-context-localization/>; login options,
  <https://accounts.crowdin.com/login>. next-intl's Crowdin guide:
  <https://next-intl.dev/docs/workflows/localization-management>.
- **Weblate:** <https://weblate.org/en/hosting/> (plans and the hosted-strings
  formula); Libre eligibility,
  <https://weblate.org/en-gb/news/archive/weblate-even-more-open-now/> (27 Nov
  2020); <https://docs.weblate.org/en/latest/admin/install/docker.html>,
  <https://docs.weblate.org/en/latest/user/checks.html>,
  <https://docs.weblate.org/en/latest/formats/json.html>. The GitHub PR backend
  (`docs/vcs.rst`) and the contributor agreement (`docs/admin/projects.rst`)
  are in <https://github.com/WeblateOrg/weblate>.
- **Tolgee:** <https://tolgee.io/pricing> (rendered with the slider),
  <https://tolgee.io/tolgee-vs-crowdin> (OSS offer),
  <https://docs.tolgee.io/platform/self_hosting/getting_started>,
  <https://docs.tolgee.io/tolgee-cli/project-configuration>,
  <https://docs.tolgee.io/js-sdk/integrations/react/next/app-router>, and
  `LICENSE` in <https://github.com/tolgee/tolgee-platform>.
- **inlang:** <https://github.com/opral/inlang> (`packages/fink`,
  `packages/plugins/next-intl`, `packages/plugins/icu1`),
  <https://inlang.com/m/tdozzpar/app-inlang-finkLocalizationEditor>,
  <https://github.com/opral/sherlock>.
- **Others:** <https://github.com/mozilla/pontoon> (`pontoon/settings/base.py`,
  `pontoon/sync/formats`), <https://github.com/ever-co/ever-traduora>,
  <https://localazy.com/pricing> and its FAQ,
  <https://poeditor.com/kb/open-source-localization>,
  <https://help.transifex.com/en/articles/6236788-open-source-projects>,
  <https://gitlocalize.com>.
- **Hetzner:** <https://www.hetzner.com/cloud/cost-optimized/>, where sizes
  rendered but prices did not.
- **Kinboard:** the files cited in §2, CONTRIBUTING.md, TRADEMARK.md, PR #9, PR
  #291, and RFC-014 (PR #320). Key counts are from `git show` of `en.json` at
  the last commit before each date. September commits are counted by author
  date on `origin/main`.

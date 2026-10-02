# RFC-014 — Holidays from maintained sources

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-10-02 |
| **Target release** | unscheduled. Phase 1 is worth doing on its own (§10). |
| **Depends on** | PR #319 as merged (holiday countdown, `dayOff`, observed days, observances, the NL King's Day and Liberation Day fixes); `school_holidays`; `calendars.is_holidays`; `lib/safe-fetch.ts`; RFC-001 and RFC-012 §4 (`GET /schedule`, `school_tomorrow`) |
| **Source** | Research on 2026-10-02: `date-holidays@3.37.0` run locally, the OpenHolidays API queried live, licences read at source (§14) |

---

## 1. What this is for

Kinboard knows two kinds of holiday, and both are maintained by hand.

- **Public holidays** come from five lists written in the repo. Germany has one
  list, Niedersachsen's. A Bavarian family gets no Fronleichnam, a Saxon family
  no Buß- und Bettag, a Berlin family no Frauentag. A German-speaking family in
  Vienna or Zürich cannot pick their country at all, so they get Niedersachsen.
- **School holidays** are typed in by the family, or come from a calendar they
  mark as holidays. Nothing is fetched. A family that skips this has the board
  telling a child to pack a sports kit in August.

This RFC moves both to free, maintained sources. Every manual path keeps
working, and the family's own entries and calendars always rank above fetched
data. It is a design document; no code.

---

## 2. What exists today

Paths are under `webapp/` and refer to `main` at `5f3945a` with #319 merged.

### 2.1 Public holidays, and how the country is chosen

| Piece | Where | Notes |
|---|---|---|
| Rule lists | `src/lib/holidays/{de,fr,nl,uk,us}.ts`, helpers in `utils.ts` | `de.ts` is Niedersachsen only. UK is England & Wales. |
| Public API | `src/lib/holidays/index.ts`: `getHolidays`, `getUpcomingHolidays`, `getObservances`, `nextHolidays`, `daysUntilHoliday`, `CountryCode`, `COUNTRIES`, `DEFAULT_COUNTRY` | `observedDays()` hand-codes the US 5 U.S.C. 6103(b) rule and the UK "next free weekday" rule |
| Shape | `types.ts`: `Holiday { nameKey, date, emoji, dayOff }`; `UpcomingHoliday.observed` | Names come from the next-intl `holidays` namespace |
| Readers | `src/lib/calendar-markers.ts` (`holidaysByDay`, #299/#307), `src/app/calendar/page.tsx:304,1164,1321`, `src/components/widgets/holiday-widget.tsx` (#319), deprecated `src/lib/german-holidays.ts` | All run **client-side** and synchronously |

**The country.** #319 describes it as "the family's country (Settings →
Language)". That phrase gives the location, not the source. The country is
already a separate settings row, `holiday_country` (`src/lib/settings-keys.ts:8`),
and no code derives it from the UI locale. Three things still tie it to
language and to Germany:

- It is set on the **Language** page (`src/app/settings/language/page.tsx:34,82`),
  next to the language picker, labelled "Public holidays shown on the calendar
  are based on this country".
- A family that has never picked a country gets **`DEFAULT_COUNTRY = "de"`**,
  whatever its language or timezone. The fallback is repeated in
  `calendar/page.tsx:304` and in the widget. Nothing writes the row during
  setup.
- `CountryCode` is a closed union of five codes, so Austria and Switzerland
  cannot be expressed.

### 2.2 School holidays

| Path | Where |
|---|---|
| `school_holidays (family_id, name, starts_on, ends_on)`: an inclusive `DATE` range, family-wide, no `source` column | `docker/migration_school_holidays.sql`; RLS in `migration_zz_row_level_security.sql`; hooks in `src/hooks/use-supabase-queries.ts:1763-1850`; the card in Settings → Schedule (`src/app/settings/schedule/page.tsx:981-1033`) |
| Events on a calendar flagged `is_holidays` | `docker/migration_calendar_is_holidays.sql`; toggles in `settings/ics/page.tsx:527`, `settings/caldav/page.tsx:659`, `settings/google/page.tsx:517`, `setup/calendar/page.tsx`. **Local calendars have no toggle** (`settings/local-calendars`), although the column is there. |

Both paths feed `fetchSchoolBreaks()` in `src/lib/school-days.ts`. It returns
`SignalSchoolBreak { name, startsOn, endsOn, source: "manual" | "calendar" }`
(`src/lib/attention/types.ts:88`), and `isSchoolBreakOn()` takes the first range
that covers the day. Every "is there school?" question goes through it: the
Heute-Motor rules (`attention/signals.ts:174`, `rules.ts:115,162`),
`GET /api/integration/v1/schedule` (`SchoolDay` in `openapi/integration-v1.yaml`),
the summary's `school_tomorrow` (`family/summary/route.ts:255,545`), MCP
`get_school_timetable` (`src/lib/mcp/server.ts:515`, `family:read`), and the
HACS sensor (`kinboard-homeassistant/.../sensor.py:65`).

**A gap this RFC closes.** Public holidays never reach `school-days.ts`, so on a
weekday Tag der Deutschen Einheit `school_tomorrow` says there is school.

Background jobs are `/api/cron/*` routes protected by `CRON_SECRET`. They are
scheduled by ofelia labels in `docker/docker-compose.yml` (and
`docker/ofelia.demo.ini`), which call scripts written into the image by
`docker/Dockerfile`.

---

## 3. Sources considered

| Source | Data licence | Coverage (verified) | Verdict |
|---|---|---|---|
| **date-holidays** (npm) | Code ISC. Data **CC BY-SA 3.0**, from Wikipedia. The LICENSE file says BY-SA; `package.json` says `CC-BY-3.0`. The stricter one applies. | 207 countries, rule-based, no horizon. DE has 16 Länder, **AT 9 Bundesländer**, **CH 26 cantons**, GB 5 nations, US states | **Public holidays** (§4) |
| **OpenHolidays API** | Data **ODbL 1.0**, server AGPL-3.0 | School holidays for 36 countries, including DE, **AT**, **CH**, NL, FR (§5.3). **No GB, no US.** | **School holidays** (§5) |
| Nager.Date | Code MIT, but offline use "require[s] a license key" (sponsors only). Hosted ToS: "private or non-profit projects", no "own holiday portal", terms can change at any time. | Public holidays; school *days* only | Rejected: .NET only, ToS risk, nothing date-holidays lacks |
| ferien-api.de | Code MIT. **The data repo has no licence.** | DE only, incomplete for 2026 and later | Rejected: data all rights reserved; rate limiting the authors describe as "aggressive" |
| Mehr-Schulferien | No licence, "All rights reserved" | DE down to individual schools | Out of scope (§11), worth asking |
| GOV.UK `bank-holidays.json`, Rijksoverheid, education.gouv.fr | OGL v3 / CC0 / Licence Ouverte | One country each | Test oracle (GOV.UK) and per-country fallbacks (§13) |

---

## 4. Public holidays: date-holidays, bundled and offline

### 4.1 Packaging

- Add **`date-holidays-parser`** (ISC) as a runtime dependency and
  **`date-holidays`** as a dev dependency, both pinned to an **exact version**
  (`3.37.0` and the 3.4.x parser it brings, with no caret). A bump is its own
  PR and must keep §4.6 green.
- Generate the data with the pinned package's own
  `scripts/holidays2json.cjs --pick <offered countries> --min` and commit it as
  `src/lib/holidays/data/holidays.json`, with date-holidays' LICENSE beside it.
  Measured sizes: 20 KB gzipped for today's five countries, **41 KB gzipped for
  the 38 offered in §4.3**. The full build is 244 KB. Holidays stay synchronous
  on the client, so **callers keep their calls**. Computing them on the server
  would turn three client call sites into fetches.
- The adapter replaces the bodies of `getHolidays`, `getObservances` and
  `observedDays`. `nextHolidays`, `daysUntilHoliday`, `UpcomingHoliday` and
  #319's two-year window do not change.
- Dates come from `h.date.slice(0, 10)`, read as a local date. **Never use
  `h.start`**, which is a timezone-dependent instant. #319's spec passes in four
  timezones because it never touches instants.
- We never patch the upstream YAML, since a patched copy would be an Adaptation
  under CC BY-SA. Data fixes go upstream as pull requests. Our own decisions
  live in §4.5.

### 4.2 Country and region: one setting of its own, with a migration

- Add **`holiday_region`**, a settings row with the value
  `{ "code": "<ISO 3166-2 or ISO 3166-1>", "chosen": boolean }`, for example
  `DE-NI`, `AT-9`, `CH-ZH`, `GB-SCT`, `US-CA`, or a bare `NL`. The country is
  the first two letters. The `uk` country maps to `GB`, and date-holidays'
  numeric AT states map to `AT-1`…`AT-9`.
- It moves to its own page, **Settings → Holidays** (`settings/holidays`). That
  page holds a country picker and a state/canton picker, both filled from
  §4.3's data, plus the school-holiday card from §6.4. The card moves there
  from Schedule, which keeps a one-line link to it. The Language page loses the
  country picker and keeps a link. **Nothing reads the UI locale to choose a
  region**: a German-speaking family can pick DE, AT, CH or anywhere else.
- **Migration, so existing families keep what they effectively have.** It is a
  SQL migration and must be idempotent: `INSERT … ON CONFLICT (family_id, key)
  DO NOTHING`, because migrations run twice here. It writes a `holiday_region`
  row for every family, mapping each one's *effective* country, which means
  the `de` fallback when no row exists:

  | `holiday_country` today | `holiday_region` written |
  |---|---|
  | none, or `de` | `{ code: "DE-NI", chosen: false }` |
  | `uk` | `{ code: "GB-ENG", chosen: false }` |
  | `us` | `{ code: "US", chosen: false }` (federal only, as today) |
  | `nl` / `fr` | `{ code: "NL" / "FR", chosen: false }` |

  `chosen: false` records that no one in the family picked this value.
  §5.4 depends on that. `holiday_country` is kept for one release, read by
  nothing, and dropped in the release after, following the pattern from
  RFC-006 §3.2.
- **New families** get no fallback country. The setup wizard asks for country
  and region in its first step, and preselects a country from the family's
  `timezone` setting (`Europe/Vienna` gives AT, `Europe/Zurich` gives CH),
  never from the language. Until the wizard has run, the region is `null`. No
  holidays are marked and no school sync runs. An empty board is better than
  one that is confidently wrong.
- The server reads the setting through one helper, `familyHolidayRegion()`,
  next to `familyTimeZone()` in `src/lib/family-time.ts`. The client reads it
  through `useSetting`. Changing the country clears the region part.

### 4.3 Which countries are offered: a rule, not a list

**Rule: offer every country that date-holidays covers *and* that either has
school-holiday data in OpenHolidays or has a hand-written list today.**

- That gives the 36 OpenHolidays countries, all of which are in date-holidays
  (checked against both country lists), plus GB and US: **38 countries**. AD,
  AL, AT, BE, BG, BR, BY, CH, CZ, DE, EE, ES, FR, GB, HR, HU, IE, IT, LI, LT, LU,
  LV, MC, MD, MT, MX, NL, PL, PT, RO, RS, SE, SI, SK, SM, US, VA, ZA.
- The generator script writes this list into `holidays.json` at generation
  time. A list of country codes is not a substantial part of the ODbL database.
  The UI never hard-codes country codes.
- `CountryCode` becomes `string`, validated against the generated list.
  Offering all 207 countries would need the data loaded per country on demand
  (§13).
- **How deeply each country is curated** differs, and the picker says so where
  it matters:

| Tier | Countries | What Kinboard adds on top of the data |
|---|---|---|
| Curated | DE, AT, CH, FR, NL, GB, US | Kinboard `nameKey` and emoji for every holiday in en/de/fr. Marked lists and observance allowlists (§4.4). Oracle or spot-check tests (§4.6). |
| Data-only | the other 31 | Public holidays only, no observances. Names and emoji as described below. |

**Names in a language we haven't translated.** date-holidays uses a shared
`names.yaml` that covers common holidays (New Year, Easter Monday, Christmas)
in many languages. Country-specific holidays carry only the country's own
languages plus English, if that. Measured per country: AT `de-at, de, en`, CH
`de-ch, de, fr, it, en`, BE `fr, nl, de, en`, PL `pl, en`. The parser is
constructed with `languages: [uiLocale, "en"]`. The label order is:

1. Kinboard's `nameKey` (curated countries)
2. the upstream name in the UI language
3. English
4. the native name

That can produce a mixed list. In French, an Austrian family sees "Lundi de
Pâques" next to "Staatsfeiertag", and a German-UI Polish family sees
"Constitution Day". We accept this and do not hide it, because a real name in
another language beats a blank or a key. Translations sent upstream to
`names.yaml` fix it for everyone. Unmapped holidays get a generic 📅. `Holiday`
gains an optional `name` for this case, and the three places that render a
name read it through `holidayLabel(h, t)`.

### 4.4 Mapping date-holidays types onto #319's concepts

| date-holidays | In `getHolidays` (calendar) | `dayOff` | In `getObservances` (countdown) | School (§6.3) |
|---|---|---|---|---|
| `public` | yes | **true**, unless the holiday always falls on a Sunday (below) | — | no school, except in US |
| `public` with `substitute: true` | not a separate `Holiday`. It becomes `observed` on the holiday it replaces, paired by English name without "(substitute day)" and searched across both years, so New Year 2028 pairs with 31 Dec 2027 | — | — | no school on that day, same exception |
| `bank` | only if on the country's marked list (DE and AT Heiligabend and Silvester, half days from 14:00) | false | — | none |
| `school` (single-day closures: DE-BY Buß- und Bettag, NL Goede Vrijdag and Bevrijdingsdag) | if on the marked list | false, unless overridden | — | **no school** |
| `optional` (AT Leopoldi, CH-ZH Berchtoldstag, US Christmas Eve) | if on the marked list | false | if on the allowlist | none |
| `observance` | if on the marked list (DE Ostersonntag, Pfingstsonntag) | false | if on the allowlist (US: Valentine's, St Patrick's, Easter, Mother's, Father's, Halloween, New Year's Eve) | none |

- **Holidays that always fall on a Sunday.** A holiday whose rule always lands
  on a Sunday is marked, but not as a day off: Easter Sunday, Whit Sunday, and
  the Swiss Eidgenössischer Bettag, which CH data lists as `public`. The
  adapter applies this generically, so none of them needs an override (§4.5).
  Fixed-date holidays that happen to fall on a Sunday keep `dayOff: true`, as
  in #319.
- Marked lists and observance allowlists are short Kinboard tables, one per
  curated country. date-holidays has many more observances than a family board
  wants (Tax Day, four Advent Sundays, Volkstrauertag), so anything not listed
  is dropped. Data-only countries show `public` holidays only.

### 4.5 Overrides: the deliberate differences, kept in the repo

`src/lib/holidays/overrides.ts` holds entries of the form
`{ country, englishName, dayOff?: boolean | (year) => boolean, marked?, why }`.
They are applied after the mapping. An override never changes a *date*: a wrong
date is an upstream bug, so it is reported there and pinned around until fixed.
The list starts with #319's NL decisions:

| NL holiday | date-holidays | #319 as merged | Resolution |
|---|---|---|---|
| Easter Sunday, Whit Sunday | `public` | marked, not a day off | the Sunday rule (§4.4), no override |
| Liberation Day | `school` every year | a day off only when `year % 5 === 0` | **override** `dayOff: (y) => y % 5 === 0` (most CAOs) |
| Good Friday | `school` | not a day off | none: `school` maps to not a day off |
| King's Day | 26 April when the 27th is a Sunday | the same since #319 | none: verified for 2025 and 2031 |

### 4.6 Acceptance: the new layer must reproduce #319, or say why not

The five hand-written files move unchanged to `e2e/fixtures/holidays-oracle/`,
where they serve as the drift guard. `holiday-sources.spec.ts` compares the
adapter with the oracle for **every year from 2020 to 2035**, one date at a
time: the dates, `dayOff` and the `observed` pairing. Every difference must be
listed in an expected-differences table in the spec, with a reason. Running
3.37.0 through the §4.4 mapping already gives:

| Country | Differences 2020–2035 | Observed days | Status |
|---|---|---|---|
| DE (NI) | 0 | — | — |
| FR | 0 | — | — |
| NL | 0 after §4.4–4.5 (raw: Easter Sunday ×16, Whit Sunday ×16, Liberation Day ×4) | — | — |
| UK (ENG) | 7: the one-off proclamations that #319 cannot model (2020 VE Day move; 2022 Spring bank holiday move, Platinum Jubilee, state funeral; 2023 Coronation) | 0 | **date-holidays is right**, so these are accepted, checked against GOV.UK JSON |
| US | 1: Juneteenth 2020, which was not federal until 2021 | 0 | **date-holidays is right**, accepted |

For years with an oracle the switch therefore changes nothing a family would
call a regression, and it corrects eight past dates. AT and CH have no oracle.
Phase 1 adds a short spot table for 2026–2027 (AT-9, CH-ZH, CH-VD, CH-TI),
checked against the federal and cantonal calendars when it is written.
#319's `holiday-countdown.spec.ts` and `calendar-markers.spec.ts` run
unchanged. A second check regenerates `holidays.json` from the pinned package
and fails if it differs from the committed file.

---

## 5. School holidays: the OpenHolidays API, synced into `school_holidays`

### 5.1 Data model

An idempotent migration adds to `school_holidays`:

| Column | Type | Meaning |
|---|---|---|
| `source` | `TEXT NOT NULL DEFAULT 'manual'`, `CHECK (source IN ('manual','openholidays'))` | Every existing row becomes `manual` |
| `external_id` | `TEXT`, `CHECK ((source = 'manual') = (external_id IS NULL))` | The OpenHolidays `id` (a UUID) |
| `hidden` | `BOOLEAN NOT NULL DEFAULT false` | The family said "not for us" (§6.2) |
| `synced_at` | `TIMESTAMPTZ` | When the sync last saw the row |

It also adds a unique index on `(family_id, source, external_id) WHERE
external_id IS NOT NULL`. RLS limits `anon` writes to `source = 'manual'`. Only
the server (service role) writes synced rows, and hiding a row goes through a
session route. Otherwise a stale tab could edit a fetched row, and the next
sync would quietly undo the edit. Status is kept in a settings row,
`school_holiday_sync`:
`{ enabled, region, group, last_success_at, last_error_at, last_error }`.

### 5.2 The job

- **`POST /api/cron/sync-school-holidays`** is wired like `sync-ics`: a
  `CRON_SECRET`, a script in the Dockerfile, and an ofelia label in
  `docker-compose.yml` and `ofelia.demo.ini`. The label is `@every 24h`, and
  each run syncs only the families whose last success is **more than 7 days**
  old. ofelia's `@every` counts from container start, so installs spread across
  the day instead of all hitting one small API at 03:00.
- It also runs for one family when the switch is turned on, when the region
  changes, and on **Refresh now** in the card. These go through a session route
  limited to once a minute per family.
- One request per run:
  `GET https://openholidaysapi.org/SchoolHolidays?countryIsoCode=…&subdivisionCode=…&validFrom=today−30d&validTo=today+1094d&languageIsoCode=…`.
  The API refuses more than 1095 days ("The maximum date range is 1095 days").
  The request goes through `safeFetch` with `signal: AbortSignal.timeout(10_000)`,
  requires `application/json`, caps the body at 1 MB, and validates the
  response with zod before anything is written.
- **Only `type === "School"` rows are kept.** The API also returns
  `BackToSchool` rows (CH-GR "Schulbeginn", seen live) and `EndOfLessons` rows
  (FR). Storing those would mark the first day of school as a holiday. A row
  is also dropped when its `groups` exclude the family's group (§5.3).
- **One transaction, written only after a fully valid response:**
  - Upsert by `(family_id, 'openholidays', external_id)`, setting `name`,
    dates and `synced_at`. `hidden` is never touched.
  - Delete `openholidays` rows that are missing from the response *and lie
    inside the requested window*. Older rows stay as history.
  - Every write statement names `source = 'openholidays'`, so **a manual row
    cannot match**. §12 proves this rather than assuming it.
- **On any failure, existing rows stay.** That covers DNS, a timeout, 4xx or
  5xx, invalid JSON, a schema mismatch, and an empty array where the last run
  had future rows. The job records the error and logs it to the journal, and
  the card shows "Last updated 12 Sep · couldn't reach OpenHolidays on 2 Oct".
- `fetchSchoolBreaks()` keeps reading the table. Synced rows report
  `source: "openholidays"`.

### 5.3 Coverage and granularity, as the live API reports it

| Country | Rows are scoped to | Groups (school type) | Data runs to | School region setting |
|---|---|---|---|---|
| DE | Land (`DE-NI`) | MV only: `DE-MV-ABS` general schools, `DE-MV-BBS` vocational, with different dates | school year 2029/30 | the `holiday_region` Land. MV adds a group, default ABS. |
| AT | Bundesland, plus `nationwide` rows (Herbst, Weihnachten, Ostern, Pfingsten), which the subdivision filter includes | none | Christmas 2028/29 | Bundesland. **OpenHolidays uses its own codes (`AT-WI`, `AT-KÄ`, `AT-NÖ` …) where ISO and date-holidays use `AT-1`…`AT-9`**, so a 9-row map in code converts them |
| CH | **canton** for 24 cantons. **Graubünden only by Region** (11 regions, e.g. `CH-GR-ML` and `CH-GR-MS` with different autumn breaks; filtering by `CH-GR` returns both). Appenzell Innerrhoden partly by district. No municipality-level rows in 2026/27, though the subdivision tree lists 1,689 municipalities. | Volksschule / Mittelschule / Berufsschule in ZH, BE, SO, AR, GR (`CH-ZH-VS` …) | about January 2028 | canton (ISO, the same code as date-holidays). GR and AI add a Region step. A group, default Volksschule. |
| NL | **municipality**: regions noord/midden/zuid are expressed as municipality lists, and Gelderland and Zuid-Holland are split | none | school year 2029/30 | municipality |
| FR | zone `FR-ZA/ZB/ZC` and overseas regions | none | 2027-08 (limited by the ministry's publication) | zone or overseas region |
| GB, US | not covered | — | — | no switch (§6.4) |

The other 31 OpenHolidays countries use the same generic picker: the
`/Subdivisions` tree down to the depth its rows actually reference, plus
`/Groups` when the country has groups. Both are fetched through the server path
and cached for a day. Only the five countries above get fixtures (§12).
Because Swiss school holidays are set by cantons and partly by communes, a
Swiss family whose commune departs from its canton or Region adds that
difference by hand or through a calendar. OpenHolidays does not carry it.

### 5.4 The switch, and its default

**Decision: ON by default when OpenHolidays covers the country and someone in
the family chose the region (`chosen: true`). OFF while the region is only the
migrated value.**

- **New families** choose in the wizard, so the switch is on and the first
  sync runs.
- **Existing families** start with `chosen: false`. The card says "Pick your
  state to get school holidays automatically". Picking a region, or confirming
  the migrated one, turns the switch on.
- **GB, US and countries OpenHolidays does not cover** have no switch.

Why not default-on for every family in a supported country:

1. **A migrated DE-NI is a compatibility value, not a fact.** Fetching
   Niedersachsen Ferien for a family in Bavaria, or in Vienna, would silence the
   pack-the-bag reminder on their real school days. That failure is quiet and
   plausible, which is the kind that has cost this project before.
2. **This is the first outbound call to a third party nobody configured.**
   Every other outbound request (ICS, CalDAV, Google, weather, Home Assistant)
   goes to something the family named. Starting this one when they pick their
   region ties it to something they did. The card says what is sent: country,
   region and group, never family data.
3. **The cost is one choice, made once,** and it is the same choice that fixes
   their public holidays.

`SCHOOL_HOLIDAY_SYNC=off` disables the switch for the whole install, for
air-gapped or privacy-strict operators.

### 5.5 Licence: fetch, never ship

Each install's fetched rows are a Derivative Database "used internally"
(ODbL §4.5c), so share-alike does not apply. What the family sees is a Produced
Work. **No OpenHolidays snapshot goes into the image or the repo**, except the
fixture in §12. Shipping one would be Publicly Conveying a Derivative Database
(§4.2/§4.4/§4.6), which would have to stay ODbL, be offered in machine-readable
form, and could never be under PolyForm. **The §4.3 notice appears wherever the
data appears.** Strictly, it only covers public use, but demo.kinboard.app is
public, and the line costs less than deciding when it is needed.

---

## 6. Merging the sources

### 6.1 Hard requirement: what families keep

- **Any calendar can still be marked as holidays**: ICS, CalDAV, Google or local.
  Local calendars get the missing toggle (`settings/local-calendars`); the
  column already exists.
- **Manual entry stays first-class** in every country, with the switch on or
  off. Add, edit and delete are unchanged for manual rows.
- **Nothing fetched can delete, edit or hide anything the family made.**

### 6.2 Precedence and de-duplication

| Question | Rule |
|---|---|
| Is day X a school day? | **Union.** If any source covers it (manual row, non-hidden synced row, `is_holidays` event, or a public holiday per §6.3), there is no school. |
| Which name is reported (`holiday`, attention evidence)? | First match in this order: **manual, calendar, openholidays, public holiday**. The family's own words come first, then a feed they chose, then data fetched for them. `fetchSchoolBreaks` sorts in this order, so `isSchoolBreakOn` does not change. |
| An OpenHolidays range and an `is_holidays` event cover the same days (Herbstferien 12–24 Oct from both) | Both are stored, and nothing is copied between them. The card shows **one** line under the higher-precedence name, with "also in: *Schulferien NI*" when start and end match. The day answer uses the calendar event's name. |
| Overlapping but different ranges (manual "Sommerferien" for two weeks, OpenHolidays for six) | Two lines. Nothing is merged arithmetically. The union decides the days, and each range keeps its name. |
| A synced range is wrong for this family (a movable day their school doesn't take, a commune that differs) | **Hide** sets `hidden`. The sync upserts by `external_id`, so the flag survives. The row stays greyed out with "Show again". To change the dates, use "Copy as my own", which creates a manual copy and hides the original. |
| Can anything turn a holiday into a school day? | Only by removing its cause: hide, delete or unflag. There is no "school despite holiday" record. |
| The switch is turned **off** | The family's `openholidays` rows are deleted, hidden flags included. Manual rows and calendar data are untouched. Turning it on again fetches afresh. |
| The school region changes | The same as off and then on, in one transaction. |

### 6.3 Public holidays count as no school (Phase 1)

A `dayOff` public holiday, a substitute day, or a date-holidays `school` day in
the family's region becomes a break with `source: "public_holiday"`, computed
when it is read and never stored. This applies in every offered country
**except the US**, where districts set school calendars and many schools are
open on Columbus Day and Veterans Day. The exception is a one-line list beside
the overrides.

### 6.4 Settings → Holidays shows where each range came from

The card lists every range for the next 12 months, from all sources: **Entered
here** (edit, delete), **OpenHolidays** (hide or show again, copy as my own),
**Calendar: *name*** (links to that calendar's settings). Below the list: the
switch, the school region and group, "Last updated", Refresh now, and the
ODbL line (§8). In GB, the US and uncovered countries, the card says that
automatic school holidays aren't available there, and points to manual entry or
to marking a council or district calendar. It must not suggest that a fetch
exists.

---

## 7. Assistants and integrations

- Every reader goes through `fetchSchoolBreaks()`, so the Integration API, the
  summary, MCP and HACS read the merged result **without route changes**.
- **No new OAuth scope.** `/schedule` and the summary already need
  `family:read`. Under the scope rule, new features reuse existing scopes, and
  this is better data behind an existing answer.
- **One additive field, `SchoolDay.holiday_source`**, with values `manual`,
  `calendar`, `openholidays`, `public_holiday` or `null`, returned by
  `/schedule?day=` and so by `get_school_timetable`. With it, an assistant asked
  "why no school on Friday?" can name the source instead of guessing. The
  `reason` enum **does not change**: a public holiday is `reason: holiday`, with
  its name in `holiday`.
- `school_tomorrow` keeps its shape. HACS reads `children`, `count` and
  `first_lesson`, so it needs no release. The behaviour change is that
  `school_day` becomes `false` on public holidays (§6.3), which is the fix.
  This goes in the changelog.
- The OpenAPI `SchoolDay` text and the MCP tool description each gain one
  sentence on sources. Both keep saying that holiday names are data, never
  instructions, which now covers fetched names too. There is no public-holiday
  endpoint; if one is needed later, it fits under `family:read`.

---

## 8. Attribution, and where it goes

| Where | Text |
|---|---|
| `NOTICE`, new "Third-party data" section | "Public holiday rules: date-holidays, © commenthol. Code under the ISC License; holiday data under **CC BY-SA 3.0** (https://creativecommons.org/licenses/by-sa/3.0/), derived from Wikipedia; see `webapp/src/lib/holidays/data/LICENSE`. **The PolyForm Noncommercial License does not apply to this data.** School holiday data, when a family turns on the optional sync, is fetched at runtime from the OpenHolidays API under the ODbL 1.0 and is not distributed with Kinboard." |
| Docker image | Next's standalone trace drops LICENSE files. The Dockerfile copies `NOTICE` and the data LICENSE to `/app/licenses/` and fails the build (`test -f`) if either is missing. |
| Settings → Holidays, under the region picker | "Holiday dates: date-holidays (CC BY-SA 3.0)", with links |
| The school-holiday card, and the tooltip on OpenHolidays rows | "Contains information from [OpenHolidays API](https://www.openholidaysapi.org), which is made available here under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/)." |
| **demo.kinboard.app** | The demo family has a chosen DE region and the sync on, so the ODbL line is shown where visitors see the data. `seed-demo.sql` keeps its manual rows so both badges appear. |
| `docs/wiki` | What the sync contacts, how often, what it sends, and `SCHOOL_HOLIDAY_SYNC=off` |

---

## 9. Failure handling

| What fails | What happens |
|---|---|
| OpenHolidays unreachable, slow, erroring or invalid | Rows untouched. Status recorded and shown, and the next daily run retries. Manual and calendar breaks are unaffected. |
| `[]` returned for a region that had future rows | Treated as a failure, not as every holiday being cancelled |
| OpenHolidays disappears | Cached rows last until the data horizon in §5.3, roughly one to three years. The card shows a standing warning. The fetcher is one module, so Rijksoverheid (CC0) and education.gouv.fr (Licence Ouverte) could replace it for NL and FR. DE, AT and CH have no licensed alternative feed. |
| A date-holidays release moves or reclassifies a day | It cannot reach families until the pin is bumped, and then §4.6 fails on the exact date |
| The region is still the migrated value | Public holidays exactly as today, no school fetch, one prompt on the card |
| The migration runs twice | `IF NOT EXISTS` and `ON CONFLICT DO NOTHING` throughout. Running twice is required here. |
| Air-gapped install | Public holidays work (bundled). School holidays are manual or from calendars, as today. |

---

## 10. Phasing

| Phase | What | Effort (focused days) | Ships behaviour? |
|---|---|---|---|
| **1** | Adapter behind `lib/holidays` (§4.1, 4.4, 4.5). `holiday_region` and its migration, Settings → Holidays, wizard step, timezone preselect (§4.2). Generated country list and label fallback (§4.3). Name/emoji maps and en/de/fr strings for DE, AT, CH state holidays. Oracle, spot-table and regeneration specs (§4.6). Public holidays count as no school (§6.3). NOTICE and the image licence copy. | **6–8** | yes: AT, CH and 31 more countries; every Land, canton and state; the school-on-a-public-holiday fix. Otherwise identical. |
| **2** | `school_holidays` migration and RLS (§5.1). Sync with an injectable fetch, cron route, ofelia labels, on-demand routes (§5.2). Generic region/group picker with the AT code map, GR Regions and MV/CH groups (§5.3). Switch and defaults, `SCHOOL_HOLIDAY_SYNC` (§5.4). | **5–7** | yes, for families with a chosen region in a covered country |
| **3** | Card with all sources, badges, hide, show again, copy as my own (§6.4). UI attribution (§8). Local-calendar toggle. `holiday_source` in `/schedule`, OpenAPI and MCP text (§7). Wiki page. | **2–3** | yes |

**Total: 13–18 focused days.** Phase 1 stands on its own and fixes a real bug
for every German family outside Niedersachsen and every Austrian and Swiss
family. Phase 2 needs Phase 1's region. The ODbL line must ship **in the same
release as Phase 2**, never after it.

---

## 11. Out of scope

- **Movable days per school** (*bewegliche Ferientage*), and Swiss communes that
  differ from their canton. Only Mehr-Schulferien has per-school data, for DE,
  and it has no licence. **Suggestion:** ask its maintainer (Wintermeyer
  Consulting) whether the API data could carry an explicit licence. Until then
  families add these by hand.
- **Nager.Date**: offline use needs a sponsor key, the hosted ToS covers only
  non-profit use and can change at any time, and it is .NET only.
  **ferien-api.de**: unlicensed and incomplete data behind aggressive rate
  limiting.
- UK and US school terms. These are set by councils and districts, with no
  central feed, so calendars and manual entry remain the way to add them.
- Holidays per child. The table is family-wide on purpose (see its migration
  header).
- School breaks drawn as bands on the calendar, and all 207 countries (§13).

---

## 12. Testing

- **Public holidays:** §4.6 in the four timezones #319 uses. Region specs
  check that DE-BY has Fronleichnam, DE-SN has Buß- und Bettag as no school,
  AT-9 has Mariä Empfängnis, CH-VD has Lundi du Jeûne, and CH-ZH's Bettag is
  marked but not a day off. A migration spec checks that each `holiday_country`
  state in §4.2 produces the stated row, and that a second run changes nothing.
  The label-fallback spec checks a data-only country in each UI locale.
- **The sync, against a fake.** The sync takes a fetch function, as `HomeDeps`
  does, and the spec passes a counting fake. Cases: first sync inserts and an
  identical second one changes nothing; a row missing inside the window is
  deleted, one outside is kept; every §9 failure leaves rows byte-identical and
  records status; `[]` counts as an error; `BackToSchool` and `EndOfLessons`
  are dropped; group filtering (MV, ZH); the AT code map; a manual row with
  **the same name and dates** as a fetched one survives every path; `hidden`
  survives an upsert; switch off deletes only synced rows; no request spans
  more than 1095 days; the request goes through `safeFetch`.
- **Recorded fixture, and the ODbL decision.** A few real responses are kept in
  `e2e/fixtures/openholidays/`: DE-NI for one school year (9 rows), a DE-MV
  slice with both groups, AT-WI with its nationwide rows, CH-ZH with groups,
  CH-GR with the `BackToSchool` row, one NL municipality, FR zone A.
  A README there carries the §4.3 notice and says the files are ODbL 1.0, not
  PolyForm. **This is acceptable.** A few dozen rows are an *insubstantial*
  extract, and ODbL §6.2 leaves that free "for any purposes whatsoever". The
  same clause warns that "repeated and systematic" extraction of insubstantial
  parts can add up to a substantial one. So the fixture is recorded once,
  never re-recorded wholesale or grown into a mirror, and replaced only when
  the schema changes.
- **Migration and RLS:** apply twice with `ON_ERROR_STOP`. Prove both sides
  through Kong: the anon key can insert a manual row, but cannot insert
  `source = 'openholidays'` or update a synced row. These cases go in
  `school-holidays-grants.spec.ts`.
- **Merging:** `integration-schedule.spec.ts` and `family-summary.spec.ts` get
  a day covered by each source, by two sources (to check the precedence name),
  and by a public holiday, with US `school_day: true`.
- **Live, once, on the devbox:** sync DE-NI and CH-ZH from the real API and
  compare with the KMK and cantonal calendars. Then switch off and confirm only
  synced rows are gone. Use **WebKit** for the card, which has long German names
  and badges.
- **Prove every guard fails.** Remove the Liberation Day override and §4.6 goes
  red. Drop `source = 'openholidays'` from the delete and the manual-row case
  goes red. Accept `BackToSchool` and the CH-GR case goes red. Check that each
  sabotage reached the code before trusting a green run.

---

## 13. Risks and open questions

- **Silent drift in date-holidays.** This is the largest risk. The data is
  community-maintained, and a minor release can reclassify a day in every
  household. The mitigations are the exact pin, the oracle with its
  regeneration check, and the overrides. The remaining cost is a person
  reading the diff on every bump. AT, CH and the 31 data-only countries have
  only spot checks or none, so they are less protected than the five with an
  oracle.
- **OpenHolidays is one small company** (STÜBER SYSTEMS GmbH). Use is
  settled: its FAQ says the project is open data, "its use is free of charge
  and also permitted in commercial projects", with the processed data under
  the ODbL. What it doesn't state is a rate limit or an uptime commitment.
  The data repo was last changed 2026-04-13, the server 2025-12-11. Cached
  rows cover one to three years, so an outage only means no new rows. The
  sync identifies itself with a `User-Agent` such as
  `Kinboard/<version> (+https://github.com/svenger87/kinboard)` and keeps the
  request pattern in §5.2 (one request per family per week, spread over the
  day), so the load is easy for the operator to see and small.
- **Regional half days and sub-regions.** DE and AT Heiligabend and Silvester
  are half days from 14:00 (`bank`, marked but not off). Augsburg (`DE-BY`
  region `A`), Catholic Bavarian municipalities (`KATH`) and Swiss communes sit
  below the level the picker offers. **Open:** offer those levels, or leave them
  as known gaps? OpenHolidays school data is all `FullDay` today.
- **Migrating existing families.** Nothing visible changes, but a family in
  another Land or in AT/CH keeps wrong holidays until they find Settings →
  Holidays. **Open:** a one-time Heute-Motor hint, "Which state are you in?",
  for `chosen: false`? It is cheap, but it is a nag, and families who really
  are in NI would see it too.
- **Mixed-language names** in data-only countries (§4.3). Accepted, and fixed
  upstream in `names.yaml` over time.
- **All 207 countries.** Offering them would mean a 244 KB gzipped bundle, or
  loading each country's data on demand, which makes `getHolidays` async and
  changes callers. **Open:** worth it only when someone outside the 38 asks.
- **NL and CH-GR pickers** (about 340 municipalities, 11 Regions) are heavy for
  a setting touched once. A postcode lookup would be nicer, but there is no
  table for it.

---

## 14. Sources

- date-holidays: <https://github.com/commenthol/date-holidays>,
  [LICENSE](https://github.com/commenthol/date-holidays/blob/master/LICENSE);
  country data [AT](https://github.com/commenthol/date-holidays/blob/master/data/countries/AT.yaml),
  [CH](https://github.com/commenthol/date-holidays/blob/master/data/countries/CH.yaml),
  [names.yaml](https://github.com/commenthol/date-holidays/blob/master/data/names.yaml).
  npm `date-holidays@3.37.0` (2026-09-20) was exercised locally: `getStates`
  (AT 9, CH 26), `getLanguages`, the 2020–2035 comparison with #319, and the
  picked data sizes.
- CC BY-SA 3.0: <https://creativecommons.org/licenses/by-sa/3.0/legalcode>;
  ISC: <https://opensource.org/licenses/ISC>
- OpenHolidays API: <https://www.openholidaysapi.org/en/>; FAQ (free use, commercial
  use permitted) <https://www.openholidaysapi.org/en/faq/>; data
  <https://github.com/openpotato/openholidaysapi.data> (ODbL-1.0); server
  <https://github.com/openpotato/openholidaysapi> (AGPL-3.0); sources
  <https://www.openholidaysapi.org/en/sources-europe/>. `/Countries`,
  `/Subdivisions`, `/Groups` and `/SchoolHolidays` were queried live on
  2026-10-02 for DE, AT, CH, NL and FR.
- ODbL 1.0: <https://opendatacommons.org/licenses/odbl/1-0/> (§4.2–4.6, §6.2)
- Nager.Date: <https://github.com/nager/Nager.Date>, terms
  <https://nagerholidays.com/legal/termsofservice>
- ferien-api: <https://github.com/paulbrejla/ferien-api>,
  <https://github.com/paulbrejla/ferien-api-data> (no licence)
- Mehr-Schulferien: <https://www.mehr-schulferien.de/developers>,
  <https://github.com/mehr-schulferien-de/www.mehr-schulferien.de> (no licence)
- KMK: <https://www.kmk.org/service/ferienregelung/ferienkalender.html>;
  GOV.UK: <https://www.gov.uk/bank-holidays.json>, OGL
  <https://www.gov.uk/help/reuse-govuk-content>
- France: <https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/>;
  Netherlands: <https://opendata.rijksoverheid.nl/v1/infotypes/schoolholidays>,
  terms <https://www.rijksoverheid.nl/opendata/voorwaarden>
- Kinboard: PR #319 and its review; the files cited in §2

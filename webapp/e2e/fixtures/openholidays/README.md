# OpenHolidays fixture

Responses recorded once from the OpenHolidays API on 2026-10-02, for
`e2e/openholidays.spec.ts` (RFC-014 §12).

Contains information from [OpenHolidays API](https://www.openholidaysapi.org),
which is made available here under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).

**These files are ODbL 1.0, not PolyForm Noncommercial.** They are an
insubstantial extract (ODbL §6.2), kept for tests only: never copied into
`src/` or the image, never re-recorded wholesale or grown into a mirror,
and replaced only when the API's schema changes.

## Added in review, 2026-10-02

Three more read-only requests (and a fourth whose answer is not kept),
recorded once to check the request shapes the sync actually sends:

- `school-ch-gr-ml.json`: `subdivisionCode=CH-GR-ML`, a Graubünden Region.
- `school-at-ka.json`: `subdivisionCode=AT-K%C3%84`, an Austrian Land code
  with an umlaut, percent-encoded as the client sends it.
- `groups-nl.json`: `/Groups?countryIsoCode=NL`, so the NL group defaults are
  tested against the real noord/midden/zuid lists.
- `subdivisionCode=NL-UT` (the province) answered byte-for-byte what
  `NL-UT-UT` did, so `school-nl-ut-ut.json` stands for both and no copy is kept.

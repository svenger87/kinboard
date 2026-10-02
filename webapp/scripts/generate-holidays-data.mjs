#!/usr/bin/env node
// Generates webapp/src/lib/holidays/data/{holidays.json,offered.json,LICENSE}
// from the pinned date-holidays package (RFC-014 §4.1, §4.3).
//
//   node scripts/generate-holidays-data.mjs           write the files
//   node scripts/generate-holidays-data.mjs --check   exit 1 if they are stale
//
// It uses date-holidays' own builder (scripts/holidays2json.cjs) in-process
// and calls build() only. Never save(): it writes into node_modules. Never
// --min: it rewrites date-holidays-parser's source files in node_modules
// (prepin), which a clean `npm ci` would not reproduce.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = join(here, "..", "src", "lib", "holidays", "data");

/**
 * RFC-014 §4.3: every country date-holidays covers that either has school
 * holidays in OpenHolidays (its /Countries list, read 2026-10-02) or had a
 * hand-written list in Kinboard (GB, US). Change it only with the RFC.
 */
export const OFFERED_COUNTRIES = Object.freeze([
  "AD", "AL", "AT", "BE", "BG", "BR", "BY", "CH", "CZ", "DE", "EE", "ES", "FR",
  "GB", "HR", "HU", "IE", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "MT", "MX",
  "NL", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "US", "VA", "ZA",
]);

/**
 * Offered because Kinboard listed them by hand before RFC-014, not because
 * OpenHolidays has their school holidays: it has none for these two.
 */
const HAND_WRITTEN_ONLY = Object.freeze(["GB", "US"]);

/** A zone two offered countries both list, settled by where the zone's city is. */
const ZONE_OWNER = Object.freeze({
  "Europe/Zurich": "CH",
  "Europe/Belgrade": "RS",
  "Europe/Rome": "IT",
});

/** A subdivision is offered only if it changes a day somewhere in these years. */
const PROBE_YEARS = Array.from({ length: 10 }, (_, i) => 2026 + i);

const DANGLING = /unknown path for _days: holidays\.([A-Z]+)\.days/;

function packageDir() {
  return dirname(require.resolve("date-holidays/package.json"));
}

function build(pick) {
  const Holidays2json = require(join(packageDir(), "scripts", "holidays2json.cjs"));
  const out = new Holidays2json({ pick: [...pick].sort() }).getList().build().holidays;
  // build() stamps today's date here, which would make every regeneration differ.
  delete out.version;
  // js-yaml's default schema turns ISO-looking date scalars (e.g. an `active`
  // rule's `to: 2006-01-17`) into Date objects. The committed holidays.json is
  // the only thing the real adapter ever reads, and JSON.parse never produces a
  // Date -- so round-trip here too. Without it, date-holidays-parser's toDate()
  // is handed Date.prototype.toString() output (it only accepts a string
  // starting with the 4-digit year) and throws constructing MX/BR/etc.
  return JSON.parse(JSON.stringify(out));
}

function makeParser(Holidays, data, country, state) {
  const hd = state
    ? new Holidays(data, country, state, { languages: ["en"] })
    : new Holidays(data, country, { languages: ["en"] });
  hd.setTimezone(undefined);
  return hd;
}

function signature(hd) {
  return PROBE_YEARS.flatMap((y) => hd.getHolidays(y).map((h) => `${h.date}|${h.type}|${h.name}`)).join("\n");
}

export function buildHolidayData() {
  const Holidays = require("date-holidays-parser").default;

  // Some subdivisions borrow another country's days: ES-CN reads IC, and the
  // French overseas departments read YT, MQ, GP, GF, RE, MF and BL. Picking
  // only the offered countries leaves those references dangling, so the
  // countries they name are added to the data -- as data, not as offered
  // countries -- until every offered country and subdivision constructs.
  const pick = new Set(OFFERED_COUNTRIES);
  let data;
  for (;;) {
    data = build(pick);
    const missing = new Set();
    for (const country of OFFERED_COUNTRIES) {
      if (!data.holidays[country]) throw new Error(`date-holidays has no data for offered country ${country}`);
      const states = Object.keys(new Holidays(data).getStates(country) ?? {});
      for (const state of [null, ...states]) {
        try {
          makeParser(Holidays, data, country, state).getHolidays(2026);
        } catch (err) {
          const m = DANGLING.exec(String(err && err.message));
          if (!m) throw err;
          missing.add(m[1]);
        }
      }
    }
    if (missing.size === 0) break;
    for (const c of missing) {
      if (pick.has(c)) throw new Error(`date-holidays: ${c} is picked but still unresolved`);
      pick.add(c);
    }
  }

  const base = new Holidays(data);
  const countries = {};
  for (const country of OFFERED_COUNTRIES) {
    const whole = makeParser(Holidays, data, country, null);
    const wholeSignature = signature(whole);
    const subdivisions = Object.keys(base.getStates(country) ?? {}).filter(
      (state) => signature(makeParser(Holidays, data, country, state)) !== wholeSignature,
    );
    const zones = whole.getTimezones().filter((zone) => (ZONE_OWNER[zone] ?? country) === country);
    countries[country] = { zones, subdivisions, openHolidays: !HAND_WRITTEN_ONLY.includes(country) };
  }

  return {
    holidaysJson: JSON.stringify(data) + "\n",
    offeredJson: JSON.stringify({ countries }, null, 2) + "\n",
    license: readFileSync(join(packageDir(), "LICENSE"), "utf8"),
  };
}

const FILES = { "holidays.json": "holidaysJson", "offered.json": "offeredJson", LICENSE: "license" };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const built = buildHolidayData();
  const check = process.argv.includes("--check");
  let stale = false;
  mkdirSync(DATA_DIR, { recursive: true });
  for (const [file, field] of Object.entries(FILES)) {
    const path = join(DATA_DIR, file);
    if (check) {
      let current = null;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = null;
      }
      if (current !== built[field]) {
        console.error(`stale: ${path}`);
        stale = true;
      }
    } else {
      writeFileSync(path, built[field]);
    }
  }
  if (stale) process.exit(1);
  console.log(check ? "holiday data is up to date" : `wrote ${Object.keys(FILES).join(", ")} to ${DATA_DIR}`);
}

#!/usr/bin/env python3
"""
The festivals' key days for 2026-2045 from calendar libraries that don't use
ICU, which is where lib/festivals.ts gets them (the browser's `Intl`), so
e2e/festival-reference-dates.spec.ts holds the two against each other.

  hijridate      the Umm al-Qura tables as published (islamic-umalqura)
  pyluach        the Hebrew calendar's arithmetic
  lunardate      a Chinese lunisolar table, 1900-2099
  jdatetime      the Solar Hijri (Persian) calendar
  dateutil       Western and Orthodox Easter

Diwali and Holi aren't here: they are tables in lib/festivals.ts already,
and no library computes the Hindu calendar.

  python3 -m venv /tmp/calref
  /tmp/calref/bin/pip install hijridate pyluach lunardate jdatetime python-dateutil
  /tmp/calref/bin/python scripts/festival-reference-dates.py > e2e/fixtures/festival-reference-dates.json
"""

import json
import sys
from datetime import date

import jdatetime
from dateutil.easter import EASTER_ORTHODOX, EASTER_WESTERN, easter
from hijridate import Hijri
from lunardate import LunarDate
from pyluach.dates import HebrewDate
from pyluach.utils import _is_leap as hebrew_leap

FIRST, LAST = 2026, 2045


def keep(days):
    return sorted({d.isoformat() for d in days if FIRST <= d.year <= LAST})


def hijri(month, day):
    # Hijri years 1447-1460 cover 2026-2036 and a little either side.
    return keep(Hijri(y, month, day).to_gregorian() for y in range(1446, 1471))


def hebrew(month, day):
    # pyluach numbers Nisan 1 ... Adar 12, Adar II 13.
    return keep(HebrewDate(y, month, day).to_pydate() for y in range(5785, 5808))


def purim():
    return keep(HebrewDate(y, 13 if hebrew_leap(y) else 12, 14).to_pydate() for y in range(5785, 5808))


def chinese(month, day):
    return keep(LunarDate(y, month, day).to_solar_date() for y in range(FIRST - 1, LAST + 1))


def persian(month, day):
    return keep(jdatetime.date(y, month, day).togregorian() for y in range(1403, 1426))


out = {
    "_source": "scripts/festival-reference-dates.py: hijridate (Umm al-Qura), pyluach, lunardate, jdatetime, dateutil",
    "ramadan": hijri(9, 1),
    "eid-al-fitr": hijri(10, 1),
    "eid-al-adha": hijri(12, 10),
    "hanukkah": hebrew(9, 25),
    "passover": hebrew(1, 15),
    "sukkot": hebrew(7, 15),
    "purim": purim(),
    "lunar-new-year": chinese(1, 1),
    "dragon-boat": chinese(5, 5),
    "mid-autumn": chinese(8, 15),
    "nowruz": persian(1, 1),
    "yalda": persian(9, 30),
    "easter": keep(easter(y, EASTER_WESTERN) for y in range(FIRST, LAST + 1)),
    "orthodox-easter": keep(easter(y, EASTER_ORTHODOX) for y in range(FIRST, LAST + 1)),
}
json.dump(out, sys.stdout, indent=2)
sys.stdout.write("\n")

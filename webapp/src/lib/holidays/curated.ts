/**
 * What Kinboard adds to date-holidays for the countries it curates
 * (RFC-014 §4.3 tier table): a translation key and emoji per holiday, the
 * non-public days the calendar marks, and the days the countdown lists.
 * Every table is keyed by date-holidays' English name (`languages: ["en"]`,
 * which falls back to the native name where upstream has no English one).
 *
 * `marked` covers `bank`, `optional` and `observance` days only. A `school`
 * day is always marked in a curated country, because it closes school
 * (plan ruling 10): "Maundy Thursday" is an observance in Niedersachsen and
 * a school day off in Baden-Württemberg, so a name list across types would
 * mark it in both.
 */

export interface CuratedName {
  nameKey: string;
  emoji: string;
}

export interface CuratedCountry {
  names: Readonly<Record<string, CuratedName>>;
  /** bank/optional/observance days the calendar marks (not days off). */
  marked: readonly string[];
  /** Days the countdown lists but the calendar does not (#319's US observances). */
  observances: readonly string[];
}

const n = (nameKey: string, emoji: string): CuratedName => ({ nameKey, emoji });

export const CURATED: Readonly<Record<string, CuratedCountry>> = {
  DE: {
    names: {
      "New Year's Day": n("neujahr", "🎆"),
      "Good Friday": n("karfreitag", "✝️"),
      "Easter Sunday": n("ostersonntag", "🐣"),
      "Easter Monday": n("ostermontag", "🐰"),
      "Labour Day": n("tagDerArbeit", "🛠️"),
      "Ascension Day": n("christiHimmelfahrt", "⛅"),
      Pentecost: n("pfingstsonntag", "🕊️"),
      "Whit Monday": n("pfingstmontag", "🕊️"),
      "National Holiday": n("tagDerDeutschenEinheit", "🇩🇪"),
      "Reformation Day": n("reformationstag", "📜"),
      "Christmas Eve": n("heiligabend", "🎄"),
      "Christmas Day": n("weihnachten1", "🎁"),
      "Boxing Day": n("weihnachten2", "🎁"),
      "New Year's Eve": n("silvester", "🎇"),
      Epiphany: n("heiligeDreiKoenige", "👑"),
      "International Women's Day": n("frauentag", "🌹"),
      "75th anniversary of the GDR uprising": n("ddrVolksaufstand75", "🕯️"),
      "Maundy Thursday": n("gruendonnerstag", "✝️"),
      "Corpus Christi": n("fronleichnam", "⛪"),
      "All Saints' Day": n("allerheiligen", "🕯️"),
      "Day of Prayer and Repentance": n("bussUndBettag", "🙏"),
      Assumption: n("mariaeHimmelfahrt", "⛪"),
      "International Children's Day": n("weltkindertag", "🧒"),
    },
    marked: ["Christmas Eve", "New Year's Eve", "Easter Sunday", "Pentecost"],
    observances: [],
  },
  AT: {
    names: {
      "New Year's Day": n("neujahr", "🎆"),
      Epiphany: n("heiligeDreiKoenige", "👑"),
      "Easter Sunday": n("ostersonntag", "🐣"),
      "Easter Monday": n("ostermontag", "🐰"),
      Staatsfeiertag: n("atStaatsfeiertag", "🛠️"),
      "Ascension Day": n("christiHimmelfahrt", "⛅"),
      Pentecost: n("pfingstsonntag", "🕊️"),
      "Whit Monday": n("pfingstmontag", "🕊️"),
      "Corpus Christi": n("fronleichnam", "⛪"),
      Assumption: n("mariaeHimmelfahrt", "⛪"),
      "National Holiday": n("atNationalfeiertag", "🇦🇹"),
      "All Saints' Day": n("allerheiligen", "🕯️"),
      "Immaculate Conception": n("mariaeEmpfaengnis", "⛪"),
      "Christmas Eve": n("heiligabend", "🎄"),
      "Christmas Day": n("atChristtag", "🎁"),
      "Boxing Day": n("atStefanitag", "🎁"),
      "New Year's Eve": n("silvester", "🎇"),
      "Saint Joseph": n("atJosefitag", "⛪"),
      "Leopoldi-Tag": n("atLeopolditag", "⛪"),
    },
    marked: ["Christmas Eve", "New Year's Eve", "Easter Sunday", "Pentecost", "Leopoldi-Tag"],
    observances: [],
  },
  CH: {
    names: {
      "New Year's Day": n("neujahr", "🎆"),
      Berchtoldstag: n("chBerchtoldstag", "🎆"),
      "Saint-Berthold": n("chBerchtoldstag", "🎆"),
      "2 Janvier": n("chBerchtoldstag", "🎆"),
      Epiphany: n("heiligeDreiKoenige", "👑"),
      "Saint Joseph": n("chJosefstag", "⛪"),
      "Good Friday": n("karfreitag", "✝️"),
      "Easter Sunday": n("ostersonntag", "🐣"),
      "Easter Monday": n("ostermontag", "🐰"),
      "Labour Day": n("tagDerArbeit", "🛠️"),
      "Ascension Day": n("chAuffahrt", "⛅"),
      Pentecost: n("pfingstsonntag", "🕊️"),
      "Whit Monday": n("pfingstmontag", "🕊️"),
      "Corpus Christi": n("fronleichnam", "⛪"),
      "Saints Peter and Paul": n("chPeterUndPaul", "⛪"),
      Bundesfeiertag: n("chBundesfeiertag", "🇨🇭"),
      "Fête nationale": n("chBundesfeiertag", "🇨🇭"),
      "Giorno festivo federale": n("chBundesfeiertag", "🇨🇭"),
      Assumption: n("mariaeHimmelfahrt", "⛪"),
      Knabenschiessen: n("chKnabenschiessen", "🎯"),
      "Federal Day of Thanksgiving, Repentance and Prayer": n("chBettag", "🙏"),
      "Monday after Federal Day of Thanksgiving, Repentance and Prayer": n("chBettagsmontag", "🙏"),
      "Saint Nicholas of Flüe": n("chBruderklausenfest", "⛪"),
      "Näfelser Fahrt": n("chNaefelserFahrt", "🏔️"),
      Mauritiustag: n("chMauritiustag", "⛪"),
      "All Saints' Day": n("allerheiligen", "🕯️"),
      "Immaculate Conception": n("mariaeEmpfaengnis", "⛪"),
      "Christmas Eve": n("heiligabend", "🎄"),
      "Christmas Day": n("chWeihnachtstag", "🎄"),
      "Boxing Day": n("chStephanstag", "🎁"),
      "New Year's Eve": n("silvester", "🎇"),
      "Instauration de la République": n("chInstaurationRepublique", "🏛️"),
      "Jeûne Genevois": n("chJeuneGenevois", "🙏"),
      "Restoration of the Republic": n("chRestaurationRepublique", "🏛️"),
      "Jura Plebiscite": n("chPlebisciteJurassien", "🗳️"),
    },
    marked: [
      "Berchtoldstag",
      "Saint-Berthold",
      "2 Janvier",
      "Good Friday",
      "Easter Monday",
      "Whit Monday",
      "Boxing Day",
      "Knabenschiessen",
      "Monday after Federal Day of Thanksgiving, Repentance and Prayer",
    ],
    observances: [],
  },
  FR: {
    names: {
      "New Year's Day": n("frJourDelan", "🎆"),
      "Easter Monday": n("frLundiDePaques", "🐰"),
      "Labour Day": n("frFeteDuTravail", "🛠️"),
      "Victory Day": n("frVictoire1945", "🕊️"),
      "Ascension Day": n("frAscension", "⛅"),
      "Whit Monday": n("frLundiDePentecote", "🕊️"),
      "Bastille Day": n("frFeteNationale", "🇫🇷"),
      Assumption: n("frAssomption", "⛪"),
      "All Saints' Day": n("frToussaint", "🕯️"),
      "Armistice Day": n("frArmistice", "🎖️"),
      "Christmas Day": n("frNoel", "🎄"),
    },
    marked: [],
    observances: [],
  },
  NL: {
    names: {
      "New Year's Day": n("nlNieuwjaarsdag", "🎆"),
      "Good Friday": n("nlGoedeVrijdag", "✝️"),
      "Easter Sunday": n("nlEerstePaasdag", "🐣"),
      "Easter Monday": n("nlTweedePaasdag", "🐰"),
      "King's Day": n("nlKoningsdag", "🇳🇱"),
      "Liberation Day": n("nlBevrijdingsdag", "🕊️"),
      "Ascension Day": n("nlHemelvaartsdag", "⛅"),
      Pentecost: n("nlEerstePinksterdag", "🕊️"),
      "Whit Monday": n("nlTweedePinksterdag", "🕊️"),
      "Christmas Day": n("nlEersteKerstdag", "🎄"),
      "Boxing Day": n("nlTweedeKerstdag", "🎁"),
    },
    marked: [],
    observances: [],
  },
  GB: {
    names: {
      "New Year's Day": n("ukNewYearsDay", "🎆"),
      "Good Friday": n("ukGoodFriday", "✝️"),
      "Easter Monday": n("ukEasterMonday", "🐰"),
      "Early May bank holiday": n("ukEarlyMayBankHoliday", "🌸"),
      "Early May bank holiday (VE day)": n("ukEarlyMayBankHoliday", "🌸"),
      "Spring bank holiday": n("ukSpringBankHoliday", "🌼"),
      "Summer bank holiday": n("ukSummerBankHoliday", "☀️"),
      "Christmas Day": n("ukChristmasDay", "🎄"),
      "Boxing Day": n("ukBoxingDay", "🎁"),
      "Queen’s Platinum Jubilee": n("ukPlatinumJubilee", "👑"),
      "Queen Elizabeth's Funeral Day": n("ukStateFuneral", "🕯️"),
      "King Charles III's Coronation": n("ukCoronation", "👑"),
    },
    marked: [],
    observances: [],
  },
  US: {
    names: {
      "New Year's Day": n("usNewYearsDay", "🎆"),
      "Martin Luther King Jr. Day": n("usMlkDay", "✊"),
      "Washington's Birthday": n("usPresidentsDay", "🇺🇸"),
      "Memorial Day": n("usMemorialDay", "🎖️"),
      Juneteenth: n("usJuneteenth", "✊"),
      "Independence Day": n("usIndependence", "🎇"),
      "Labour Day": n("usLaborDay", "🛠️"),
      "Columbus Day": n("usColumbus", "⚓"),
      "Veterans Day": n("usVeterans", "🎖️"),
      "Thanksgiving Day": n("usThanksgiving", "🦃"),
      "Christmas Day": n("usChristmas", "🎄"),
      "Valentine's Day": n("usValentinesDay", "💝"),
      "St. Patrick's Day": n("usStPatricksDay", "☘️"),
      "Easter Sunday": n("usEaster", "🐣"),
      "Mother's Day": n("usMothersDay", "💐"),
      "Father's Day": n("usFathersDay", "👔"),
      Halloween: n("usHalloween", "🎃"),
      "Christmas Eve": n("usChristmasEve", "🎅"),
      "New Year's Eve": n("usNewYearsEve", "🥂"),
    },
    marked: [],
    // #319's countdown list. Christmas Eve is `optional` upstream; the
    // RFC's allowlist sentence omits it, its own table does not (ruling 9).
    observances: [
      "Valentine's Day",
      "St. Patrick's Day",
      "Easter Sunday",
      "Mother's Day",
      "Father's Day",
      "Halloween",
      "Christmas Eve",
      "New Year's Eve",
    ],
  },
};

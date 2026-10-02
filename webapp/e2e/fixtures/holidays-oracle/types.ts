export interface Holiday {
  nameKey: string;
  date: Date;
  emoji: string;
  /**
   * A public holiday in law, off work for most people: a US federal holiday,
   * a UK bank holiday, a German gesetzlicher Feiertag. False for a day that is
   * marked but worked -- Christmas Eve in Germany, Halloween in the US -- and
   * for one that is only ever a Sunday.
   */
  dayOff: boolean;
}

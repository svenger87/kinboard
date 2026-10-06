import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Boxes,
  Calendar,
  CalendarHeart,
  CalendarPlus,
  Camera,
  Cloud,
  Car,
  DatabaseBackup,
  DoorOpen,
  GraduationCap,
  History,
  Home,
  KeyRound,
  Languages,
  LayoutGrid,
  Lightbulb,
  LineChart,
  ListOrdered,
  Lock,
  Monitor,
  Music,
  Newspaper,
  Palette,
  PiggyBank,
  Puzzle,
  Rss,
  Server,
  ShoppingCart,
  Ticket,
  Trash2,
  Users,
  Video,
  Zap,
} from "lucide-react";

/**
 * Every settings page, and every headed section on one, in one list.
 *
 * The settings index draws its menu from the `menu: true` entries here, and
 * the settings search ranks all of them — so the menu and the search cannot
 * disagree about what exists. `e2e/settings-search.spec.ts` fails when a
 * settings page or a section heading is added without an entry.
 *
 * Keys are full next-intl paths ("settings.itemPeopleLabel",
 * "media.settingsTitle") rather than keys inside one namespace: a section's
 * heading lives in its page's own namespace, and two menu items borrow
 * theirs from outside `settings` altogether.
 */

/** The index's groups, by the i18n key of their heading. */
export type SettingsSection =
  | "sectionFamily"
  | "sectionDisplay"
  | "sectionIntegrations"
  | "sectionSecurity";

export type SettingsVisibility = {
  /** Hidden unless this plugin is enabled — the check the menu always made. */
  plugin?: string;
};

export interface SettingsEntry {
  /** Unique: "holidays" for a page, "holidays.school-sync" for a section. */
  id: string;
  href: string;
  /** Section entries only: /settings/holidays#school-sync. */
  anchor?: string;
  section: SettingsSection;
  labelKey: string;
  descriptionKey?: string;
  /** Comma-separated synonyms, in "settingsSearch.keywords". */
  keywordsKey: string;
  icon: LucideIcon;
  visibility?: SettingsVisibility;
  /** An item in the index menu (pages only). */
  menu?: boolean;
  /** Section entries: the label of the page they are on ("in Holidays"). */
  pageLabelKey?: string;
}

const kw = (id: string) => `settingsSearch.keywords.${id.replace(/\./g, "_")}`;

type PageSpec = Omit<SettingsEntry, "keywordsKey" | "anchor" | "pageLabelKey">;
type SectionSpec = { anchor: string; labelKey: string; descriptionKey?: string; icon?: LucideIcon };

const page = (spec: PageSpec): SettingsEntry => ({ ...spec, keywordsKey: kw(spec.id) });

/** A page's sections: they share its route, group, icon and visibility. */
const sectionsOf = (
  parent: Pick<SettingsEntry, "id" | "href" | "section" | "icon" | "visibility"> & { labelKey: string },
  specs: SectionSpec[],
): SettingsEntry[] =>
  specs.map((s) => ({
    id: `${parent.id}.${s.anchor}`,
    href: parent.href,
    anchor: s.anchor,
    section: parent.section,
    labelKey: s.labelKey,
    descriptionKey: s.descriptionKey,
    keywordsKey: kw(`${parent.id}.${s.anchor}`),
    icon: s.icon ?? parent.icon,
    visibility: parent.visibility,
    pageLabelKey: parent.labelKey,
  }));

/* ------------------------------------------------------------------ pages */

const people = page({ id: "people", href: "/settings/people", section: "sectionFamily", labelKey: "settings.itemPeopleLabel", descriptionKey: "settings.itemPeopleDescription", icon: Users, menu: true });
// The menu shows this device's own name here; the page passes it in.
const devices = page({ id: "devices", href: "/settings/devices", section: "sectionFamily", labelKey: "settings.itemDevicesLabel", descriptionKey: "settings.itemDevicesFallback", icon: Monitor, menu: true });
const catalogue = page({ id: "catalogue", href: "/settings/catalogue", section: "sectionFamily", labelKey: "settings.itemCatalogueLabel", descriptionKey: "settings.itemCatalogueDescription", icon: Boxes, menu: true });
const schedule = page({ id: "schedule", href: "/settings/schedule", section: "sectionFamily", labelKey: "settings.itemScheduleLabel", descriptionKey: "settings.itemScheduleDescription", icon: GraduationCap, menu: true });
const holidays = page({ id: "holidays", href: "/settings/holidays", section: "sectionFamily", labelKey: "settings.itemHolidaysLabel", descriptionKey: "settings.itemHolidaysDescription", icon: CalendarHeart, menu: true });
const recycleBin = page({ id: "recycle-bin", href: "/settings/recycle-bin", section: "sectionFamily", labelKey: "settings.itemRecycleBinLabel", descriptionKey: "settings.itemRecycleBinDescription", icon: Trash2, menu: true });
const taskLog = page({ id: "task-log", href: "/settings/task-log", section: "sectionFamily", labelKey: "settings.itemTaskLogLabel", descriptionKey: "settings.itemTaskLogDescription", icon: History, menu: true });

const widgets = page({ id: "widgets", href: "/settings/widgets", section: "sectionDisplay", labelKey: "settings.itemWidgetsLabel", descriptionKey: "settings.itemWidgetsDescription", icon: LayoutGrid, menu: true });
const hints = page({ id: "hints", href: "/settings/hints", section: "sectionDisplay", labelKey: "settings.itemHintsLabel", descriptionKey: "settings.itemHintsDescription", icon: Lightbulb, menu: true });
const navigation = page({ id: "navigation", href: "/settings/navigation", section: "sectionDisplay", labelKey: "settings.itemNavigationLabel", descriptionKey: "settings.itemNavigationDescription", icon: ListOrdered, menu: true });
const theme = page({ id: "theme", href: "/settings/theme", section: "sectionDisplay", labelKey: "settings.itemThemeLabel", descriptionKey: "settings.itemThemeDescription", icon: Palette, menu: true });
const screensaver = page({ id: "screensaver", href: "/settings/screensaver", section: "sectionDisplay", labelKey: "settings.itemScreensaverLabel", descriptionKey: "settings.itemScreensaverDescription", icon: Monitor, menu: true });
const weather = page({ id: "weather", href: "/settings/weather", section: "sectionDisplay", labelKey: "settings.itemWeatherLabel", descriptionKey: "settings.itemWeatherDescription", icon: Cloud, menu: true });
const notifications = page({ id: "notifications", href: "/settings/notifications", section: "sectionDisplay", labelKey: "settings.itemNotificationsLabel", descriptionKey: "settings.itemNotificationsDescription", icon: Bell, menu: true });
const language = page({ id: "language", href: "/settings/language", section: "sectionDisplay", labelKey: "settings.itemLanguageLabel", descriptionKey: "settings.itemLanguageDescription", icon: Languages, menu: true });
const news = page({ id: "news", href: "/settings/news", section: "sectionDisplay", labelKey: "settings.itemNewsLabel", descriptionKey: "settings.itemNewsDescription", icon: Newspaper, menu: true });
const plugins = page({ id: "plugins", href: "/settings/plugins", section: "sectionDisplay", labelKey: "settings.itemPluginsLabel", descriptionKey: "settings.itemPluginsDescription", icon: Puzzle, menu: true });

const calendar = page({ id: "calendar", href: "/settings/calendar", section: "sectionIntegrations", labelKey: "settings.itemCalendarLabel", descriptionKey: "settings.itemCalendarDescription", icon: Calendar, menu: true });
const bring = page({ id: "bring", href: "/settings/bring", section: "sectionIntegrations", labelKey: "settings.itemBringLabel", descriptionKey: "settings.itemBringDescription", icon: ShoppingCart, menu: true });
const photos = page({ id: "photos", href: "/settings/photos", section: "sectionIntegrations", labelKey: "settings.itemPhotosLabel", descriptionKey: "settings.itemPhotosDescription", icon: Camera, menu: true });
const homeassistant = page({ id: "homeassistant", href: "/settings/homeassistant", section: "sectionIntegrations", labelKey: "settings.itemHomeAssistantLabel", descriptionKey: "settings.itemHomeAssistantDescription", icon: Home, menu: true });
const integrations = page({ id: "integrations", href: "/settings/integrations", section: "sectionIntegrations", labelKey: "settings.itemIntegrationTokensLabel", descriptionKey: "settings.itemIntegrationTokensDescription", icon: KeyRound, menu: true });
const vehicles = page({ id: "vehicles", href: "/settings/vehicles", section: "sectionIntegrations", labelKey: "settings.itemVehiclesLabel", descriptionKey: "settings.itemVehiclesDescription", icon: Car, menu: true, visibility: { plugin: "vehicles" } });
const energy = page({ id: "energy", href: "/settings/energy", section: "sectionIntegrations", labelKey: "settings.itemEnergyLabel", descriptionKey: "settings.itemEnergyDescription", icon: Zap, menu: true, visibility: { plugin: "energy" } });
const cameras = page({ id: "cameras", href: "/settings/cameras", section: "sectionIntegrations", labelKey: "settings.itemCamerasLabel", descriptionKey: "settings.itemCamerasDescription", icon: Video, menu: true, visibility: { plugin: "cameras" } });
const stonks = page({ id: "stonks", href: "/settings/stonks", section: "sectionIntegrations", labelKey: "settings.itemStonksLabel", descriptionKey: "settings.itemStonksDescription", icon: LineChart, menu: true, visibility: { plugin: "stonks" } });
const pocketMoney = page({ id: "pocket-money", href: "/settings/pocket-money", section: "sectionIntegrations", labelKey: "settings.itemPocketMoneyLabel", descriptionKey: "settings.itemPocketMoneyDescription", icon: PiggyBank, menu: true, visibility: { plugin: "pocket-money" } });
const mediaPlayers = page({ id: "media-players", href: "/settings/media-players", section: "sectionIntegrations", labelKey: "media.settingsTitle", descriptionKey: "media.settingsDescription", icon: Music, menu: true, visibility: { plugin: "media" } });

// Reached from another settings page rather than the menu.
const google = page({ id: "google", href: "/settings/google", section: "sectionIntegrations", labelKey: "settings.itemGoogleLabel", descriptionKey: "settings.itemGoogleDescription", icon: Calendar });
const ics = page({ id: "ics", href: "/settings/ics", section: "sectionIntegrations", labelKey: "settings.itemIcsLabel", descriptionKey: "settings.itemIcsDescription", icon: Rss });
const caldav = page({ id: "caldav", href: "/settings/caldav", section: "sectionIntegrations", labelKey: "settings.caldav.title", descriptionKey: "settings.caldav.subtitle", icon: Server });
const localCalendars = page({ id: "local-calendars", href: "/settings/local-calendars", section: "sectionIntegrations", labelKey: "settings.localCalendars.title", descriptionKey: "settings.localCalendars.subtitle", icon: CalendarPlus });
const haRooms = page({ id: "homeassistant-rooms", href: "/settings/homeassistant/rooms", section: "sectionIntegrations", labelKey: "settings.homeassistantRooms.headerTitle", descriptionKey: "settings.homeassistantRooms.headerSubtitle", icon: DoorOpen });

/** The index itself: not a result of its own, but its cards are. */
const index = { id: "index", href: "/settings", section: "sectionFamily" as const, icon: Lock, labelKey: "settings.title" };

/* --------------------------------------------------------------- the list */

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  people,
  devices,
  catalogue,
  schedule,
  holidays,
  recycleBin,
  taskLog,
  widgets,
  hints,
  navigation,
  theme,
  screensaver,
  weather,
  notifications,
  language,
  news,
  plugins,
  calendar,
  bring,
  photos,
  homeassistant,
  integrations,
  vehicles,
  energy,
  cameras,
  stonks,
  pocketMoney,
  mediaPlayers,
  google,
  ics,
  caldav,
  localCalendars,
  haRooms,

  // The index's own cards: the join code and the data tools sit in the
  // family group, the PIN under its "Security" heading.
  ...sectionsOf({ ...index, section: "sectionFamily" }, [
    { anchor: "join-code", labelKey: "settings.joinCodeLabel", icon: Ticket },
  ]),
  ...sectionsOf({ ...index, section: "sectionSecurity" }, [
    { anchor: "pin", labelKey: "settings.pinLabel", icon: Lock },
  ]),
  ...sectionsOf({ ...index, section: "sectionFamily" }, [
    { anchor: "data-export", labelKey: "settings.dataCardTitle", descriptionKey: "settings.dataCardDescription", icon: DatabaseBackup },
    { anchor: "calendar-feed", labelKey: "settings.feedTitle", icon: Rss },
    { anchor: "diagnostics", labelKey: "settings.diagnosticsTitle", descriptionKey: "settings.diagnosticsDescription", icon: Activity },
  ]),

  ...sectionsOf(schedule, [
    { anchor: "subjects", labelKey: "settings.schedule.subjectsHeading" },
    { anchor: "packing-list", labelKey: "settings.schedule.packHeading" },
  ]),
  ...sectionsOf(holidays, [
    { anchor: "region", labelKey: "settings.holidays.regionLabel", descriptionKey: "settings.holidays.regionDescription" },
    { anchor: "school-sync", labelKey: "settings.holidays.sync.title" },
    { anchor: "school-holidays", labelKey: "settings.schedule.holidaysHeading" },
  ]),
  ...sectionsOf(recycleBin, [
    { anchor: "retention", labelKey: "settings.recycleBin.retentionHeading" },
  ]),
  ...sectionsOf(taskLog, [
    { anchor: "retention", labelKey: "settings.taskLog.retentionHeading" },
  ]),

  ...sectionsOf(widgets, [
    { anchor: "compact-home", labelKey: "settings.widgets.compactHomeLabel", descriptionKey: "settings.widgets.compactHomeDescription" },
  ]),
  ...sectionsOf(navigation, [
    { anchor: "settings-icon", labelKey: "settings.navigation.settingsIconOnly", descriptionKey: "settings.navigation.settingsIconOnlyHint" },
  ]),
  ...sectionsOf(theme, [
    { anchor: "monthly-theme", labelKey: "settings.theme.monthlyThemeHeading" },
    { anchor: "palette", labelKey: "settings.theme.paletteHeading" },
    { anchor: "appearance", labelKey: "settings.theme.appearanceHeading" },
  ]),
  ...sectionsOf(screensaver, [
    { anchor: "timeout", labelKey: "settings.screensaver.timeoutHeading" },
    { anchor: "rotation", labelKey: "settings.screensaver.rotationHeading" },
    { anchor: "presence", labelKey: "settings.screensaver.presenceHeading" },
  ]),
  ...sectionsOf(weather, [
    { anchor: "location-type", labelKey: "settings.weather.locationTypeHeading" },
    { anchor: "location", labelKey: "settings.weather.locationCityHeading" },
  ]),
  ...sectionsOf(notifications, [
    { anchor: "push", labelKey: "settings.notifications.pushStatusHeading" },
    { anchor: "shopping", labelKey: "settings.notifications.shoppingHeading" },
    { anchor: "tasks", labelKey: "settings.notifications.todoHeading" },
    { anchor: "calendar", labelKey: "settings.notifications.calendarHeading" },
    { anchor: "birthdays", labelKey: "settings.notifications.birthdayTitle" },
    { anchor: "quiet-hours", labelKey: "settings.notifications.quietHoursHeading" },
  ]),
  ...sectionsOf(language, [
    { anchor: "week-start", labelKey: "settings.language.weekStartLabel", descriptionKey: "settings.language.weekStartDescription" },
    { anchor: "time-zone", labelKey: "settings.language.timeZoneLabel", descriptionKey: "settings.language.timeZoneDescription" },
  ]),
  ...sectionsOf(news, [
    { anchor: "own-feeds", labelKey: "settings.news.customTitle" },
    { anchor: "catalog", labelKey: "settings.news.catalogTitle" },
  ]),

  ...sectionsOf(calendar, [
    { anchor: "display", labelKey: "settings.calendarDisplay.title" },
    { anchor: "sync-range", labelKey: "settings.calendarSyncRange.title" },
  ]),
  ...sectionsOf(bring, [
    { anchor: "active-list", labelKey: "settings.bring.activeListHeading" },
    { anchor: "sync-settings", labelKey: "settings.bring.settingsHeading" },
  ]),
  ...sectionsOf(photos, [
    { anchor: "source", labelKey: "settings.photos.sourceHeading" },
    { anchor: "albums", labelKey: "settings.photos.albumsHeading" },
    { anchor: "search-terms", labelKey: "settings.photos.termsHeading" },
  ]),
  ...sectionsOf(homeassistant, [
    { anchor: "dashboard-cards", labelKey: "settings.homeassistant.cardsHeading" },
  ]),
  ...sectionsOf(integrations, [
    { anchor: "assistants", labelKey: "settings.integrations.assistantsHeading" },
    { anchor: "create-token", labelKey: "settings.integrations.createHeading" },
    { anchor: "tokens", labelKey: "settings.integrations.existingHeading" },
  ]),
  ...sectionsOf(stonks, [
    { anchor: "add-symbol", labelKey: "settings.stonks.addHeading" },
    { anchor: "watchlist", labelKey: "settings.stonks.watchlistHeading" },
  ]),
  ...sectionsOf(pocketMoney, [
    { anchor: "currency", labelKey: "settings.pocketMoney.currencyLabel" },
    { anchor: "rewards", labelKey: "settings.pocketMoney.rewardsTitle", descriptionKey: "settings.pocketMoney.rewardsDescription" },
  ]),
  ...sectionsOf(google, [
    { anchor: "auto-sync", labelKey: "settings.google.autoSyncTitle" },
    { anchor: "calendars", labelKey: "settings.google.calendarsLabel" },
    { anchor: "person-mapping", labelKey: "settings.google.mappingHeading" },
  ]),
];

/** The settings index groups, in the order the menu shows them. */
export const MENU_SECTIONS: readonly SettingsSection[] = [
  "sectionFamily",
  "sectionDisplay",
  "sectionIntegrations",
];

export interface VisibilityContext {
  pluginEnabled: (pluginId: string) => boolean;
}

/** The same rule the menu has always applied, for menu and search alike. */
export function isEntryVisible(entry: SettingsEntry, ctx: VisibilityContext): boolean {
  if (entry.visibility?.plugin && !ctx.pluginEnabled(entry.visibility.plugin)) return false;
  return true;
}

export const entryHref = (entry: SettingsEntry): string =>
  entry.anchor ? `${entry.href}#${entry.anchor}` : entry.href;

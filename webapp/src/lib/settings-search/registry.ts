import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Boxes,
  Calendar,
  CalendarDays,
  CalendarHeart,
  CalendarPlus,
  Camera,
  Cloud,
  Car,
  DatabaseBackup,
  DoorOpen,
  LayoutDashboard,
  GraduationCap,
  History,
  Home,
  Info,
  KeyRound,
  Languages,
  LayoutGrid,
  LayoutTemplate,
  Lightbulb,
  LineChart,
  ListOrdered,
  Lock,
  Monitor,
  Music,
  Newspaper,
  Palette,
  PiggyBank,
  Plug,
  Puzzle,
  Rss,
  Server,
  ShieldCheck,
  Sparkles,
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
 * The settings index draws its categories' menus from the `menu: true`
 * entries here (in this order), and the settings search ranks all of them — so the menu and the search cannot
 * disagree about what exists. `e2e/settings-search.spec.ts` fails when a
 * settings page or a section heading is added without an entry.
 *
 * Keys are full next-intl paths ("settings.itemPeopleLabel",
 * "media.settingsTitle") rather than keys inside one namespace: a section's
 * heading lives in its page's own namespace, and two menu items borrow
 * theirs from outside `settings` altogether.
 */

/**
 * The settings index's categories, in the order it shows them. Each is a
 * collapsible row on `/settings`, opened by `/settings#<id>`; its name is
 * `settings.categories.names.<id>`. Every page and every index card belongs
 * to exactly one.
 */
export type SettingsCategory =
  | "family"
  | "calendars"
  | "board"
  | "screens"
  | "look"
  | "connections"
  | "data"
  | "install"
  | "about";

export interface SettingsCategoryDef {
  id: SettingsCategory;
  icon: LucideIcon;
  /** Shown only to the install's operator family (RFC-024 §8). */
  operatorOnly?: boolean;
}

export const SETTINGS_CATEGORIES: readonly SettingsCategoryDef[] = [
  { id: "family", icon: Users },
  { id: "calendars", icon: CalendarDays },
  { id: "board", icon: LayoutGrid },
  { id: "screens", icon: Monitor },
  { id: "look", icon: Palette },
  { id: "connections", icon: Plug },
  { id: "data", icon: ShieldCheck },
  { id: "install", icon: Server, operatorOnly: true },
  { id: "about", icon: Info },
];

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
  category: SettingsCategory;
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

/** A page's sections: they share its route, category, icon and visibility. */
const sectionsOf = (
  parent: Pick<SettingsEntry, "id" | "href" | "category" | "icon" | "visibility"> & { labelKey: string },
  specs: SectionSpec[],
): SettingsEntry[] =>
  specs.map((s) => ({
    id: `${parent.id}.${s.anchor}`,
    href: parent.href,
    anchor: s.anchor,
    category: parent.category,
    labelKey: s.labelKey,
    descriptionKey: s.descriptionKey,
    keywordsKey: kw(`${parent.id}.${s.anchor}`),
    icon: s.icon ?? parent.icon,
    visibility: parent.visibility,
    pageLabelKey: parent.labelKey,
  }));

/* ------------------------------------------------------------------ pages */

const people = page({ id: "people", href: "/settings/people", category: "family", labelKey: "settings.itemPeopleLabel", descriptionKey: "settings.itemPeopleDescription", icon: Users, menu: true });
// The menu shows this device's own name here; the page passes it in.
const devices = page({ id: "devices", href: "/settings/devices", category: "screens", labelKey: "settings.itemDevicesLabel", descriptionKey: "settings.itemDevicesFallback", icon: Monitor, menu: true });
const catalogue = page({ id: "catalogue", href: "/settings/catalogue", category: "connections", labelKey: "settings.itemCatalogueLabel", descriptionKey: "settings.itemCatalogueDescription", icon: Boxes, menu: true });
const schedule = page({ id: "schedule", href: "/settings/schedule", category: "family", labelKey: "settings.itemScheduleLabel", descriptionKey: "settings.itemScheduleDescription", icon: GraduationCap, menu: true });
const holidays = page({ id: "holidays", href: "/settings/holidays", category: "calendars", labelKey: "settings.itemHolidaysLabel", descriptionKey: "settings.itemHolidaysDescription", icon: CalendarHeart, menu: true });
const recycleBin = page({ id: "recycle-bin", href: "/settings/recycle-bin", category: "data", labelKey: "settings.itemRecycleBinLabel", descriptionKey: "settings.itemRecycleBinDescription", icon: Trash2, menu: true });
// Core since RFC-017: a child's creature and the rewards need no plugin.
const creatures = page({ id: "creatures", href: "/settings/creatures", category: "family", labelKey: "settings.itemCreaturesLabel", descriptionKey: "settings.itemCreaturesDescription", icon: Sparkles, menu: true });
const taskLog = page({ id: "task-log", href: "/settings/task-log", category: "data", labelKey: "settings.itemTaskLogLabel", descriptionKey: "settings.itemTaskLogDescription", icon: History, menu: true });

const widgets = page({ id: "widgets", href: "/settings/widgets", category: "board", labelKey: "settings.itemWidgetsLabel", descriptionKey: "settings.itemWidgetsDescription", icon: LayoutGrid, menu: true });
const hints = page({ id: "hints", href: "/settings/hints", category: "board", labelKey: "settings.itemHintsLabel", descriptionKey: "settings.itemHintsDescription", icon: Lightbulb, menu: true });
const navigation = page({ id: "navigation", href: "/settings/navigation", category: "screens", labelKey: "settings.itemNavigationLabel", descriptionKey: "settings.itemNavigationDescription", icon: ListOrdered, menu: true });
const theme = page({ id: "theme", href: "/settings/theme", category: "look", labelKey: "settings.itemThemeLabel", descriptionKey: "settings.itemThemeDescription", icon: Palette, menu: true });
const screensaver = page({ id: "screensaver", href: "/settings/screensaver", category: "screens", labelKey: "settings.itemScreensaverLabel", descriptionKey: "settings.itemScreensaverDescription", icon: Monitor, menu: true });
const layouts = page({ id: "layouts", href: "/settings/layouts", category: "screens", labelKey: "settings.itemLayoutsLabel", descriptionKey: "settings.itemLayoutsDescription", icon: LayoutTemplate, menu: true });
const weather = page({ id: "weather", href: "/settings/weather", category: "board", labelKey: "settings.itemWeatherLabel", descriptionKey: "settings.itemWeatherDescription", icon: Cloud, menu: true });
const notifications = page({ id: "notifications", href: "/settings/notifications", category: "screens", labelKey: "settings.itemNotificationsLabel", descriptionKey: "settings.itemNotificationsDescription", icon: Bell, menu: true });
const language = page({ id: "language", href: "/settings/language", category: "look", labelKey: "settings.itemLanguageLabel", descriptionKey: "settings.itemLanguageDescription", icon: Languages, menu: true });
const news = page({ id: "news", href: "/settings/news", category: "board", labelKey: "settings.itemNewsLabel", descriptionKey: "settings.itemNewsDescription", icon: Newspaper, menu: true });
const plugins = page({ id: "plugins", href: "/settings/plugins", category: "board", labelKey: "settings.itemPluginsLabel", descriptionKey: "settings.itemPluginsDescription", icon: Puzzle, menu: true });

const calendar = page({ id: "calendar", href: "/settings/calendar", category: "calendars", labelKey: "settings.itemCalendarLabel", descriptionKey: "settings.itemCalendarDescription", icon: Calendar, menu: true });
const bring = page({ id: "bring", href: "/settings/bring", category: "connections", labelKey: "settings.itemBringLabel", descriptionKey: "settings.itemBringDescription", icon: ShoppingCart, menu: true });
const photos = page({ id: "photos", href: "/settings/photos", category: "board", labelKey: "settings.itemPhotosLabel", descriptionKey: "settings.itemPhotosDescription", icon: Camera, menu: true });
const homeassistant = page({ id: "homeassistant", href: "/settings/homeassistant", category: "connections", labelKey: "settings.itemHomeAssistantLabel", descriptionKey: "settings.itemHomeAssistantDescription", icon: Home, menu: true });
const integrations = page({ id: "integrations", href: "/settings/integrations", category: "connections", labelKey: "settings.itemIntegrationTokensLabel", descriptionKey: "settings.itemIntegrationTokensDescription", icon: KeyRound, menu: true });
const vehicles = page({ id: "vehicles", href: "/settings/vehicles", category: "connections", labelKey: "settings.itemVehiclesLabel", descriptionKey: "settings.itemVehiclesDescription", icon: Car, menu: true, visibility: { plugin: "vehicles" } });
const energy = page({ id: "energy", href: "/settings/energy", category: "connections", labelKey: "settings.itemEnergyLabel", descriptionKey: "settings.itemEnergyDescription", icon: Zap, menu: true, visibility: { plugin: "energy" } });
const cameras = page({ id: "cameras", href: "/settings/cameras", category: "connections", labelKey: "settings.itemCamerasLabel", descriptionKey: "settings.itemCamerasDescription", icon: Video, menu: true, visibility: { plugin: "cameras" } });
const stonks = page({ id: "stonks", href: "/settings/stonks", category: "connections", labelKey: "settings.itemStonksLabel", descriptionKey: "settings.itemStonksDescription", icon: LineChart, menu: true, visibility: { plugin: "stonks" } });
const pocketMoney = page({ id: "pocket-money", href: "/settings/pocket-money", category: "family", labelKey: "settings.itemPocketMoneyLabel", descriptionKey: "settings.itemPocketMoneyDescription", icon: PiggyBank, menu: true, visibility: { plugin: "pocket-money" } });
const mediaPlayers = page({ id: "media-players", href: "/settings/media-players", category: "connections", labelKey: "media.settingsTitle", descriptionKey: "media.settingsDescription", icon: Music, menu: true, visibility: { plugin: "media" } });

// Reached from another settings page rather than the menu.
const google = page({ id: "google", href: "/settings/google", category: "calendars", labelKey: "settings.itemGoogleLabel", descriptionKey: "settings.itemGoogleDescription", icon: Calendar });
const ics = page({ id: "ics", href: "/settings/ics", category: "calendars", labelKey: "settings.itemIcsLabel", descriptionKey: "settings.itemIcsDescription", icon: Rss });
const caldav = page({ id: "caldav", href: "/settings/caldav", category: "calendars", labelKey: "settings.caldav.title", descriptionKey: "settings.caldav.subtitle", icon: Server });
const localCalendars = page({ id: "local-calendars", href: "/settings/local-calendars", category: "calendars", labelKey: "settings.localCalendars.title", descriptionKey: "settings.localCalendars.subtitle", icon: CalendarPlus });
const haRooms = page({ id: "homeassistant-rooms", href: "/settings/homeassistant/rooms", category: "connections", labelKey: "settings.homeassistantRooms.headerTitle", descriptionKey: "settings.homeassistantRooms.headerSubtitle", icon: DoorOpen });
const haDashboards = page({ id: "homeassistant-dashboards", href: "/settings/homeassistant/dashboards", category: "connections", labelKey: "settings.homeassistantDashboards.headerTitle", descriptionKey: "settings.homeassistantDashboards.headerSubtitle", icon: LayoutDashboard });

/** The index itself: not a result of its own, but its cards are. */
const index = { id: "index", href: "/settings", icon: Lock, labelKey: "settings.title" };

/* --------------------------------------------------------------- the list */

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // Pages, in the order each category lists them.
  people,
  schedule,
  creatures,
  pocketMoney,

  calendar,
  holidays,
  google,
  ics,
  caldav,
  localCalendars,

  widgets,
  weather,
  news,
  photos,
  hints,
  plugins,

  devices,
  layouts,
  screensaver,
  navigation,
  notifications,

  theme,
  language,

  homeassistant,
  catalogue,
  bring,
  integrations,
  mediaPlayers,
  cameras,
  energy,
  vehicles,
  stonks,
  haRooms,
  haDashboards,

  recycleBin,
  taskLog,

  // The index's own cards, each inside the category that opens around it
  // when `/settings#<anchor>` is visited.
  ...sectionsOf({ ...index, category: "family" }, [
    { anchor: "join-code", labelKey: "settings.joinCodeLabel", icon: Ticket },
  ]),
  ...sectionsOf({ ...index, category: "calendars" }, [
    { anchor: "calendar-feed", labelKey: "settings.feedTitle", icon: Rss },
  ]),
  ...sectionsOf({ ...index, category: "data" }, [
    { anchor: "pin", labelKey: "settings.pinLabel", icon: Lock },
    { anchor: "data-export", labelKey: "settings.dataCardTitle", descriptionKey: "settings.dataCardDescription", icon: DatabaseBackup },
    { anchor: "scheduled-backup", labelKey: "settings.scheduledBackup.title", descriptionKey: "settings.scheduledBackup.description", icon: DatabaseBackup },
  ]),
  ...sectionsOf({ ...index, category: "about" }, [
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
    { anchor: "nav-icons-only", labelKey: "settings.navigation.iconsOnly", descriptionKey: "settings.navigation.iconsOnlyHint" },
    { anchor: "settings-icon", labelKey: "settings.navigation.settingsIconOnly", descriptionKey: "settings.navigation.settingsIconOnlyHint" },
  ]),
  ...sectionsOf(theme, [
    { anchor: "monthly-theme", labelKey: "settings.theme.monthlyThemeHeading" },
    { anchor: "palette", labelKey: "settings.theme.paletteHeading" },
    { anchor: "font-style", labelKey: "settings.theme.fontStyleHeading" },
    { anchor: "appearance", labelKey: "settings.theme.appearanceHeading" },
    { anchor: "animations", labelKey: "settings.theme.motionLabel", descriptionKey: "settings.theme.motionHint" },
    { anchor: "festivals", labelKey: "settings.theme.festivalsLabel", descriptionKey: "settings.theme.festivalsHint" },
  ]),
  ...sectionsOf(layouts, [{ anchor: "defaults", labelKey: "settings.layouts.defaults.title", descriptionKey: "settings.layouts.defaults.description" }]),
  ...sectionsOf(screensaver, [
    { anchor: "lists", labelKey: "settings.screensaver.eventCountLabel", descriptionKey: "settings.screensaver.eventCountDescription" },
    { anchor: "forecast", labelKey: "settings.screensaver.showForecastLabel", descriptionKey: "settings.screensaver.showForecastDescription" },
    { anchor: "lessons", labelKey: "settings.screensaver.showLessonsLabel", descriptionKey: "settings.screensaver.showLessonsDescription" },
    { anchor: "preview", labelKey: "settings.screensaver.previewLabel", descriptionKey: "settings.screensaver.previewDescription" },
    { anchor: "panel-opacity", labelKey: "settings.screensaver.panelOpacityLabel", descriptionKey: "settings.screensaver.panelOpacityDescription" },
    { anchor: "panel-color", labelKey: "settings.screensaver.panelColorLabel", descriptionKey: "settings.screensaver.panelColorDescription" },
    { anchor: "panel-text-color", labelKey: "settings.screensaver.panelTextColorLabel", descriptionKey: "settings.screensaver.panelTextColorDescription" },
    { anchor: "weather-effects", labelKey: "settings.screensaver.weatherEffectsLabel" },
    { anchor: "night", labelKey: "settings.screensaver.nightLabel" },
    { anchor: "timeout", labelKey: "settings.screensaver.timeoutHeading" },
    { anchor: "rotation", labelKey: "settings.screensaver.rotationHeading" },
    { anchor: "presence", labelKey: "settings.screensaver.presenceHeading" },
  ]),
  ...sectionsOf(weather, [
    { anchor: "location-type", labelKey: "settings.weather.locationTypeHeading" },
    { anchor: "location", labelKey: "settings.weather.locationCityHeading" },
    { anchor: "effects", labelKey: "settings.weather.effectsLabel", descriptionKey: "settings.weather.effectsHint" },
  ]),
  ...sectionsOf(notifications, [
    { anchor: "push", labelKey: "settings.notifications.pushStatusHeading" },
    { anchor: "shopping", labelKey: "settings.notifications.shoppingHeading" },
    { anchor: "tasks", labelKey: "settings.notifications.todoHeading" },
    { anchor: "calendar", labelKey: "settings.notifications.calendarHeading" },
    { anchor: "birthdays", labelKey: "settings.notifications.birthdayTitle" },
    { anchor: "rewards", labelKey: "settings.notifications.rewardsLabel", descriptionKey: "settings.notifications.rewardsDescription" },
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
    { anchor: "tile-run", labelKey: "settings.homeassistant.tileRunHeading" },
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
  ]),
  ...sectionsOf(creatures, [
    { anchor: "inbox", labelKey: "settings.pocketMoney.redemptionInboxTitle" },
    { anchor: "children", labelKey: "settings.creatures.speciesLabel", descriptionKey: "settings.creatures.intro" },
    { anchor: "home", labelKey: "settings.creatures.homeLabel", descriptionKey: "settings.creatures.homeHint" },
    { anchor: "growth", labelKey: "settings.creatures.growthLabel", descriptionKey: "settings.creatures.growthHint" },
    { anchor: "prices", labelKey: "settings.creatures.pricesLabel", descriptionKey: "settings.creatures.pricesHint" },
    { anchor: "rewards", labelKey: "settings.pocketMoney.rewardsTitle", descriptionKey: "settings.pocketMoney.rewardsDescription" },
  ]),
  ...sectionsOf(google, [
    { anchor: "auto-sync", labelKey: "settings.google.autoSyncTitle" },
    { anchor: "calendars", labelKey: "settings.google.calendarsLabel" },
    { anchor: "person-mapping", labelKey: "settings.google.mappingHeading" },
  ]),
];

/**
 * Index anchors that are not search results: the install's own card, which
 * only its operator sees (an id, no `data-setting`).
 */
const INDEX_ALIASES: Readonly<Record<string, SettingsCategory>> = { instance: "install" };

/**
 * The category `/settings#<hash>` opens: a category's own id, or the one that
 * holds the index card with that anchor. Null for anything else.
 */
export function categoryForIndexHash(hash: string): SettingsCategory | null {
  const h = hash.replace(/^#/, "");
  if (!h) return null;
  const own = SETTINGS_CATEGORIES.find((c) => c.id === h);
  if (own) return own.id;
  const card = SETTINGS_ENTRIES.find((e) => e.href === "/settings" && e.anchor === h);
  return card?.category ?? INDEX_ALIASES[h] ?? null;
}

/**
 * The category a settings sub-page belongs to: the page itself, or the page
 * it sits under (`/settings/layouts/<id>` belongs with Layouts).
 */
export function categoryForPath(pathname: string): SettingsCategory | null {
  let best: SettingsEntry | undefined;
  for (const e of SETTINGS_ENTRIES) {
    if (e.anchor || e.href === "/settings") continue;
    if (pathname === e.href || pathname.startsWith(`${e.href}/`)) {
      if (!best || e.href.length > best.href.length) best = e;
    }
  }
  return best?.category ?? null;
}

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

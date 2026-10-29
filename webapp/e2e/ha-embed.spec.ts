import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEVICES_TAB,
  EMBED_HELP_URL,
  TAB_NAME_MAX,
  blockedAsMixedContent,
  choicesNotAdded,
  cleanDashboardPath,
  dashboardFrameUrl,
  devicesTabLabel,
  embedBaseUrl,
  embedUrlAcceptable,
  dashboardPageHref,
  embeddedDashboards,
  frameAllow,
  kioskQuery,
  navDashboards,
  moveDashboard,
  pickTab,
  renameDashboard,
} from "../src/lib/ha-embed";
import { codeOnly } from "./source-helpers";
import { DASHBOARD_NAV_ICON_IDS } from "../src/lib/dashboard-nav-icons";

/**
 * The household's own Home Assistant dashboards as tabs on Home Automation:
 * where each tab's frame points, which tab a display comes back to, and the
 * wiring around them. Home Assistant draws the dashboard; Kinboard only picks
 * the address, so most of what can go wrong is in these pure functions. No stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("a dashboard opens at its first view, with kiosk-mode's options when asked, under any base path", () => {
  const kitchen = { path: "dashboard-kitchen", hide_sidebar: true, hide_header: true };
  expect(dashboardFrameUrl("https://ha.example", kitchen)).toBe("https://ha.example/dashboard-kitchen/0?kiosk");
  expect(dashboardFrameUrl("https://ha.example", { ...kitchen, hide_header: false })).toBe(
    "https://ha.example/dashboard-kitchen/0?hide_sidebar",
  );
  expect(dashboardFrameUrl("https://ha.example", { ...kitchen, hide_sidebar: false })).toBe(
    "https://ha.example/dashboard-kitchen/0?hide_header",
  );
  expect(dashboardFrameUrl("https://ha.example", { ...kitchen, hide_sidebar: false, hide_header: false })).toBe(
    "https://ha.example/dashboard-kitchen/0",
  );
  // Slashes at either end of the base and the path make no difference.
  expect(dashboardFrameUrl("https://ha.example/", { ...kitchen, path: "/dashboard-kitchen/" })).toBe(
    "https://ha.example/dashboard-kitchen/0?kiosk",
  );
  // A base path a reverse proxy put Home Assistant under is kept.
  expect(dashboardFrameUrl("https://example.org/ha/", kitchen)).toBe("https://example.org/ha/dashboard-kitchen/0?kiosk");
  // A view named with the dashboard is opened as named.
  expect(dashboardFrameUrl("https://ha.example", { ...kitchen, path: "dashboard-kitchen/garden" })).toBe(
    "https://ha.example/dashboard-kitchen/garden?kiosk",
  );
  expect(dashboardFrameUrl("http://homeassistant.local:8123", { path: "lovelace", hide_sidebar: false, hide_header: false })).toBe(
    "http://homeassistant.local:8123/lovelace/0",
  );
  // Nothing of the base's own query or fragment rides along.
  expect(dashboardFrameUrl("https://ha.example/?x=1#y", kitchen)).toBe("https://ha.example/dashboard-kitchen/0?kiosk");
});

test("no frame for an address a browser can't open, or a path that would point anywhere else", () => {
  const ok = { path: "dashboard-kitchen", hide_sidebar: true, hide_header: true };
  for (const base of [undefined, "", "   ", "not an address", "ftp://ha.example", "javascript:alert(1)", "file:///etc/passwd"]) {
    expect(dashboardFrameUrl(base, ok), String(base)).toBeNull();
  }
  for (const path of ["", "/", "..", "../admin", "a/b/c", "//evil.example", "https://evil.example", "dash board", "x?y", "x#y", "%2e%2e"]) {
    expect(cleanDashboardPath(path), path).toBeNull();
    expect(dashboardFrameUrl("https://ha.example", { path, hide_sidebar: false, hide_header: false }), path).toBeNull();
  }
  expect(cleanDashboardPath("  /dashboard-kitchen/garden/ ")).toBe("dashboard-kitchen/garden");
  // No username or password in the address the frame opens.
  expect(dashboardFrameUrl("https://someone@ha.example", ok)).toBeNull();
  expect(dashboardFrameUrl("https://someone:secret@ha.example", ok)).toBeNull();
});

test("the address for the browser is http(s) without a username or password, or nothing", () => {
  for (const good of [undefined, null, "", "   ", "https://ha.example", "http://homeassistant.local:8123", "https://example.org/ha/"]) {
    expect(embedUrlAcceptable(good), String(good)).toBe(true);
  }
  for (const bad of ["ftp://ha.example", "javascript:alert(1)", "not an address", "https://ha@evil.example", "https://u:p@ha.example", 42, {}]) {
    expect(embedUrlAcceptable(bad), String(bad)).toBe(false);
  }
});

test("an https page says why it can't show an http dashboard", () => {
  expect(blockedAsMixedContent("https:", "http://ha.example/lovelace/0")).toBe(true);
  expect(blockedAsMixedContent("https:", "https://ha.example/lovelace/0")).toBe(false);
  expect(blockedAsMixedContent("http:", "http://ha.example/lovelace/0")).toBe(false);
  expect(blockedAsMixedContent("http:", "https://ha.example/lovelace/0")).toBe(false);
});

test("the tabs come from the settings in their order, without broken entries; a browser address wins", () => {
  expect(embeddedDashboards(undefined)).toEqual([]);
  expect(embeddedDashboards(null)).toEqual([]);
  expect(embeddedDashboards({ embedded_dashboards: "nope" as never })).toEqual([]);
  const good = [
    { id: "b", title: "Garden", path: "dashboard-garden", hide_sidebar: true, hide_header: false },
    { id: "a", title: "Overview", path: "lovelace", hide_sidebar: false, hide_header: false },
  ];
  const mixed = [
    good[0],
    null,
    { id: "", title: "No id", path: "dashboard-x", hide_sidebar: true, hide_header: true },
    { id: "c", title: "Bad path", path: "../admin", hide_sidebar: true, hide_header: true },
    { id: "d", path: "dashboard-y", hide_sidebar: true, hide_header: true },
    good[1],
  ];
  // Not in the navigation unless switched on, no icon of its own, and no microphone.
  const normalised = (d: object) => ({ ...d, in_nav: false, nav_icon: null, microphone: false });
  expect(embeddedDashboards({ embedded_dashboards: mixed as never })).toEqual(good.map(normalised));
  // A tab saved with the single switch it once had reads as both, and nothing of it is kept.
  expect(
    embeddedDashboards({
      embedded_dashboards: [
        { id: "e", title: "Old", path: "dashboard-old", kiosk: true },
        { id: "f", title: "Old, open", path: "dashboard-open", kiosk: false },
        { id: "g", title: "Old, unset", path: "dashboard-unset" },
      ] as never,
    }),
  ).toEqual(
    [
      { id: "e", title: "Old", path: "dashboard-old", hide_sidebar: true, hide_header: true },
      { id: "f", title: "Old, open", path: "dashboard-open", hide_sidebar: false, hide_header: false },
      { id: "g", title: "Old, unset", path: "dashboard-unset", hide_sidebar: false, hide_header: false },
    ].map(normalised),
  );
  // The microphone only for a tab switched on for it: true, nothing else.
  const withMic = (microphone: unknown) =>
    embeddedDashboards({ embedded_dashboards: [{ ...good[0], microphone }] as never })[0].microphone;
  expect(withMic(true)).toBe(true);
  expect(withMic("true")).toBe(false);
  expect(withMic(undefined)).toBe(false);
  expect(frameAllow({ microphone: true })).toBe("fullscreen; autoplay; microphone");
  expect(frameAllow({ microphone: false })).toBe("fullscreen; autoplay");
  expect(frameAllow({})).toBe("fullscreen; autoplay");

  expect(kioskQuery({ hide_sidebar: true, hide_header: true })).toBe("?kiosk");
  expect(kioskQuery({ hide_sidebar: true, hide_header: false })).toBe("?hide_sidebar");
  expect(kioskQuery({ hide_sidebar: false, hide_header: true })).toBe("?hide_header");
  expect(kioskQuery({ hide_sidebar: false, hide_header: false })).toBe("");

  expect(embedBaseUrl({ url: "http://homeassistant:8123", embed_url: "https://ha.example" })).toBe("https://ha.example");
  expect(embedBaseUrl({ url: "https://ha.example", embed_url: "   " })).toBe("https://ha.example");
  expect(embedBaseUrl({ url: "https://ha.example" })).toBe("https://ha.example");
  expect(embedBaseUrl({ url: "" })).toBeUndefined();
  expect(embedBaseUrl(null)).toBeUndefined();
});

test("a dashboard can have an entry in the navigation, with an icon from the set, opening a page of its own", () => {
  const base = { title: "Energie", path: "dashboard-energie", hide_sidebar: true, hide_header: true };
  const tabs = embeddedDashboards({
    embedded_dashboards: [
      { id: "a", ...base, in_nav: true, nav_icon: "zap" },
      { id: "b", ...base, in_nav: "yes", nav_icon: "sun" },
      // An emoji from the first build, a Lucide name outside the set, not a string: none.
      { id: "c", ...base, in_nav: true, nav_icon: "⚡" },
      { id: "d", ...base, in_nav: true, nav_icon: "skull" },
      { id: "f", ...base, in_nav: true, nav_icon: 7 },
      { id: "e", ...base },
    ] as never,
  });
  expect(tabs.map((d) => [d.id, d.in_nav, d.nav_icon])).toEqual([
    ["a", true, "zap"],
    ["b", false, "sun"],
    ["c", true, null],
    ["d", true, null],
    ["f", true, null],
    ["e", false, null],
  ]);
  expect(navDashboards(tabs).map((d) => d.id)).toEqual(["a", "c", "d", "f"]);
  // Every icon in the set has a component and a name in every language.
  const icons = codeOnly(read("src/components/dashboard-nav-icon.tsx"));
  for (const lang of ["en", "de", "fr"]) {
    const names = JSON.parse(read(`messages/${lang}.json`)).dashboardNavIcons;
    expect(Object.keys(names).sort(), lang).toEqual([...DASHBOARD_NAV_ICON_IDS].sort());
  }
  for (const id of DASHBOARD_NAV_ICON_IDS) expect(icons, id).toMatch(new RegExp(`^\\s*"?${id}"?: [A-Z]\\w+,$`, "m"));
  expect(dashboardPageHref("a")).toBe("/ha/a");
  expect(dashboardPageHref("x/../y?z")).toBe("/ha/x%2F..%2Fy%3Fz");
});

test("the navigation lists those dashboards after Home automation, hideable per device, and the page finds its dashboard", () => {
  const hook = codeOnly(read("src/hooks/use-visible-nav-items.ts"));
  expect(hook).toMatch(/navDashboards\(embeddedDashboards\(haSettings\)\)/);
  expect(hook).toMatch(/haConnected\s*\?/);
  expect(hook).toMatch(/hiddenItems\.includes\(entry\.href\)/);
  expect(hook).toMatch(/item\.href === "\/home-automation"/);
  expect(hook).toMatch(/icon: dashboardNavIcon\(d\.nav_icon\)/);
  for (const nav of ["src/components/mobile-nav.tsx", "src/components/desktop-nav.tsx", "src/app/settings/navigation/page.tsx"]) {
    const code = codeOnly(read(nav));
    expect(code, nav).toContain("navEntryLabel(");
    expect(code, nav).not.toMatch(/tNav\(item\.labelKey/);
  }
  const page = codeOnly(read("src/app/ha/[id]/page.tsx"));
  expect(page).toMatch(/embeddedDashboards\(settings\)\.find\(\(d\) => d\.id === id\)/);
  expect(page).toContain("<HaDashboardFrame");
  expect(page).toContain('t("dashboardPageMissing")');
  const settings = codeOnly(read("src/app/settings/homeassistant/dashboards/page.tsx"));
  expect(settings).toMatch(/\{ \.\.\.d, in_nav \}/);
  expect(settings).toMatch(/\{ \.\.\.d, nav_icon \}/);
  expect(settings).toContain("<DashboardNavIconField");
});

test("the first tab takes the household's name, trimmed and capped; empty is the app's own word", () => {
  expect(devicesTabLabel(undefined, "Devices")).toBe("Devices");
  expect(devicesTabLabel(null, "Geräte")).toBe("Geräte");
  expect(devicesTabLabel({}, "Devices")).toBe("Devices");
  expect(devicesTabLabel({ devices_tab_title: "   " }, "Devices")).toBe("Devices");
  expect(devicesTabLabel({ devices_tab_title: "  Our house " }, "Devices")).toBe("Our house");
  expect(TAB_NAME_MAX).toBe(40);
  expect(devicesTabLabel({ devices_tab_title: "x".repeat(60) }, "Devices")).toBe("x".repeat(TAB_NAME_MAX));
});

test("a display comes back to its tab while that still exists; picking and moving", () => {
  const tabs = [{ id: "a" }, { id: "b" }];
  expect(pickTab(null, tabs)).toBe(DEVICES_TAB);
  expect(pickTab("b", tabs)).toBe("b");
  expect(pickTab("gone", tabs)).toBe(DEVICES_TAB);
  expect(pickTab(DEVICES_TAB, tabs)).toBe(DEVICES_TAB);
  expect(pickTab("a", [])).toBe(DEVICES_TAB);

  const choices = [
    { path: "lovelace", title: "Overview", admin_only: false },
    { path: "dashboard-garden", title: "Garden", admin_only: false },
    { path: "dashboard-admin", title: "Admin", admin_only: true },
  ];
  // Already a tab, however its path was written.
  expect(choicesNotAdded(choices, [{ path: "/dashboard-garden/" }]).map((c) => c.path)).toEqual(["lovelace", "dashboard-admin"]);

  const named = [{ id: "a", title: "Garden" }, { id: "b", title: "Overview" }];
  expect(renameDashboard(named, "b", "  Our music ")).toEqual([{ id: "a", title: "Garden" }, { id: "b", title: "Our music" }]);
  expect(renameDashboard(named, "a", "y".repeat(60))?.[0].title).toBe("y".repeat(TAB_NAME_MAX));
  // A dashboard's tab keeps a name.
  expect(renameDashboard(named, "a", "   ")).toBeNull();
  expect(renameDashboard(named, "missing", "x")).toEqual(named);
  expect(named[1].title).toBe("Overview");

  const list = ["a", "b", "c"];
  expect(moveDashboard(list, 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveDashboard(list, 1, 1)).toEqual(["a", "c", "b"]);
  expect(moveDashboard(list, 0, -1)).toEqual(list);
  expect(moveDashboard(list, 2, 1)).toEqual(list);
  expect(moveDashboard(list, 7, 1)).toEqual(list);
  expect(moveDashboard(list, 0, 1)).not.toBe(list);
  expect(list).toEqual(["a", "b", "c"]);
});

test("the page has tabs only when there are dashboards, keeps the display's choice, and a dashboard tab is Home Assistant's page alone", () => {
  const page = codeOnly(read("src/app/home-automation/page.tsx"));
  expect(page).toContain("const dashboards = useMemo(() => embeddedDashboards(settings), [settings]);");
  expect(page).toContain("const tab = pickTab(rememberedTab, dashboards);");
  expect(page).toMatch(/try \{\s*setRememberedTab\(window\.localStorage\.getItem\(TAB_STORAGE_KEY\)\);\s*\} catch/);
  expect(page).toMatch(/try \{\s*window\.localStorage\.setItem\(TAB_STORAGE_KEY, value\);\s*\} catch/);
  expect(page).toContain("const tabs = dashboards.length > 0 && (");
  expect(page).toMatch(/<SegmentedControlItem value=\{DEVICES_TAB\}[^>]*>\s*\{devicesTabLabel\(settings, t\("tabDevices"\)\)\}/);
  // The dashboard tab returns before the devices, their banners and dialogs.
  const early = page.slice(page.indexOf("if (activeDashboard) {"), page.indexOf("if (activeDashboard) {") + 700);
  expect(early).toContain("<HaDashboardFrame dashboard={activeDashboard} baseUrl={embedBaseUrl(settings)} />");
  expect(early).toContain("{header}");
  expect(early).toContain("{tabs}");
  expect(early).not.toContain("EntityDetailSheet");
  // The devices view shows the same header and tabs.
  expect(page.match(/\{header\}\s*\{tabs\}/g)?.length).toBe(2);
});

test("the frame: Home Assistant's address, a name, no sandbox, and a message instead of a blank tab", () => {
  const frame = codeOnly(read("src/components/home-assistant/ha-dashboard-frame.tsx"));
  expect(frame).toContain("const src = dashboardFrameUrl(baseUrl, dashboard);");
  expect(frame).toMatch(/<iframe[\s\S]*?src=\{src\}[\s\S]*?title=\{t\("dashboardFrameTitle", \{ name: dashboard\.title \}\)\}/);
  // Sandboxed with what Home Assistant needs, and never the right to navigate the display away.
  expect(frame).toContain(
    'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"',
  );
  expect(frame).not.toContain("allow-top-navigation");
  // What the frame may use comes from the tab: the microphone only when switched on.
  expect(frame).toContain("allow={frameAllow(dashboard)}");
  // Only the browser knows the page's protocol: checked after mount.
  expect(frame).toMatch(/useEffect\(\(\) => \{[\s\S]*?setMixed\(src !== null && blockedAsMixedContent\(window\.location\.protocol, src\)\);/);
  expect(frame).toContain("if (src === null || mixed) {");
  expect(frame).toContain('role="alert"');
  // The help link shows for the first seconds whether or not the frame says it loaded:
  // browsers fire load for their own "refused to connect" page.
  expect(frame).toContain("const timer = setTimeout(() => setHint(false), FRAME_HINT_MS);");
  expect(frame).toMatch(/\{hint && \(\s*<p className="absolute inset-x-0 bottom-0/);
  expect(frame).toContain("href={EMBED_HELP_URL}");
});

test("focus moving into a frame counts as activity for the screensaver", () => {
  const idle = codeOnly(read("src/hooks/use-idle-timeout.ts"));
  expect(idle).toContain('window.addEventListener("blur", handleBlur);');
  expect(idle).toContain('window.removeEventListener("blur", handleBlur);');
  expect(idle).toMatch(/setTimeout\(\(\) => \{\s*if \(!disposed && document\.activeElement instanceof HTMLIFrameElement\) handleActivity\(e\);/);
  expect(idle).toMatch(/return \(\) => \{\s*disposed = true;/);
});

test("Home Assistant's list of dashboards comes through Kinboard's server, for the family's own session", () => {
  // Saved settings: the server refuses an address with a username, a password or another scheme,
  // and stores the tab list the way the page reads it.
  const settingsRoute = codeOnly(read("src/app/api/settings/route.ts"));
  expect(settingsRoute).toMatch(/if \(key === SETTINGS_KEYS\.homeAssistant && value && typeof value === "object"\) \{\s*if \(!embedUrlAcceptable\(value\.embed_url\)\) \{/);
  expect(settingsRoute).toContain("value = { ...value, embedded_dashboards: embeddedDashboards(value) };");
  // A save is over once the settings on screen are the saved ones.
  const hook = codeOnly(read("src/hooks/use-home-assistant.ts"));
  expect(hook).toMatch(/onSuccess: async \(\) => \{[\s\S]{0,400}?await queryClient\.invalidateQueries\(\{ queryKey: \["home-assistant-status", family\?\.id\] \}\);/);
  const route = codeOnly(read("src/app/api/homeassistant/dashboards/route.ts"));
  expect(route).toContain("const auth = await requireSession(request);");
  expect(route).toContain("if (!familyMatchesSession(auth.session, familyId)) {");
  expect(route).toContain("getMergedSetting<HomeAssistantSettings>(familyId, SETTINGS_KEYS.homeAssistant)");
  expect(route).toContain('type: "lovelace/dashboards/list",');
  // Home Assistant leaves its default dashboard out of the list.
  expect(route).toContain("const dashboards: HaDashboardChoice[] = [OVERVIEW];");
  expect(route).toContain('const OVERVIEW: HaDashboardChoice = { path: "lovelace", title: "Overview", admin_only: false };');
  expect(route).toContain("admin_only: item.require_admin === true,");
  expect(route).toContain("{ status: 502 }");
});

test("the settings page saves each change with the Home Assistant settings and takes a typed path when the list fails", () => {
  const settings = codeOnly(read("src/app/settings/homeassistant/dashboards/page.tsx"));
  expect(settings).toContain("const saveSettings = useSaveHomeAssistantSettings();");
  expect(settings).toContain("const choicesQuery = useHaDashboardChoices(isConnected);");
  expect(settings).toContain("const typing = picked === OTHER_PATH || choicesQuery.isError;");
  expect(settings).toContain("{ id: safeRandomUUID(), title: name, path: cleanPath, hide_sidebar: true, hide_header: true },");
  // Each tab has a switch for the sidebar and one for the header, which keeps a dashboard's own tabs.
  expect(settings).toMatch(/checked=\{dashboard\.hide_sidebar\}[\s\S]*?d\.id === dashboard\.id \? \{ \.\.\.d, hide_sidebar \} : d/);
  expect(settings).toMatch(/checked=\{dashboard\.hide_header\}[\s\S]*?d\.id === dashboard\.id \? \{ \.\.\.d, hide_header \} : d/);
  expect(settings).toContain('{t("hideHeaderHint")}');
  expect(settings).toMatch(/checked=\{dashboard\.microphone === true\}[\s\S]*?d\.id === dashboard\.id \? \{ \.\.\.d, microphone \} : d/);
  expect(settings).toContain('{t("microphoneHint")}');
  expect(settings).toContain("embedded_dashboards: moveDashboard(dashboards, index, -1)");
  expect(settings).toContain("embedded_dashboards: moveDashboard(dashboards, index, 1)");
  expect(settings).toContain("if (dashboards.some((d) => cleanDashboardPath(d.path) === cleanPath)) {");
  expect(settings).toContain("await save({ embed_url: value })");
  expect(settings).toContain("if (!embedUrlAcceptable(value)) {");
  // The first tab: renamed here, named in the app's language when left empty, as long as a tab may be.
  expect(settings).toContain("onSave={(name) => saveName({ devices_tab_title: name })}");
  // Every dashboard's tab is renamed in place, and never to nothing.
  expect(settings).toMatch(/<TabNameField\s+id=\{`ha-tab-name-\$\{dashboard\.id\}`\}[\s\S]*?allowEmpty=\{false\}[\s\S]*?renameDashboard\(dashboards, dashboard\.id, name\)/);
  expect(settings).toContain('const canSave = !busy && name !== value.trim() && (allowEmpty || name !== "");');
  expect(settings).toContain('if (e.key === "Enter") submit();');
  expect(settings).toContain('placeholder={tPage("tabDevices")}');
  expect(settings.match(/maxLength=\{TAB_NAME_MAX\}/g)?.length).toBe(2);
  expect(settings).toMatch(/role="status"[\s\S]{0,160}tSettings\("loadingHint"\)/);
  const main = codeOnly(read("src/app/settings/homeassistant/page.tsx"));
  expect(main).toContain('<Link href="/settings/homeassistant/dashboards">');
});

test("every new string is there in every language, with the same placeholders", () => {
  const load = (lang: string) => JSON.parse(read(`messages/${lang}.json`));
  const [en, de, fr] = ["en", "de", "fr"].map(load);
  const groups: Array<[string, (m: Record<string, any>) => Record<string, string>, string[]]> = [
    ["homeAutomation", (m) => m.homeAutomation, ["viewsAria", "tabDevices", "dashboardFrameTitle", "dashboardLoading", "dashboardSlowHint", "dashboardHelpLink", "dashboardNoAddress", "dashboardMixedContent", "dashboardSettingsLink"]],
    ["settings.homeassistant", (m) => m.settings.homeassistant, ["embedHeading", "embedDescription", "embedManageButton"]],
    ["settings.homeassistantDashboards", (m) => m.settings.homeassistantDashboards, Object.keys(en.settings.homeassistantDashboards)],
  ];
  expect(Object.keys(en.settings.homeassistantDashboards).length).toBeGreaterThan(30);
  for (const [name, pick, keys] of groups) {
    for (const key of keys) {
      const english = pick(en)[key];
      expect(typeof english, `${name}.${key}`).toBe("string");
      const placeholders = (english.match(/\{\w+\}/g) ?? []).sort();
      for (const [lang, messages] of [["de", de], ["fr", fr]] as const) {
        const text = pick(messages)[key];
        expect(typeof text === "string" && text.trim() !== "", `${lang} ${name}.${key}`).toBe(true);
        expect((text.match(/\{\w+\}/g) ?? []).sort(), `${lang} ${name}.${key}`).toEqual(placeholders);
      }
    }
  }
  expect(Object.keys(de.settings.homeassistantDashboards).sort()).toEqual(Object.keys(en.settings.homeassistantDashboards).sort());
  expect(Object.keys(fr.settings.homeassistantDashboards).sort()).toEqual(Object.keys(en.settings.homeassistantDashboards).sort());
});

test("the wiki section every hint links to exists", () => {
  expect(EMBED_HELP_URL).toBe("https://github.com/svenger87/kinboard/wiki/Home-Assistant#home-assistant-dashboards-as-tabs");
  const wiki = readFileSync(join(process.cwd(), "..", "docs", "wiki", "Home-Assistant.md"), "utf8");
  expect(wiki).toContain("\n## Home Assistant dashboards as tabs\n");
  expect(wiki).toContain("Send X-Frame-Options");
  expect(wiki).toContain("**Its own origin.**");
  expect(readFileSync(join(process.cwd(), "..", "docs", "wiki", "Smart-Home.md"), "utf8")).toContain(
    "(Home-Assistant#home-assistant-dashboards-as-tabs)",
  );
});

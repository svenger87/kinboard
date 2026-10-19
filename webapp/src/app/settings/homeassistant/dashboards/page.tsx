"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHaDashboardChoices,
  useHomeAssistantStatus,
  useSaveHomeAssistantSettings,
} from "@/hooks/use-home-assistant";
import {
  choicesNotAdded,
  cleanDashboardPath,
  EMBED_HELP_URL,
  embedUrlAcceptable,
  embeddedDashboards,
  moveDashboard,
  renameDashboard,
  TAB_NAME_MAX,
} from "@/lib/ha-embed";
import { safeRandomUUID } from "@/lib/uuid";
import { EmojiIconField } from "@/components/emoji-picker";
import type { HaDashboardChoice, HomeAssistantSettings } from "@/types/home-assistant";

/** The picker's entry for typing a path by hand. */
const OTHER_PATH = "__other__";

/**
 * Which of the household's Home Assistant dashboards are tabs on the Home
 * Automation page, in what order, and the address a browser opens Home
 * Assistant at for them (lib/ha-embed.ts). Every change is saved at once, like
 * the rooms beside it; there is nothing to lose, so removing a tab asks
 * nothing — adding it again brings it back.
 */
export default function HaDashboardsSettingsPage() {
  const t = useTranslations("settings.homeassistantDashboards");
  const tPage = useTranslations("homeAutomation");
  const tSettings = useTranslations("settings.homeassistant");
  const { data: settings, isLoading } = useHomeAssistantStatus();
  const isConnected = !!settings?.url && !!settings?.access_token;
  const saveSettings = useSaveHomeAssistantSettings();
  const choicesQuery = useHaDashboardChoices(isConnected);

  const dashboards = embeddedDashboards(settings);
  const choices = choicesNotAdded(choicesQuery.data ?? [], dashboards);
  const busy = saveSettings.isPending;

  const [picked, setPicked] = useState("");
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  useEffect(() => {
    setAddress(settings?.embed_url ?? "");
  }, [settings?.embed_url]);

  // Home Assistant's own list leaves out its default dashboard; the server adds
  // it as "lovelace", and it is named here in the app's language.
  const labelFor = (choice: HaDashboardChoice) =>
    choice.path === "lovelace" ? t("overview") : choice.title;
  // A path is typed when asked for, or when Home Assistant would not list its dashboards.
  const typing = picked === OTHER_PATH || choicesQuery.isError;
  const choice = typing ? undefined : choices.find((c) => c.path === picked);

  const save = async (patch: Partial<HomeAssistantSettings>): Promise<boolean> => {
    try {
      await saveSettings.mutateAsync(patch);
      return true;
    } catch {
      toast.error(t("toastSaveFailed"));
      return false;
    }
  };

  const add = async () => {
    const cleanPath = cleanDashboardPath(typing ? path : (choice?.path ?? ""));
    if (!cleanPath) {
      toast.error(t("pathInvalid"));
      return;
    }
    if (dashboards.some((d) => cleanDashboardPath(d.path) === cleanPath)) {
      toast.error(t("duplicatePath"));
      return;
    }
    const name = title.trim() || (choice ? labelFor(choice) : cleanPath);
    const added = await save({
      embedded_dashboards: [
        ...dashboards,
        { id: safeRandomUUID(), title: name, path: cleanPath, hide_sidebar: true, hide_header: true },
      ],
    });
    if (added) {
      setPicked("");
      setPath("");
      setTitle("");
      toast.success(t("toastAdded", { name }));
    }
  };

  // A new name for a tab, from its own field: the page's first tab, or one dashboard's.
  const saveName = async (patch: Partial<HomeAssistantSettings> | null): Promise<boolean> => {
    if (!patch) return false;
    const saved = await save(patch);
    if (saved) toast.success(t("toastNameSaved"));
    return saved;
  };

  const saveAddress = async () => {
    const value = address.trim();
    // The server checks the same and refuses anything else.
    if (!embedUrlAcceptable(value)) {
      toast.error(t("addressInvalid"));
      return;
    }
    if (await save({ embed_url: value })) toast.success(t("toastAddressSaved"));
  };

  return (
    <main id="main-content" className="min-h-page bg-background text-foreground safe-area-inset">
      <header className="sticky top-0 z-50 -mx-4 px-4 bg-background border-b border-border/50">
        <div className="flex items-center gap-4 py-4">
          <Link href="/settings/homeassistant">
            <Button variant="ghost" size="icon" aria-label={t("backAria")}>
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{t("headerTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("headerSubtitle")}</p>
          </div>
        </div>
      </header>

      <div className="py-4 flex flex-col gap-6 max-w-2xl mx-auto">
        {/* What Home Assistant needs first — without it every tab stays blank. */}
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <LayoutDashboard className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">{t("setupTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("setupBody")}</p>
            </div>
          </div>
          <a
            href={EMBED_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 self-start text-sm font-medium text-primary underline"
          >
            {t("setupLink")}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>{tSettings("loadingHint")}</span>
          </div>
        ) : !isConnected ? (
          <Card className="p-6 flex flex-col gap-3">
            <p className="text-sm">{t("notConnected")}</p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link href="/settings/homeassistant">{t("notConnectedLink")}</Link>
            </Button>
          </Card>
        ) : (
          <>
            {/* The tabs, in the order Home Automation shows them */}
            <section className="flex flex-col gap-3" aria-labelledby="ha-tabs-heading">
              <h2 id="ha-tabs-heading" className="font-medium">{t("listHeading")}</h2>
              {/* The page's own tab is always first: it can be renamed, not moved or removed. */}
              <Card className="p-4 flex flex-col gap-2" data-testid="ha-devices-tab">
                <Label htmlFor="ha-devices-tab-title">{t("devicesTabLabel")}</Label>
                <TabNameField
                  id="ha-devices-tab-title"
                  value={settings?.devices_tab_title ?? ""}
                  placeholder={tPage("tabDevices")}
                  allowEmpty
                  busy={busy}
                  saveLabel={t("nameSave")}
                  onSave={(name) => saveName({ devices_tab_title: name })}
                />
                <p className="text-xs text-muted-foreground">{t("devicesTabHint", { name: tPage("tabDevices") })}</p>
              </Card>
              {dashboards.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>
              ) : (
                dashboards.map((dashboard, index) => (
                  <Card key={dashboard.id} className="p-4 flex flex-col gap-3" data-testid="ha-dashboard-tab">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 flex flex-col gap-1">
                        <TabNameField
                          id={`ha-tab-name-${dashboard.id}`}
                          value={dashboard.title}
                          ariaLabel={t("tabNameAria", { name: dashboard.title })}
                          allowEmpty={false}
                          busy={busy}
                          saveLabel={t("nameSave")}
                          onSave={(name) => {
                            const renamed = renameDashboard(dashboards, dashboard.id, name);
                            return saveName(renamed && { embedded_dashboards: renamed });
                          }}
                        />
                        <p className="text-xs text-muted-foreground font-mono truncate">/{dashboard.path}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy || index === 0}
                          aria-label={t("moveUpAria", { name: dashboard.title })}
                          onClick={() => void save({ embedded_dashboards: moveDashboard(dashboards, index, -1) })}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy || index === dashboards.length - 1}
                          aria-label={t("moveDownAria", { name: dashboard.title })}
                          onClick={() => void save({ embedded_dashboards: moveDashboard(dashboards, index, 1) })}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          aria-label={t("removeAria", { name: dashboard.title })}
                          onClick={() =>
                            void save({ embedded_dashboards: dashboards.filter((d) => d.id !== dashboard.id) })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor={`ha-sidebar-${dashboard.id}`} className="text-sm">
                        {t("hideSidebarLabel")}
                      </Label>
                      <Switch
                        id={`ha-sidebar-${dashboard.id}`}
                        checked={dashboard.hide_sidebar}
                        disabled={busy}
                        onCheckedChange={(hide_sidebar) =>
                          void save({
                            embedded_dashboards: dashboards.map((d) =>
                              d.id === dashboard.id ? { ...d, hide_sidebar } : d,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Label htmlFor={`ha-header-${dashboard.id}`} className="text-sm">
                          {t("hideHeaderLabel")}
                        </Label>
                        <p className="text-xs text-muted-foreground">{t("hideHeaderHint")}</p>
                      </div>
                      <Switch
                        id={`ha-header-${dashboard.id}`}
                        checked={dashboard.hide_header}
                        disabled={busy}
                        onCheckedChange={(hide_header) =>
                          void save({
                            embedded_dashboards: dashboards.map((d) =>
                              d.id === dashboard.id ? { ...d, hide_header } : d,
                            ),
                          })
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("kioskHint")}</p>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Label htmlFor={`ha-nav-${dashboard.id}`} className="text-sm">
                          {t("navLabel")}
                        </Label>
                        <p className="text-xs text-muted-foreground">{t("navHint")}</p>
                      </div>
                      <Switch
                        id={`ha-nav-${dashboard.id}`}
                        checked={dashboard.in_nav === true}
                        disabled={busy}
                        onCheckedChange={(in_nav) =>
                          void save({
                            embedded_dashboards: dashboards.map((d) =>
                              d.id === dashboard.id ? { ...d, in_nav } : d,
                            ),
                          })
                        }
                      />
                    </div>
                    {dashboard.in_nav && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm">{t("navIconLabel")}</p>
                          <p className="text-xs text-muted-foreground">{t("navIconHint")}</p>
                        </div>
                        <EmojiIconField
                          id={`ha-nav-icon-${dashboard.id}`}
                          label={t("navIconLabel")}
                          value={dashboard.nav_icon ?? null}
                          onChange={(nav_icon) =>
                            void save({
                              embedded_dashboards: dashboards.map((d) =>
                                d.id === dashboard.id ? { ...d, nav_icon } : d,
                              ),
                            })
                          }
                        />
                      </div>
                    )}
                  </Card>
                ))
              )}
            </section>

            {/* Adding one: picked from Home Assistant's own list, or its path typed */}
            <Card className="p-4 flex flex-col gap-4">
              <h2 className="font-medium">{t("addHeading")}</h2>
              {choicesQuery.isError ? (
                <p className="text-sm text-muted-foreground">{t("listFailed")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ha-dashboard-pick">{t("pickLabel")}</Label>
                  <Select value={picked} onValueChange={setPicked}>
                    <SelectTrigger id="ha-dashboard-pick">
                      <SelectValue placeholder={t("pickPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => (
                        <SelectItem key={c.path} value={c.path}>
                          {labelFor(c)}
                          {c.admin_only && (
                            <span className="ml-2 text-xs text-muted-foreground">{t("adminOnly")}</span>
                          )}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER_PATH}>{t("pickOther")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {typing && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ha-dashboard-path">{t("pathLabel")}</Label>
                  <Input
                    id="ha-dashboard-path"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="dashboard-kitchen"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">{t("pathHint")}</p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="ha-dashboard-title">{t("titleLabel")}</Label>
                <Input
                  id="ha-dashboard-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={choice ? labelFor(choice) : undefined}
                  maxLength={TAB_NAME_MAX}
                />
              </div>
              <Button
                onClick={() => void add()}
                disabled={busy || (typing ? path.trim() === "" : !choice)}
                className="self-start"
              >
                <Plus className="size-4 mr-2" />
                {t("addButton")}
              </Button>
            </Card>

            {/* The address the wall display opens Home Assistant at, when it is not Kinboard's own */}
            <Card className="p-4 flex flex-col gap-2" data-testid="ha-embed-address">
              <Label htmlFor="ha-embed-url">{t("addressLabel")}</Label>
              <Input
                id="ha-embed-url"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={settings?.url}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t("addressHint", { url: settings?.url ?? "" })}</p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void saveAddress()}
                disabled={busy || address.trim() === (settings?.embed_url ?? "").trim()}
              >
                {t("addressSave")}
              </Button>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

interface TabNameFieldProps {
  id: string;
  /** The name as saved. */
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  /** The page's first tab may be left empty (it is then called by the app's own word); a dashboard's tab keeps a name. */
  allowEmpty: boolean;
  busy: boolean;
  saveLabel: string;
  onSave: (name: string) => Promise<boolean>;
}

/**
 * A tab's name, edited in place with its own Save (or Enter): trimmed, at most
 * TAB_NAME_MAX long, and saved only when it changed.
 */
function TabNameField({ id, value, placeholder, ariaLabel, allowEmpty, busy, saveLabel, onSave }: TabNameFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const name = draft.trim().slice(0, TAB_NAME_MAX);
  const canSave = !busy && name !== value.trim() && (allowEmpty || name !== "");
  const submit = () => {
    if (canSave) void onSave(name);
  };
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={TAB_NAME_MAX}
      />
      <Button variant="outline" onClick={submit} disabled={!canSave}>
        {saveLabel}
      </Button>
    </div>
  );
}

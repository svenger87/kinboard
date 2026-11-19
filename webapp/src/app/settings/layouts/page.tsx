"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertCircle, Copy, LayoutTemplate, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/page-header";
import { ScreenPicker, sizeFits, type ScreenChoice } from "@/components/layouts/editor/screen-picker";
import { useDevices } from "@/hooks/use-supabase-queries";
import { useNameList } from "@/hooks/use-name-list";
import {
  LayoutRequestError,
  useCreateLayout,
  useDeleteLayout,
  useDuplicateLayout,
  useLayoutDefaults,
  useLayouts,
  useSetLayoutDefaults,
  useAssignLayout,
} from "@/hooks/use-layouts";
import { orientationOf } from "@/lib/layouts/grid";
import { fallbackAfterDelete, layoutUsage, type LayoutUse } from "@/lib/layouts/usage";
import type { Layout, LayoutDefaults } from "@/lib/layouts/types";
import type { Device } from "@/types/database";

const BUILT_IN = "builtin";
const NOBODY: LayoutUse<Device> = { assigned: [], viaDefault: [] };
type Orientation = "portrait" | "landscape";

/**
 * Settings → Layouts: the family's layouts (shape, the screens using them,
 * which one is a default), a new one for a chosen screen size made from the
 * built-in arrangement, copies, deletion, and the two defaults wall screens
 * without a layout of their own fall back to.
 */
export default function LayoutsSettingsPage() {
  const t = useTranslations("settings.layouts");
  const { data: layouts, isLoading, error, refetch } = useLayouts();
  const { data: devices = [] } = useDevices();
  const { data: defaults } = useLayoutDefaults();
  const [newOpen, setNewOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<Layout | null>(null);
  const [deleting, setDeleting] = useState<Layout | null>(null);

  const usage = layoutUsage(devices, layouts ?? [], defaults ?? { portrait: null, landscape: null });
  const usageOf = (id: string) => usage.get(id) ?? NOBODY;

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={LayoutTemplate}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button className="gap-2" onClick={() => setNewOpen(true)} data-testid="layouts-new">
              <Plus className="size-4" aria-hidden="true" />
              {t("new.button")}
            </Button>
          }
        />

        <Card className="divide-y divide-border/50" data-testid="layouts-list" aria-busy={isLoading || (!layouts && !error)}>
          {error ? (
            <div className="p-8 text-center">
              <AlertCircle className="size-10 mx-auto mb-3 text-destructive opacity-50" aria-hidden="true" />
              <p className="text-destructive font-medium">{t("loadFailed")}</p>
              <Button variant="outline" onClick={() => refetch()} className="mt-4 gap-2">
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("retry")}
              </Button>
            </div>
          ) : isLoading || !layouts ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 p-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))
          ) : layouts.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground" data-testid="layouts-empty">
              <LayoutTemplate className="size-10 mx-auto mb-3 opacity-50" aria-hidden="true" />
              {t("empty")}
            </div>
          ) : (
            layouts.map((layout) => (
              <LayoutRow
                key={layout.id}
                layout={layout}
                shown={usageOf(layout.id)}
                defaults={defaults}
                onDuplicate={() => setDuplicating(layout)}
                onDelete={() => setDeleting(layout)}
              />
            ))
          )}
        </Card>

        {layouts && <DefaultsCard layouts={layouts} defaults={defaults} />}
      </div>

      <NewLayoutDialog open={newOpen} onOpenChange={setNewOpen} devices={devices} />
      <DuplicateDialog layout={duplicating} onClose={() => setDuplicating(null)} />
      <DeleteDialog
        layout={deleting}
        shown={deleting ? usageOf(deleting.id) : NOBODY}
        layouts={layouts ?? []}
        defaults={defaults}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}

function LayoutRow({
  layout,
  shown,
  defaults,
  onDuplicate,
  onDelete,
}: {
  layout: Layout;
  shown: LayoutUse<Device>;
  defaults: LayoutDefaults | undefined;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings.layouts");
  const names = useNameList();
  const orientation = orientationOf(layout.width, layout.height);
  return (
    <div
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
      data-testid="layout-row"
      data-layout-id={layout.id}
      data-device-count={shown.assigned.length + shown.viaDefault.length}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 break-words font-medium" data-testid="layout-name">
            {layout.name}
          </p>
          {defaults?.portrait === layout.id && (
            <Badge variant="secondary" className="text-xs" data-testid="layout-badge-portrait">
              {t("badgePortrait")}
            </Badge>
          )}
          {defaults?.landscape === layout.id && (
            <Badge variant="secondary" className="text-xs" data-testid="layout-badge-landscape">
              {t("badgeLandscape")}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums" data-testid="layout-shape">
          {t("shape", { width: layout.width, height: layout.height, orientation })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" data-testid="layout-devices">
          {shown.assigned.length + shown.viaDefault.length === 0
            ? t("usedByNone")
            : [
                shown.assigned.length > 0 && t("usedByAssigned", { names: names(shown.assigned.map((d) => d.name)) }),
                shown.viaDefault.length > 0 && t("usedByDefault", { names: names(shown.viaDefault.map((d) => d.name)) }),
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <Link href={`/settings/layouts/${layout.id}`} data-testid="layout-edit" aria-label={t("editAria", { name: layout.name })}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("edit")}
          </Link>
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onDuplicate} data-testid="layout-duplicate" aria-label={t("duplicateAria", { name: layout.name })}>
          <Copy className="size-4" aria-hidden="true" />
          {t("duplicate.button")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={onDelete}
          data-testid="layout-delete"
          aria-label={t("deleteAria", { name: layout.name })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {t("delete.button")}
        </Button>
      </div>
    </div>
  );
}

/** The two defaults: each offers the built-in screensaver and the layouts drawn in its orientation. */
function DefaultsCard({ layouts, defaults }: { layouts: Layout[]; defaults: LayoutDefaults | undefined }) {
  const t = useTranslations("settings.layouts.defaults");
  const setDefaults = useSetLayoutDefaults();
  // What each picker shows: a stored id that is not one of the family's
  // layouts of that orientation (deleted elsewhere, say) is the built-in, and
  // is sent as null, so it can never make the other slot's change fail.
  const valid = (slot: Orientation): string | null => {
    const id = defaults?.[slot] ?? null;
    return id && layouts.some((l) => l.id === id && orientationOf(l.width, l.height) === slot) ? id : null;
  };
  const current: LayoutDefaults = { portrait: valid("portrait"), landscape: valid("landscape") };

  const change = async (slot: Orientation, value: string) => {
    try {
      await setDefaults.mutateAsync({ ...current, [slot]: value === BUILT_IN ? null : value });
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("failed"));
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-4" id="defaults" data-setting="defaults">
      <div>
        <h2 className="font-medium">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {(["portrait", "landscape"] as const).map((slot) => {
        const options = layouts.filter((l) => orientationOf(l.width, l.height) === slot);
        const value = current[slot] ?? BUILT_IN;
        return (
          <div key={slot} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Label id={`default-${slot}-label`}>{t(slot)}</Label>
            <Select value={value} onValueChange={(v) => void change(slot, v)} disabled={setDefaults.isPending}>
              <SelectTrigger className="w-full sm:w-64" aria-labelledby={`default-${slot}-label`} data-testid={`default-${slot}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BUILT_IN}>{t("builtIn")}</SelectItem>
                {options.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </Card>
  );
}

/**
 * The first screen that reported a size a layout fits on, wall screens
 * (kiosks) before the others, else Full HD portrait.
 */
function initialScreen(devices: Device[]): ScreenChoice {
  for (const d of [...devices.filter((x) => x.is_kiosk), ...devices.filter((x) => !x.is_kiosk)]) {
    if (!d.screen) continue;
    const width = Math.round(d.screen.viewportWidth);
    const height = Math.round(d.screen.viewportHeight);
    if (sizeFits(width, height)) return { key: `device:${d.id}`, width, height };
  }
  return { key: "preset:portrait1080", width: 1080, height: 1920 };
}

function NewLayoutDialog({ open, onOpenChange, devices }: { open: boolean; onOpenChange: (open: boolean) => void; devices: Device[] }) {
  const t = useTranslations("settings.layouts.new");
  const router = useRouter();
  const create = useCreateLayout();
  const assign = useAssignLayout();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ScreenChoice | null>(null);
  const [useOnDevice, setUseOnDevice] = useState(true);
  const screen = picked ?? initialScreen(devices);
  const trimmed = name.trim();
  // Drawn for a screen's own size: offer to put it on that screen right away.
  const forDevice = screen.key.startsWith("device:") ? devices.find((d) => `device:${d.id}` === screen.key) ?? null : null;

  const submit = async () => {
    if (!trimmed || create.isPending) return;
    try {
      const created = await create.mutateAsync({ name: trimmed, width: screen.width, height: screen.height, from: "builtin" });
      if (forDevice && useOnDevice) {
        // The layout exists either way; a failed assignment leaves the editor's notice to offer it again.
        await assign.mutateAsync({ deviceId: forDevice.id, layoutId: created.id }).catch(() => toast.error(t("assignFailed", { name: forDevice.name })));
      }
      onOpenChange(false);
      router.push(`/settings/layouts/${created.id}`);
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("failed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName("");
          setPicked(null);
          setUseOnDevice(true);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="new-layout-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-layout-name">{t("name")}</Label>
            <Input
              id="new-layout-name"
              data-testid="new-layout-name"
              value={name}
              maxLength={60}
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5 [&>div]:flex-wrap">
            <ScreenPicker value={screen} onChange={setPicked} />
            <p className="text-xs text-muted-foreground">{t("screenHint")}</p>
          </div>
          {forDevice && (
            <div className="flex items-center gap-2">
              <Checkbox id="new-layout-use" data-testid="new-layout-use" checked={useOnDevice} onCheckedChange={(on) => setUseOnDevice(on === true)} />
              <Label htmlFor="new-layout-use" className="font-normal">
                {t("useOn", { name: forDevice.name })}
              </Label>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || create.isPending || assign.isPending} className="gap-2" data-testid="new-layout-create">
              {(create.isPending || assign.isPending) && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateDialog({ layout, onClose }: { layout: Layout | null; onClose: () => void }) {
  const t = useTranslations("settings.layouts.duplicate");
  const duplicate = useDuplicateLayout();
  const [name, setName] = useState("");
  const [forId, setForId] = useState<string | null>(null);
  // Each layout opened here starts from its own suggested name.
  if (layout && layout.id !== forId) {
    setForId(layout.id);
    setName(t("defaultName", { name: layout.name }).slice(0, 60));
  }
  const trimmed = name.trim();

  const submit = async () => {
    if (!layout || !trimmed || duplicate.isPending) return;
    try {
      await duplicate.mutateAsync({ id: layout.id, name: trimmed });
      toast.success(t("done", { name: trimmed }));
      setForId(null);
      onClose();
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("failed"));
    }
  };

  return (
    <Dialog
      open={!!layout}
      onOpenChange={(next) => {
        if (!next) {
          setForId(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="duplicate-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title", { name: layout?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duplicate-name">{t("name")}</Label>
            <Input id="duplicate-name" data-testid="duplicate-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={duplicate.isPending}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || duplicate.isPending} className="gap-2" data-testid="duplicate-create">
              {duplicate.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asks before deleting, naming what changes: the screens that had this
 * layout (and what they show instead) and the default it clears.
 */
function DeleteDialog({
  layout,
  shown,
  layouts,
  defaults,
  onClose,
}: {
  layout: Layout | null;
  shown: LayoutUse<Device>;
  layouts: Layout[];
  defaults: LayoutDefaults | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("settings.layouts.delete");
  const names = useNameList();
  const remove = useDeleteLayout();

  const isDefaultFor: Orientation | null =
    layout && defaults?.portrait === layout.id ? "portrait" : layout && defaults?.landscape === layout.id ? "landscape" : null;

  // Every screen showing it (as its own or as a default) gets what resolves without it: another default, or built-in.
  const fallbacks = new Map<string, string[]>();
  if (layout) {
    for (const d of [...shown.assigned, ...shown.viaDefault]) {
      const key = fallbackAfterDelete(d, layout.id, layouts, defaults ?? { portrait: null, landscape: null })?.name ?? "";
      fallbacks.set(key, [...(fallbacks.get(key) ?? []), d.name]);
    }
  }

  const confirm = async () => {
    if (!layout) return;
    try {
      await remove.mutateAsync(layout.id);
      toast.success(t("done", { name: layout.name }));
      onClose();
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("failed"));
    }
  };

  return (
    <AlertDialog open={!!layout} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent data-testid="delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { name: layout?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>{t("description")}</p>
              {fallbacks.size > 0 && (
                <div data-testid="delete-devices" className="flex flex-col gap-1">
                  {[...fallbacks].map(([other, devs]) => (
                    <p key={other}>
                      {other
                        ? t("devicesDefault", { names: names(devs), count: devs.length, layout: other })
                        : t("devicesBuiltIn", { names: names(devs), count: devs.length })}
                    </p>
                  ))}
                </div>
              )}
              {isDefaultFor && (
                <p data-testid="delete-default">{t("default", { orientation: isDefaultFor })}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="delete-confirm"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

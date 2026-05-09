"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Rss, Plus, Pencil, Trash2, Copy, Check, Loader2, Info, RefreshCw } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import {
  useCalendars,
  useCreateIcsCalendar,
  useUpdateCalendar,
  useDeleteCalendar,
  useIcsSync,
  usePeople,
} from "@/hooks";
import type { Calendar } from "@/types/database";

const PRESET_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#a855f7",
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#eab308",
  "#ef4444",
  "#64748b",
];

interface FeedFormState {
  name: string;
  url: string;
  color: string;
  person_id: string | null;
  is_holidays: boolean;
  is_waste_collection: boolean;
}

interface TestResult {
  ok: boolean;
  eventCount?: number;
  firstEventTitle?: string | null;
  error?: string;
}

const emptyForm = (): FeedFormState => ({
  name: "",
  url: "",
  color: PRESET_COLORS[0],
  person_id: null,
  is_holidays: false,
  is_waste_collection: false,
});

export default function IcsSettingsPage() {
  const t = useTranslations("settings.ics");
  const { toast } = useToast();

  const { data: allCalendars = [], isLoading } = useCalendars();
  const { data: people = [] } = usePeople();
  const createIcs = useCreateIcsCalendar();
  const updateCalendar = useUpdateCalendar();
  const deleteCalendar = useDeleteCalendar();
  const icsSync = useIcsSync();

  async function handleSyncNow() {
    try {
      const result = await icsSync.mutateAsync();
      toast({
        title: t("syncSuccessTitle"),
        description: t("syncSuccessBody", {
          succeeded: result.succeeded,
          failed: result.failed,
        }),
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("syncErrorTitle"),
        description: err instanceof Error ? err.message : "",
      });
    }
  }

  const icsCalendars = allCalendars.filter(
    (c) => c.ics_url != null
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null);
  const [form, setForm] = useState<FeedFormState>(emptyForm());
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isSaving = createIcs.isPending || updateCalendar.isPending;

  const openAddDialog = () => {
    setEditingCalendar(null);
    setForm(emptyForm());
    setTestResult(null);
    setDialogOpen(true);
  };

  const openEditDialog = (cal: Calendar) => {
    setEditingCalendar(cal);
    setForm({
      name: cal.name,
      url: cal.ics_url ?? "",
      color: cal.color,
      person_id: cal.person_id,
      is_holidays: cal.is_holidays,
      is_waste_collection: cal.is_waste_collection,
    });
    setTestResult(null);
    setDialogOpen(true);
  };

  const handleTest = async () => {
    if (!form.url.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/calendar/test-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.url.trim() }),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: "Network error" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) return;

    if (editingCalendar) {
      updateCalendar.mutate(
        {
          id: editingCalendar.id,
          name: form.name.trim(),
          color: form.color,
          person_id: form.person_id,
          is_holidays: form.is_holidays,
          is_waste_collection: form.is_waste_collection,
          ics_url: form.url.trim(),
        },
        {
          onSuccess: () => {
            toast({ title: t("toastUpdated") });
            setDialogOpen(false);
          },
          onError: () => {
            toast({ title: t("toastError"), variant: "destructive" });
          },
        }
      );
    } else {
      createIcs.mutate(
        {
          name: form.name.trim(),
          color: form.color,
          ics_url: form.url.trim(),
          person_id: form.person_id,
          is_holidays: form.is_holidays,
          is_waste_collection: form.is_waste_collection,
        },
        {
          onSuccess: () => {
            toast({ title: t("toastAdded") });
            setDialogOpen(false);
          },
          onError: () => {
            toast({ title: t("toastError"), variant: "destructive" });
          },
        }
      );
    }
  };

  const handleDelete = (calId: string) => {
    deleteCalendar.mutate(calId, {
      onSuccess: () => {
        toast({ title: t("toastDeleted") });
      },
    });
  };

  const copyUrl = (cal: Calendar) => {
    if (!cal.ics_url) return;
    navigator.clipboard.writeText(cal.ics_url);
    setCopiedId(cal.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatLastSynced = (ts: string | null) => {
    if (!ts) return t("neverSynced");
    const d = new Date(ts);
    return t("lastSynced", { time: d.toLocaleString() });
  };

  return (
    <main
      id="main-content"
      className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Rss}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          actions={
            <div className="flex items-center gap-2">
              {icsCalendars.length > 0 && (
                <Button
                  onClick={handleSyncNow}
                  size="sm"
                  variant="outline"
                  disabled={icsSync.isPending}
                  aria-label={t("syncNow")}
                >
                  <RefreshCw
                    className={`size-4 mr-2 ${icsSync.isPending ? "animate-spin" : ""}`}
                  />
                  {icsSync.isPending ? t("syncing") : t("syncNow")}
                </Button>
              )}
              <Button onClick={openAddDialog} size="sm">
                <Plus className="size-4 mr-2" />
                {t("addButton")}
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <GlassCard className="p-4 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </GlassCard>
        ) : icsCalendars.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <GlassCard className="p-10 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 rounded-xl bg-month-primary/10">
                  <Rss className="size-8 text-month-primary" strokeWidth={1.5} />
                </div>
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {t("emptyDescription")}
                </p>
                <Button onClick={openAddDialog} className="mt-2">
                  <Plus className="size-4 mr-2" />
                  {t("addButton")}
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        ) : (
          <GlassCard className="divide-y divide-border/50">
            <AnimatePresence initial={false}>
              {icsCalendars.map((cal) => (
                <motion.div
                  key={cal.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 flex items-start gap-4"
                >
                  <div
                    className="mt-1 size-4 rounded-full shrink-0"
                    style={{ backgroundColor: cal.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{cal.name}</p>
                      {cal.is_holidays && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Holidays
                        </Badge>
                      )}
                      {cal.is_waste_collection && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Waste
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatLastSynced(cal.last_synced_at)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">
                      {cal.ics_url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => copyUrl(cal)}
                      title="Copy URL"
                    >
                      {copiedId === cal.id ? (
                        <Check className="size-4 text-success" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEditDialog(cal)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("deleteDescription")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(cal.id)}
                          >
                            {t("deleteConfirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </GlassCard>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCalendar ? t("dialogEditTitle") : t("dialogAddTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="ics-name">{t("nameLabel")}</Label>
              <Input
                id="ics-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("namePlaceholder")}
              />
            </div>

            {/* URL */}
            <div className="grid gap-1.5">
              <Label htmlFor="ics-url">{t("urlLabel")}</Label>
              <Input
                id="ics-url"
                value={form.url}
                onChange={(e) => {
                  setForm((f) => ({ ...f, url: e.target.value }));
                  setTestResult(null);
                }}
                placeholder={t("urlPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("urlHint")}</p>

              {/* iCloud tip */}
              <div className="flex items-start gap-2 rounded-lg bg-month-primary/5 border border-month-primary/10 p-3 text-xs text-muted-foreground">
                <Info className="size-3.5 mt-0.5 text-month-primary shrink-0" />
                <span>{t("icloudTip")}</span>
              </div>

              {/* Test button + result */}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={!form.url.trim() || isTesting}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      {t("testingLabel")}
                    </>
                  ) : (
                    t("testButton")
                  )}
                </Button>

                {testResult && (
                  <span
                    className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
                  >
                    {testResult.ok
                      ? testResult.eventCount === 0
                        ? t("testNoEvents")
                        : t("testSuccess", { count: testResult.eventCount ?? 0 })
                      : t("testFailed", { error: testResult.error ?? "Unknown" })}
                  </span>
                )}
              </div>
            </div>

            {/* Color */}
            <div className="grid gap-1.5">
              <Label>{t("colorLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className="size-7 rounded-full ring-offset-2 ring-offset-background transition-all"
                    style={{
                      backgroundColor: c,
                      outline: form.color === c ? `3px solid ${c}` : "3px solid transparent",
                    }}
                  />
                ))}
                {/* Custom color */}
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="size-7 rounded-full border border-border cursor-pointer bg-transparent p-0"
                  title="Custom color"
                />
              </div>
            </div>

            {/* Person assignment */}
            <div className="grid gap-1.5">
              <Label>{t("personLabel")}</Label>
              <Select
                value={form.person_id ?? "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, person_id: v === "none" ? null : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("personPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("personPlaceholder")}</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ics-holidays" className="font-normal">
                  {t("isHolidaysLabel")}
                </Label>
                <Switch
                  id="ics-holidays"
                  checked={form.is_holidays}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_holidays: v }))}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ics-waste" className="font-normal">
                  {t("isWasteLabel")}
                </Label>
                <Switch
                  id="ics-waste"
                  checked={form.is_waste_collection}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_waste_collection: v }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.url.trim() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : (
                t("saveButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useFamilyStore } from "@/stores/family-store";
import {
  useGoalImageSearch,
  useCreatePocketMoneyGoal,
  useUpdatePocketMoneyGoal,
} from "@/hooks";
import type { PocketMoneyGoal } from "@/types/database";

interface Props {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, the dialog edits this goal instead of creating one. Reused
   * rather than duplicated so editing keeps the image search and the
   * same validation the create flow has.
   */
  goal?: PocketMoneyGoal | null;
}

export function GoalAddDialog({ accountId, open, onOpenChange, goal = null }: Props) {
  const t = useTranslations("pocketMoney");
  const createGoal = useCreatePocketMoneyGoal();
  const updateGoal = useUpdatePocketMoneyGoal();
  const isEditing = goal !== null;
  const [name, setName] = useState("");
  const [targetCents, setTargetCents] = useState<number>(1000); // €10 default
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<"catalog" | "upload" | "url">("catalog");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: searchResults = [] } = useGoalImageSearch(searchQuery);

  const reset = () => {
    setName("");
    setTargetCents(1000);
    setImageUrl(null);
    setSearchQuery("");
    setImageSource("catalog");
  };

  // Load the goal being edited whenever the dialog opens, so reopening
  // it after a cancel doesn't show the previous edit's leftovers.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (goal) {
      setName(goal.name);
      setTargetCents(goal.target_amount_cents);
      setImageUrl(goal.image_url);
      setImageSource((goal.image_source as "catalog" | "upload" | "url") ?? "catalog");
      setSearchQuery("");
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const handleSubmit = async () => {
    if (!name || targetCents <= 0) return;
    const input = {
      name,
      target_amount_cents: targetCents,
      image_url: imageUrl,
      image_source: imageSource,
    };
    setError(null);
    try {
      if (goal) {
        await updateGoal.mutateAsync({ id: goal.id, accountId, update: input });
      } else {
        await createGoal.mutateAsync({ accountId, input });
      }
    } catch {
      // Keep the dialog open so the entered values aren't lost, but say
      // so — a swallowed failure looked identical to a saved goal.
      setError(t("errorGeneric"));
      return;
    }
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editGoalTitle") : t("addGoalTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="goal-name">{t("goalNameLabel")}</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("goalNamePlaceholder")}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="goal-target">{t("goalTargetLabel")}</Label>
            <Input
              id="goal-target"
              type="number"
              step="1"
              value={targetCents / 100}
              onChange={(e) =>
                setTargetCents(Math.max(0, Math.round(Number(e.target.value) * 100)))
              }
            />
          </div>

          <Tabs
            value={imageSource}
            onValueChange={(v) => setImageSource(v as typeof imageSource)}
          >
            <TabsList>
              <TabsTrigger value="catalog">{t("imageTabCatalog")}</TabsTrigger>
              <TabsTrigger value="url">{t("imageTabUrl")}</TabsTrigger>
              <TabsTrigger value="upload">{t("imageTabUpload")}</TabsTrigger>
            </TabsList>

            <TabsContent value="catalog" className="space-y-2">
              <Input
                placeholder={t("imageSearchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-auto">
                  {searchResults.map((r) => {
                    const isWeb = r.source === "web";
                    return (
                      <button
                        key={r.image_url}
                        type="button"
                        onClick={() => {
                          setImageUrl(r.image_url);
                          // Curated rows track their provenance via
                          // image_source = "catalog"; web-fallback rows
                          // are picked-from-web URLs and belong under
                          // the "url" enum bucket per the DB schema.
                          setImageSource(isWeb ? "url" : "catalog");
                          if (!name) setName(r.name);
                        }}
                        className={`relative p-1 rounded border ${
                          imageUrl === r.image_url
                            ? "border-month-primary ring-2 ring-month-primary/40"
                            : "border-border"
                        }`}
                      >
                        <img
                          src={r.image_url}
                          alt={r.name}
                          className="w-full h-20 object-cover rounded"
                        />
                        <p className="text-[10px] mt-1 truncate">{r.name}</p>
                        {isWeb && (
                          <span className="absolute top-1 right-1 rounded bg-black/60 text-white text-[9px] px-1 leading-tight">
                            {t("imageSourceWebBadge")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="url">
              <Input
                placeholder="https://example.com/image.jpg"
                value={imageUrl ?? ""}
                onChange={(e) => setImageUrl(e.target.value || null)}
              />
            </TabsContent>

            <TabsContent value="upload">
              <UploadTab onUploaded={(url) => setImageUrl(url)} currentUrl={imageUrl} />
            </TabsContent>
          </Tabs>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive px-1">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name || targetCents <= 0 || createGoal.isPending}
          >
            {t("createGoal")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Inline upload widget. Mirrors the vehicle image upload pattern (multipart
// POST with `image` + `family_id` fields, returns { url }).
function UploadTab({
  onUploaded,
  currentUrl,
}: {
  onUploaded: (url: string) => void;
  currentUrl: string | null;
}) {
  const t = useTranslations("pocketMoney");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { family } = useFamilyStore();

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy || !family?.id}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !family?.id) return;
          setBusy(true);
          setErr(null);
          try {
            const fd = new FormData();
            fd.append("image", file);
            fd.append("family_id", family.id);
            const r = await fetch("/api/pocket-money/goal-image-upload", {
              method: "POST",
              body: fd,
            });
            if (!r.ok) {
              const e = (await r.json().catch(() => ({}))) as { error?: string };
              throw new Error(e.error ?? `upload: ${r.status}`);
            }
            const json = (await r.json()) as { url: string };
            onUploaded(json.url);
          } catch (caught) {
            setErr(caught instanceof Error ? caught.message : "upload failed");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <p className="text-xs text-muted-foreground">{t("imageUploading")}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {currentUrl && !busy && (
        <img src={currentUrl} alt="" className="w-24 h-24 object-cover rounded" />
      )}
    </div>
  );
}

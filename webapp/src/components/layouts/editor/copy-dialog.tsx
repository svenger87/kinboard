"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LayoutRequestError, useCreateLayout } from "@/hooks/use-layouts";
import type { Layout, LayoutItem } from "@/lib/layouts/types";

const droppedKey = (id: string) => `kinboard_layout_dropped:${id}`;

/** The widgets a copy left behind, handed to the new layout's editor; cleared with clearCopyDropped once shown. */
export function readCopyDropped(id: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(droppedKey(id));
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function clearCopyDropped(id: string): void {
  try {
    sessionStorage.removeItem(droppedKey(id));
  } catch {
    /* noop */
  }
}

function handOverDropped(id: string, widgets: string[]): void {
  try {
    sessionStorage.setItem(droppedKey(id), JSON.stringify(widgets));
  } catch {
    /* Storage unavailable: the new layout opens without the list. */
  }
}

/**
 * A copy of this layout for the size being previewed, which the server
 * redraws from the saved layout: asks for a name, offers to save or discard
 * unsaved changes first, then opens the copy's editor.
 */
export function CopyForSize({
  layout,
  size,
  dirty,
  items,
  onSave,
  onDiscard,
}: {
  layout: Layout;
  size: { width: number; height: number };
  dirty: boolean;
  items: LayoutItem[];
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const t = useTranslations("settings.layouts.editor.copy");
  const router = useRouter();
  const create = useCreateLayout();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const run = async (first: "save" | "discard" | null) => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (first === "save" && !(await onSave())) return;
      if (first === "discard") onDiscard();
      const created = await create.mutateAsync({ name: trimmed, width: size.width, height: size.height, from: layout.id });
      // Item ids name their widget in layouts the editor made; fall back to the id.
      const widgetOf = new Map([...layout.screensaver, ...items].map((i) => [i.id, i.widget]));
      handOverDropped(created.id, created.dropped.map((id) => widgetOf.get(id) ?? id));
      setOpen(false);
      router.push(`/settings/layouts/${created.id}`);
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") toast.error(t("pinRequired"));
      else toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName(t("defaultName", { name: layout.name, width: size.width, height: size.height }).slice(0, 60));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="editor-copy">
          <Copy className="size-4" aria-hidden="true" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="copy-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dirty) void run(null);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title", { width: size.width, height: size.height })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-name">{t("name")}</Label>
            <Input id="copy-name" data-testid="copy-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          {dirty && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" data-testid="copy-unsaved">
              {t("unsaved")}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            {dirty ? (
              <>
                <Button type="button" variant="outline" onClick={() => void run("discard")} disabled={!trimmed || busy} data-testid="copy-discard">
                  {t("discardAndCopy")}
                </Button>
                <Button type="button" onClick={() => void run("save")} disabled={!trimmed || busy} data-testid="copy-save">
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {t("saveAndCopy")}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!trimmed || busy} data-testid="copy-create">
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("create")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

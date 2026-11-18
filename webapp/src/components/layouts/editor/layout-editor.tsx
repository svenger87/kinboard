"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Eye, Loader2, Redo2, RefreshCw, RotateCcw, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ScreensaverDataProvider, useScreensaverDataValue } from "@/components/layouts/screensaver-data-context";
import { useScreensaverData } from "@/hooks/use-screensaver-data";
import { useLayoutHistory } from "@/hooks/use-layout-history";
import { LayoutRequestError, useSaveLayout } from "@/hooks/use-layouts";
import { builtInScreensaver } from "@/lib/layouts/built-in";
import { gridFor } from "@/lib/layouts/grid";
import { nudge } from "@/lib/layouts/place";
import { rescaleItems } from "@/lib/layouts/rescale";
import { validateItems, type LayoutError } from "@/lib/layouts/validate";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import type { Layout, LayoutItem, SaverWidgetKey, TextSize } from "@/lib/layouts/types";
import { EditorCanvas } from "./canvas";
import { EditorPalette } from "./palette";
import { EditorInspector } from "./inspector";
import { ScreenPicker, type ScreenChoice } from "./screen-picker";
import { CopyForSize, clearCopyDropped, readCopyDropped } from "./copy-dialog";

const LAYOUT_ERRORS: readonly string[] = ["unknown_widget", "out_of_bounds", "below_minimum", "overlap", "duplicate", "bad_text_size"];
const WIDGET_KEYS = Object.keys(SAVER_WIDGETS) as SaverWidgetKey[];

/** Where the arrow keys belong to the control under focus rather than to the canvas. */
const OWN_ARROWS = "input, textarea, select, [contenteditable='true'], [role='group'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider']";
const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";
/** An open dialog (the reset confirmation, a select's list) owns the keyboard. */
const OPEN_DIALOG = "[role='dialog'], [role='alertdialog'], [role='listbox']";

/**
 * Unsaved changes, kept for this tab while they are unsaved: the PIN screen
 * that comes back when Settings lock again unmounts the editor, and the
 * changes must survive it. Tied to the stamp they were made on, so they are
 * never laid over someone else's newer save.
 */
interface Draft {
  items: LayoutItem[];
  stamp: string;
}
const draftKey = (id: string) => `kinboard_layout_draft:${id}`;

function readDraft(id: string): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return Array.isArray(d.items) && typeof d.stamp === "string" ? { items: d.items, stamp: d.stamp } : null;
  } catch {
    return null;
  }
}

function writeDraft(id: string, draft: Draft | null): void {
  try {
    if (draft) sessionStorage.setItem(draftKey(id), JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    /* Storage unavailable: the changes last as long as the editor does. */
  }
}

/**
 * The editor of one layout's screensaver: the palette, the canvas with the
 * real widgets and the family's data, the inspector, and undo, reset and
 * save. Changes stay in the page until saved; the save carries the stamp the
 * page loaded, so someone else's change in between is not overwritten.
 */
export function LayoutEditor({ layout, onReload }: { layout: Layout; onReload: () => Promise<void> }) {
  const t = useTranslations("settings.layouts.editor");
  const tw = useTranslations("settings.layouts.editor.widgets");
  const names = useMemo(
    () => Object.fromEntries(WIDGET_KEYS.map((k) => [k, tw(k)])) as Record<SaverWidgetKey, string>,
    [tw],
  );

  const [baseline, setBaseline] = useState<LayoutItem[]>(layout.screensaver);
  const [stamp, setStamp] = useState(layout.updated_at);
  const history = useLayoutHistory(baseline);
  const { items, set, undo, redo, canUndo, canRedo, dirty } = history;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScreenChoice>({ key: "own", width: layout.width, height: layout.height });
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  // Read once, on mount: a draft from before the PIN screen came back.
  const [draft] = useState(() => {
    const d = readDraft(layout.id);
    if (!d) return null;
    return { items: d.items, restorable: d.stamp === layout.updated_at };
  });
  // What a copy for this size left behind, shown once when the copy opens.
  const [copyDropped] = useState(() => readCopyDropped(layout.id));
  useEffect(() => clearCopyDropped(layout.id), [layout.id]);
  const ownSize = useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height]);
  const [notice, setNotice] = useState<"restored" | "lost" | null>(draft ? (draft.restorable ? "restored" : "lost") : null);
  const saveLayout = useSaveLayout();

  // The editor needs the screensaver's data for the widgets, not its photos;
  // the hook still runs its photo rotation here (see the task report).
  const data = useScreensaverDataValue(useScreensaverData());

  const ownGrid = useMemo(() => gridFor(layout.width, layout.height), [layout.width, layout.height]);
  const previewGrid = useMemo(() => gridFor(preview.width, preview.height) ?? ownGrid, [preview.width, preview.height, ownGrid]);
  // Columns are always 12, so a screen with the layout's number of rows shows
  // the same cells and can be edited; any other is a preview of the rescaled
  // arrangement, which is not what gets saved.
  const editable = !!ownGrid && !!previewGrid && previewGrid.rows === ownGrid.rows;
  const shown = useMemo(() => {
    if (!ownGrid || !previewGrid || editable) return { items, dropped: [] as string[] };
    return rescaleItems(items, ownGrid, previewGrid);
  }, [items, ownGrid, previewGrid, editable]);

  const selected = editable ? (items.find((i) => i.id === selectedId) ?? null) : null;
  const nameOf = useCallback(
    (itemId?: string) => {
      const item = items.find((i) => i.id === itemId);
      return item ? names[item.widget] : (itemId ?? "");
    },
    [items, names],
  );

  // A draft made on the copy just loaded comes back as the present (one undo
  // returns to the saved copy); one made on an older copy is dropped.
  useEffect(() => {
    if (!draft) return;
    if (draft.restorable) set(draft.items);
    else writeDraft(layout.id, null);
  }, [draft, layout.id, set]);

  useEffect(() => {
    writeDraft(layout.id, dirty ? { items, stamp } : null);
  }, [layout.id, dirty, items, stamp]);

  const commit = useCallback(
    (next: LayoutItem[]) => {
      setError(null);
      set(next);
    },
    [set],
  );

  const remove = useCallback(() => {
    if (!selectedId) return;
    commit(items.filter((i) => i.id !== selectedId));
    setSelectedId(null);
  }, [commit, items, selectedId]);

  const setText = (text: TextSize) => {
    if (selectedId) commit(items.map((i) => (i.id === selectedId ? { ...i, text } : i)));
  };

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TEXT_ENTRY) || document.querySelector(OPEN_DIALOG)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (!editable || !selectedId || mod || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step || target?.closest(OWN_ARROWS)) return;
      e.preventDefault();
      const next = ownGrid && nudge(items, selectedId, step[0], step[1], ownGrid.rows);
      if (next) commit(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, selectedId, items, ownGrid, undo, redo, remove, commit]);

  /** Saves the items; true when they were saved. */
  const save = async (): Promise<boolean> => {
    setError(null);
    const sent = items;
    const checked = validateItems(sent, layout.width, layout.height);
    if (!checked.ok) {
      setError(t(`errors.${checked.error}`, { name: nameOf(checked.itemId) }));
      return false;
    }
    try {
      const saved = await saveLayout.mutateAsync({ id: layout.id, screensaver: sent, updated_at: stamp });
      setStamp(saved.updated_at);
      setBaseline(sent);
      setNotice(null);
      toast.success(t("saved"));
      return true;
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "stale") setStale(true);
      // The PIN screen comes back by itself (relockSettings).
      else if (err instanceof LayoutRequestError && err.code === "pin_required") toast.error(t("errors.pinRequired"));
      else if (err instanceof LayoutRequestError && LAYOUT_ERRORS.includes(err.code)) setError(t(`errors.${err.code as LayoutError}`, { name: nameOf(err.itemId) }));
      else toast.error(t("errors.generic"));
      return false;
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      writeDraft(layout.id, null);
      await onReload();
    } finally {
      setReloading(false);
    }
  };

  if (!ownGrid) {
    return <p className="text-sm text-destructive">{t("tooSmall", { width: layout.width, height: layout.height })}</p>;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="layout-editor" data-dirty={dirty}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ScreenPicker own={ownSize} value={preview} onChange={setPreview} />
          {(preview.width !== layout.width || preview.height !== layout.height) && (
            <CopyForSize
              layout={layout}
              size={preview}
              dirty={dirty}
              items={items}
              onSave={save}
              onDiscard={() => writeDraft(layout.id, null)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={undo} disabled={!canUndo} data-testid="editor-undo" title={t("undoHint")}>
            <Undo2 className="size-4" aria-hidden="true" />
            {t("undo")}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={redo} disabled={!canRedo} data-testid="editor-redo" title={t("redoHint")}>
            <Redo2 className="size-4" aria-hidden="true" />
            {t("redo")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={!editable} data-testid="editor-reset">
                <RotateCcw className="size-4" aria-hidden="true" />
                {t("reset")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("resetTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("resetDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("resetCancel")}</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="editor-reset-confirm"
                  onClick={() => {
                    setSelectedId(null);
                    commit(builtInScreensaver(layout.width, layout.height));
                  }}
                >
                  {t("resetConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" className="gap-2" onClick={() => void save()} disabled={!dirty || saveLayout.isPending || stale} data-testid="editor-save">
            {saveLayout.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            {saveLayout.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      {copyDropped.length > 0 && (
        <div role="status" data-testid="editor-copy-dropped" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {t("copy.dropped", { names: copyDropped.map((w) => (w in names ? names[w as SaverWidgetKey] : w)).join(", ") })}
        </div>
      )}
      {notice && (
        <div role="status" data-testid="editor-draft-notice" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          {t(`draft.${notice}`)}
        </div>
      )}
      {stale && (
        <div role="alert" data-testid="editor-stale" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="flex-1">{t("stale")}</span>
          <Button size="sm" variant="outline" className="gap-2" onClick={reload} disabled={reloading} data-testid="editor-reload">
            <RefreshCw className={`size-4 ${reloading ? "animate-spin" : ""}`} aria-hidden="true" />
            {t("reload")}
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" data-testid="editor-error" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}
      {!editable && (
        <div data-testid="preview-readonly" className="flex flex-col gap-1 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Eye className="size-4 shrink-0" aria-hidden="true" />
            {t("preview.readOnly", { rows: previewGrid!.rows, layoutRows: ownGrid.rows })}
          </span>
          {shown.dropped.length > 0 && (
            <span data-testid="preview-dropped" className="text-amber-700 dark:text-amber-400">
              {t("preview.dropped", { names: shown.dropped.map((id) => nameOf(id)).join(", ") })}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:items-start">
        <EditorPalette items={items} rows={ownGrid.rows} disabled={!editable} names={names} onAdd={(item) => { commit([...items, item]); setSelectedId(item.id); }} />
        <ScreensaverDataProvider value={data}>
          <EditorCanvas
            grid={previewGrid!}
            items={shown.items}
            editable={editable}
            selectedId={selected?.id ?? null}
            names={names}
            onSelect={setSelectedId}
            onCommit={commit}
          />
        </ScreensaverDataProvider>
        <EditorInspector item={selected} disabled={!editable} names={names} onText={setText} onRemove={remove} />
      </div>
    </div>
  );
}

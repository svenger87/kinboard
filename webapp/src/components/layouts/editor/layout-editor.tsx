"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Eye, Grid3x3, Home, Info, Loader2, MonitorPlay, Redo2, RefreshCw, RotateCcw, Save, Undo2 } from "lucide-react";
import { previewScreensaver } from "@/lib/screensaver-gate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
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
import { HomeDataProvider } from "@/components/layouts/home-data-context";
import { useScreensaverData } from "@/hooks/use-screensaver-data";
import { useHomeData } from "@/hooks/use-home-data";
import { usePeople } from "@/hooks/use-supabase-queries";
import { useLayoutHistory } from "@/hooks/use-layout-history";
import { LayoutRequestError, useSaveLayout } from "@/hooks/use-layouts";
import { homeDataNeeds } from "@/lib/home-data";
import { builtInHome, builtInScreensaver } from "@/lib/layouts/built-in";
import { GRID, LAYOUT_GRID, gridFor } from "@/lib/layouts/grid";
import { homeArea } from "@/lib/layouts/home-area";
import { alignItems, distribute, matchSize, moveBy, resizeBy, setBox, type ArrangeReason, type ArrangeResult, type Box } from "@/lib/layouts/arrange";
import { fitItems, rescaleItems } from "@/lib/layouts/rescale";
import type { SurfaceAt } from "@/lib/layouts/home-size";
import { personOf, validateItems, type LayoutError } from "@/lib/layouts/validate";
import { HOME_WIDGETS, SAVER_WIDGETS, knownWidgetItems } from "@/lib/layouts/widgets";
import { useNameList } from "@/hooks/use-name-list";
import type { HomeLayoutItem, HomeWidgetKey, Layout, LayoutItem, SaverWidgetKey, Surface, TextSize } from "@/lib/layouts/types";
import { EditorCanvas } from "./canvas";
import { GRID_DISPLAYS, useGridDisplay, type GridDisplay } from "./grid-overlay";
import { EditorPalette, type PaletteEntry } from "./palette";
import { EditorInspector, type ArrangeCommand } from "./inspector";
import { withAlign, type Align } from "@/lib/layouts/align";
import { ScreenPicker, type ScreenChoice } from "./screen-picker";
import { CopyForSize, readCopyDropped, releaseCopyDropped } from "./copy-dialog";

const LAYOUT_ERRORS: readonly string[] = ["unknown_widget", "out_of_bounds", "below_minimum", "overlap", "duplicate", "bad_text_size", "bad_person"];
const WIDGET_KEYS = Object.keys(SAVER_WIDGETS) as SaverWidgetKey[];
const HOME_KEYS = Object.keys(HOME_WIDGETS) as HomeWidgetKey[];
const SURFACES: readonly Surface[] = ["home", "screensaver"];

/** A placed box of either surface. */
type Item = LayoutItem<string>;

/** "Each widget once" on a surface: on Home a per-child widget once per child. */
const placedKey = (widget: string, personId: string | undefined) => `${widget}\u0000${personId ?? ""}`;

/** Where the arrow keys belong to the control under focus rather than to the canvas. */
const OWN_ARROWS = "input, textarea, select, [contenteditable='true'], [role='group'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='slider']";
const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";
/** An open dialog (the reset confirmation, a select's list) owns the keyboard. */
const OPEN_DIALOG = "[role='dialog'], [role='alertdialog'], [role='listbox']";
/** Which way each arrow key moves a box, or (with Alt) which edge it grows: right and down grow, left and up shrink. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** How long the toolbar says why a command was refused. */
const REFUSED_MS = 4000;

/**
 * Unsaved changes, kept for this tab while they are unsaved: the PIN screen
 * that comes back when Settings lock again unmounts the editor, and the
 * changes must survive it. Tied to the stamp they were made on, so they are
 * never laid over someone else's newer save. The key names the grid the
 * positions count: a draft from an editor on another grid (the 12-column
 * one kept `kinboard_layout_draft:<id>`, in cells) is never read as steps,
 * even though migration 087 kept the stamp it was made on.
 */
interface Draft {
  /** The screensaver's items (the name from before Home could be edited). */
  items: LayoutItem[];
  /** Home's items, only when Home has unsaved changes. */
  home?: HomeLayoutItem[];
  stamp: string;
}
const draftKey = (id: string) => `kinboard_layout_draft:${LAYOUT_GRID}:${id}`;
const legacyDraftKey = (id: string) => `kinboard_layout_draft:${id}`;

function readDraft(id: string): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    // Unusable here: in cells, from before the steps.
    sessionStorage.removeItem(legacyDraftKey(id));
    const raw = sessionStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (!Array.isArray(d.items) || typeof d.stamp !== "string") return null;
    return { items: d.items, stamp: d.stamp, ...(Array.isArray(d.home) ? { home: d.home } : {}) };
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
 * The editor of one layout, both of its faces: a Home | Screensaver switch
 * at the top, then for the face shown the palette, the canvas with the real
 * widgets and the family's data, the inspector, and undo, reset and save.
 * Changes stay in the page until saved; the save carries the stamp the page
 * loaded, so someone else's change in between is not overwritten.
 *
 * Each face keeps its own undo history: undo only ever changes what is on
 * the canvas, never the face out of sight. One save sends both faces' unsaved
 * changes in one request, under the one stamp. Home is drawn on the area its
 * grid gets (homeArea: the screen less the navigation bar); a layout whose
 * Home is empty starts its Home tab from today's Home for that area
 * (builtInHome), and stays on the built-in until a change there is saved.
 */
export function LayoutEditor({ layout, onReload }: { layout: Layout; onReload: () => Promise<void> }) {
  const t = useTranslations("settings.layouts.editor");
  const tw = useTranslations("settings.layouts.editor.widgets");
  const th = useTranslations("settings.layouts.editor.homeWidgets");
  const names = useMemo(
    () => Object.fromEntries(WIDGET_KEYS.map((k) => [k, tw(k)])) as Record<SaverWidgetKey, string>,
    [tw],
  );
  const homeNames = useMemo(
    () => Object.fromEntries(HOME_KEYS.map((k) => [k, th(k)])) as Record<HomeWidgetKey, string>,
    [th],
  );
  const { data: people } = usePeople();
  const children = useMemo(() => (people ?? []).filter((p) => p.is_child), [people]);

  const [surface, setSurface] = useState<Surface>("screensaver");
  const ownSize = useMemo(() => ({ width: layout.width, height: layout.height }), [layout.width, layout.height]);
  const homeSize = useMemo(() => homeArea(layout.width, layout.height), [layout.width, layout.height]);

  // Only widgets this build knows: a key from a newer version is left out rather than crash the editor.
  const [baseline, setBaseline] = useState<LayoutItem[]>(() => knownWidgetItems(layout.screensaver));
  // Home as saved, or today's Home for this size while the layout has none of its own.
  const [homeDesigned, setHomeDesigned] = useState(() => knownWidgetItems(layout.home, "home").length > 0);
  const [homeBaseline, setHomeBaseline] = useState<HomeLayoutItem[]>(() => {
    const own = knownWidgetItems(layout.home, "home");
    if (own.length > 0) return own;
    const area = homeArea(layout.width, layout.height);
    return gridFor(area.width, area.height) ? builtInHome(area.width, area.height) : [];
  });
  const listNames = useNameList();
  const [stamp, setStamp] = useState(layout.updated_at);
  const saverHistory = useLayoutHistory(baseline);
  const homeHistory = useLayoutHistory<HomeLayoutItem>(homeBaseline);
  // The face on screen; its items are typed loosely, as either face's.
  const history = (surface === "home" ? homeHistory : saverHistory) as unknown as ReturnType<typeof useLayoutHistory<Item>>;
  const { items, set, undo: undoHistory, redo: redoHistory, canUndo, canRedo } = history;
  const saverItems = saverHistory.items;
  const homeItems = homeHistory.items;
  const setSaverItems = saverHistory.set;
  const setHomeItems = homeHistory.set;
  const dirty = saverHistory.dirty || homeHistory.dirty;
  // In the order they were selected: the first is the one commands on several boxes go by.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Why the last keyboard command changed nothing; `at` restarts the timer when the same reason comes again.
  const [refused, setRefused] = useState<{ reason: ArrangeReason; at: number } | null>(null);
  const [preview, setPreview] = useState<ScreenChoice>({ key: "own", width: layout.width, height: layout.height });
  const [stale, setStale] = useState(false);
  // The server counts positions on another grid than this page (it was
  // updated meanwhile): only reloading the page brings the matching code.
  const [gridChanged, setGridChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [gridDisplay, setGridDisplay] = useGridDisplay();
  // Read once, on mount: a draft from before the PIN screen came back.
  const [draft] = useState(() => {
    const d = readDraft(layout.id);
    if (!d) return null;
    return { items: d.items, home: d.home, restorable: d.stamp === layout.updated_at };
  });
  // What a copy for this size left behind, shown once when the copy opens.
  const [copyDropped] = useState(() => readCopyDropped(layout.id));
  useEffect(() => () => releaseCopyDropped(layout.id), [layout.id]);
  const [notice, setNotice] = useState<"restored" | "lost" | null>(draft ? (draft.restorable ? "restored" : "lost") : null);
  const saveLayout = useSaveLayout();

  // The editor needs the screensaver's data for the widgets, not its photos;
  // the hook still runs its photo rotation here (see the task report).
  const data = useScreensaverDataValue(useScreensaverData());
  // Home's shared data, for the Home widgets on the canvas: only what they read, and nothing while the screensaver is shown.
  const homeData = useHomeData(homeDataNeeds(surface === "home" ? homeItems.map((i) => i.widget) : []));

  // The face shown is drawn on its own area: the screen, or for Home the screen less the navigation bar.
  const area = surface === "home" ? homeSize : ownSize;
  // What the commands check against: Home's minimums are the ones for this layout's area.
  const on = useMemo<SurfaceAt>(() => (surface === "home" ? { surface: "home", ...homeSize } : "screensaver"), [surface, homeSize]);
  const ownGrid = useMemo(() => gridFor(area.width, area.height), [area.width, area.height]);
  const previewGrid = useMemo(() => {
    const p = surface === "home" ? homeArea(preview.width, preview.height) : preview;
    return gridFor(p.width, p.height) ?? ownGrid;
  }, [surface, preview, ownGrid]);
  // Every screen has 48 step columns, so one with the layout's number of
  // rows shows the same grid and can be edited; any other is a preview of
  // the rescaled arrangement, which is not what gets saved.
  const editable = !!ownGrid && !!previewGrid && previewGrid.rows === ownGrid.rows;
  const shown = useMemo(() => {
    if (!ownGrid || !previewGrid || editable) return { items, dropped: [] as string[] };
    return rescaleItems(items, ownGrid, previewGrid, surface);
  }, [items, ownGrid, previewGrid, editable, surface]);

  // Only boxes still there (an undo may have taken one away), and none on a preview.
  const selection = useMemo(
    () => (editable ? selectedIds.filter((id) => items.some((i) => i.id === id)) : []),
    [editable, selectedIds, items],
  );
  const selected = selection.length === 1 ? (items.find((i) => i.id === selection[0]) ?? null) : null;
  const personName = useCallback((id: string) => (people ?? []).find((p) => p.id === id)?.name ?? "?", [people]);
  /** A box's name: the widget's, and on Home a child's widget with the child's name. */
  const labelFor = useCallback(
    (on: Surface, item: Pick<Item, "widget" | "options">) => {
      if (on === "screensaver") return names[item.widget as SaverWidgetKey] ?? item.widget;
      const base = homeNames[item.widget as HomeWidgetKey] ?? item.widget;
      const person = personOf(item);
      return person ? t("homeWidgetForChild", { widget: base, name: personName(person) }) : base;
    },
    [names, homeNames, personName, t],
  );
  const label = useCallback((item: Item) => labelFor(surface, item), [labelFor, surface]);
  /** The name of the box an error is about: looked up on the face shown first, then on the other. */
  const nameOf = useCallback(
    (itemId?: string) => {
      const here = items.find((i) => i.id === itemId);
      if (here) return labelFor(surface, here);
      const other = surface === "home" ? "screensaver" : "home";
      const there = (other === "home" ? homeItems : saverItems).find((i) => i.id === itemId);
      return there ? labelFor(other, there) : (itemId ?? "");
    },
    [items, surface, homeItems, saverItems, labelFor],
  );

  /** What the palette offers on the face shown: the widgets not placed yet, on Home a child's widget once per child. */
  const paletteEntries = useMemo((): PaletteEntry[] => {
    const placed = new Set(items.map((i) => placedKey(i.widget, surface === "home" ? personOf(i) : undefined)));
    const ids = new Set(items.map((i) => i.id));
    const entries: PaletteEntry[] =
      surface === "screensaver"
        ? WIDGET_KEYS.map((widget) => ({ id: widget, widget, label: names[widget] }))
        : HOME_KEYS.flatMap((widget): PaletteEntry[] => {
            const base = homeNames[widget];
            if (!HOME_WIDGETS[widget].perChild || children.length === 0) return [{ id: widget, widget, label: base }];
            return [
              { id: widget, widget, label: t("homeWidgetForEveryone", { widget: base }) },
              ...children.map((c) => ({
                id: `${widget}:${c.id}`,
                widget,
                label: t("homeWidgetForChild", { widget: base, name: c.name }),
                options: { personId: c.id },
              })),
            ];
          });
    return entries
      .filter((e) => !placed.has(placedKey(e.widget, personOf(e))))
      .map((e) => {
        // An id already taken by another box (a layout saved with other ids) gets a suffix.
        let id = e.id;
        for (let n = 2; ids.has(id); n++) id = `${e.id}-${n}`;
        return { ...e, id };
      });
  }, [items, surface, names, homeNames, children, t]);

  // A draft made on the copy just loaded comes back as the present (one undo
  // returns to the saved copy); one made on an older copy is dropped.
  useEffect(() => {
    if (!draft) return;
    if (draft.restorable) {
      setSaverItems(knownWidgetItems(draft.items));
      if (draft.home) setHomeItems(knownWidgetItems(draft.home, "home"));
    } else writeDraft(layout.id, null);
  }, [draft, layout.id, setSaverItems, setHomeItems]);

  const homeDirty = homeHistory.dirty;
  useEffect(() => {
    writeDraft(layout.id, dirty ? { items: saverItems, ...(homeDirty ? { home: homeItems } : {}), stamp } : null);
  }, [layout.id, dirty, saverItems, homeDirty, homeItems, stamp]);

  const commit = useCallback(
    (next: Item[]) => {
      setError(null);
      setRefused(null);
      set(next);
    },
    [set],
  );

  /** A command's result: applied, or nothing changes and the toolbar says why. */
  const apply = useCallback(
    (result: ArrangeResult<Item>) => {
      if (result.ok) commit(result.items);
      else setRefused({ reason: result.reason, at: Date.now() });
    },
    [commit],
  );

  // An undo or redo that changes something also takes away the line on a refused command.
  const undo = useCallback(() => {
    if (!canUndo) return;
    undoHistory();
    setRefused(null);
  }, [canUndo, undoHistory]);
  const redo = useCallback(() => {
    if (!canRedo) return;
    redoHistory();
    setRefused(null);
  }, [canRedo, redoHistory]);

  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(null), REFUSED_MS);
    return () => window.clearTimeout(timer);
  }, [refused]);

  /** Removes every selected box, as one change. */
  const remove = useCallback(() => {
    if (selection.length === 0) return;
    commit(items.filter((i) => !selection.includes(i.id)));
    setSelectedIds([]);
  }, [commit, items, selection]);

  /** Align, distribute or same size on the selection, in the order it was selected: one change, or refused with the reason. */
  const arrange = (command: ArrangeCommand) => {
    if (!ownGrid || selection.length < 2) return;
    const rows = ownGrid.rows;
    if (command.kind === "align") apply(alignItems(items, selection, command.edge, rows, on));
    else if (command.kind === "distribute") apply(distribute(items, selection, command.axis, rows, on));
    else apply(matchSize(items, selection, command.dim, rows, on));
  };

  /** The selected box put at the numbers typed into the inspector: one change, or the reason it was not done (shown by the fields). */
  const placeBox = (box: Box): ArrangeReason | null => {
    if (!ownGrid || !selected) return null;
    const result = setBox(items, selected.id, box, ownGrid.rows, on);
    if (!result.ok) return result.reason;
    commit(result.items);
    return null;
  };

  /**
   * Home's "Fit": every box under its minimum for this layout's area grown
   * to it, what is below moved down and steps taken back from boxes with
   * room to spare (fitItems, home-fit.ts); one change. False when it cannot.
   */
  const fitHome = (): boolean => {
    if (surface !== "home") return false;
    const fitted = fitItems(homeItems, homeSize, homeSize, "home");
    if (fitted.dropped.length > 0) return false;
    const checked = validateItems(fitted.items, homeSize.width, homeSize.height, "home");
    if (!checked.ok) return false;
    commit(fitted.items);
    return true;
  };

  const setText = (text: TextSize) => {
    if (selected) commit(items.map((i) => (i.id === selected.id ? { ...i, text } : i)));
  };

  const setAlign = (align: Align | null) => {
    if (selected) commit(items.map((i) => (i.id === selected.id ? (withAlign(i as LayoutItem, align) as Item) : i)));
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
      if (!editable || !ownGrid || selection.length === 0 || mod) return;
      if ((e.key === "Delete" || e.key === "Backspace") && !e.altKey) {
        e.preventDefault();
        remove();
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds([]);
        return;
      }
      const dir = ARROWS[e.key];
      if (!dir || target?.closest(OWN_ARROWS)) return;
      e.preventDefault();
      // A step, or with Shift a whole cell; Alt resizes instead of moving.
      const n = e.shiftKey ? GRID.STEPS_PER_CELL : 1;
      apply((e.altKey ? resizeBy : moveBy)(items, selection, dir[0] * n, dir[1] * n, ownGrid.rows, on));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, selection, items, ownGrid, undo, redo, remove, apply, on]);

  /** Shows the other face; the selection and a refused command's line belong to the face they were on. */
  const switchSurface = (next: Surface) => {
    if (next === surface) return;
    setSelectedIds([]);
    setRefused(null);
    setSurface(next);
  };

  /**
   * Saves both faces' unsaved changes in one request (a face without changes
   * is not sent); true when they were saved. A face the check refuses is
   * brought on screen with the reason.
   */
  const save = async (): Promise<boolean> => {
    setError(null);
    const sendSaver = saverHistory.dirty;
    const sendHome = homeHistory.dirty;
    const sentSaver = saverItems;
    const sentHome = homeItems;
    const refuse = (on: Surface, error: LayoutError, itemId?: string) => {
      const list: Item[] = on === "home" ? sentHome : sentSaver;
      const item = list.find((i) => i.id === itemId);
      if (on !== surface) switchSurface(on);
      setError(t(`errors.${error}`, { name: item ? labelFor(on, item) : (itemId ?? "") }));
      return false;
    };
    if (sendSaver) {
      const checked = validateItems(sentSaver, layout.width, layout.height);
      if (!checked.ok) return refuse("screensaver", checked.error, checked.itemId);
    }
    if (sendHome) {
      const checked = validateItems(sentHome, homeSize.width, homeSize.height, "home");
      if (!checked.ok) return refuse("home", checked.error, checked.itemId);
    }
    try {
      const saved = await saveLayout.mutateAsync({
        id: layout.id,
        ...(sendSaver ? { screensaver: sentSaver } : {}),
        ...(sendHome ? { home: sentHome } : {}),
        updated_at: stamp,
      });
      setStamp(saved.updated_at);
      if (sendSaver) setBaseline(sentSaver);
      if (sendHome) {
        setHomeBaseline(sentHome);
        setHomeDesigned(sentHome.length > 0);
      }
      setNotice(null);
      toast.success(t("saved"));
      return true;
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "stale") setStale(true);
      else if (err instanceof LayoutRequestError && err.code === "grid_changed") {
        setGridChanged(true);
        setStale(true);
      }
      // The PIN screen comes back by itself (relockSettings).
      else if (err instanceof LayoutRequestError && err.code === "pin_required") toast.error(t("errors.pinRequired"));
      else if (err instanceof LayoutRequestError && LAYOUT_ERRORS.includes(err.code)) setError(t(`errors.${err.code as LayoutError}`, { name: nameOf(err.itemId) }));
      else toast.error(t("errors.generic"));
      return false;
    }
  };

  const reload = async () => {
    if (gridChanged) {
      // Only new code helps. The draft stays: its key names this grid, so the
      // new code never reads it as its own, and if the leave prompt is
      // cancelled the editor and its changes are still here as they were.
      window.location.reload();
      return;
    }
    setReloading(true);
    try {
      writeDraft(layout.id, null);
      await onReload();
    } finally {
      setReloading(false);
    }
  };

  const surfaceSwitch = (
    <SegmentedControl
      value={surface}
      onValueChange={(v) => v && switchSurface(v as Surface)}
      aria-label={t("surface.label")}
      data-testid="editor-surface"
      className="w-auto"
    >
      {SURFACES.map((s) => (
        <SegmentedControlItem key={s} value={s} className="gap-2 px-3" data-testid={`editor-surface-${s}`}>
          {s === "home" ? <Home className="size-4" aria-hidden="true" /> : <MonitorPlay className="size-4" aria-hidden="true" />}
          {t(`surface.${s}`)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );

  if (!ownGrid) {
    const tooSmall = <p className="text-sm text-destructive">{t("tooSmall", { width: area.width, height: area.height })}</p>;
    // The screen itself has no grid: neither face can be edited.
    if (!gridFor(layout.width, layout.height)) return tooSmall;
    return (
      <div className="flex flex-col gap-4" data-testid="layout-editor" data-surface={surface} data-dirty={dirty}>
        {surfaceSwitch}
        {tooSmall}
      </div>
    );
  }

  const copyDroppedSaver = copyDropped.filter((w) => !w.startsWith("home:"));
  const copyDroppedHome = copyDropped.flatMap((w) => {
    if (!w.startsWith("home:")) return [];
    const [widget, personId] = w.slice("home:".length).split(":");
    return [labelFor("home", personId ? { widget, options: { personId } } : { widget })];
  });

  return (
    <div className="flex flex-col gap-4" data-testid="layout-editor" data-surface={surface} data-dirty={dirty}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* In the toolbar's row, not a row of its own: the canvas keeps the height it had. */}
          {surfaceSwitch}
          <ScreenPicker own={ownSize} value={preview} onChange={setPreview} />
          {(preview.width !== layout.width || preview.height !== layout.height) && (
            <CopyForSize
              layout={layout}
              size={preview}
              dirty={dirty}
              items={saverItems}
              homeItems={homeItems}
              onSave={save}
              onDiscard={() => writeDraft(layout.id, null)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Always there and in the accessibility tree (sr-only while empty, never display none), so screen readers announce the line when it comes. */}
          <span role="status" aria-live="polite" data-testid="editor-refused-status" className="text-sm text-destructive empty:sr-only">
            {refused && (
              <span data-testid="editor-refused" data-reason={refused.reason}>
                {t(`refused.${refused.reason}`)}
              </span>
            )}
          </span>
          <Select value={gridDisplay} onValueChange={(v) => setGridDisplay(v as GridDisplay)}>
            <SelectTrigger className="h-8 w-auto gap-2" data-testid="editor-grid-display" aria-label={t("gridDisplay.label")} title={t("gridDisplay.label")}>
              <Grid3x3 className="size-4" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRID_DISPLAYS.map((d) => (
                <SelectItem key={d} value={d} data-testid={`editor-grid-display-${d}`}>
                  {t(`gridDisplay.${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The arrangement as it is now, saved or not, as this screen's screensaver until the next touch (#282). */}
          {surface === "screensaver" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => previewScreensaver({ width: layout.width, height: layout.height, items: saverItems })}
              data-testid="editor-preview-screensaver"
              title={t("previewScreensaverHint")}
            >
              <MonitorPlay className="size-4" aria-hidden="true" />
              {t("previewScreensaver")}
            </Button>
          )}
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
                <AlertDialogDescription>{t(surface === "home" ? "resetDescriptionHome" : "resetDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("resetCancel")}</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="editor-reset-confirm"
                  onClick={() => {
                    setSelectedIds([]);
                    commit(surface === "home" ? builtInHome(homeSize.width, homeSize.height) : builtInScreensaver(layout.width, layout.height));
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
        <div role="status" data-testid="editor-copy-dropped" className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {copyDroppedSaver.length > 0 && <span>{t("copy.dropped", { names: listNames(copyDroppedSaver.map((w) => (w in names ? names[w as SaverWidgetKey] : w))) })}</span>}
          {copyDroppedHome.length > 0 && <span data-testid="editor-copy-dropped-home">{t("copy.droppedHome", { names: listNames(copyDroppedHome) })}</span>}
        </div>
      )}
      {surface === "home" && !homeDesigned && !homeHistory.dirty && (
        <div role="note" data-testid="editor-home-builtin" className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("homeBuiltIn")}
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
          <span className="flex-1">{gridChanged ? t("errors.gridChanged") : t("stale")}</span>
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
            {t("preview.readOnly", { rows: previewGrid!.cellRows, layoutRows: ownGrid.cellRows })}
          </span>
          {shown.dropped.length > 0 && (
            <span data-testid="preview-dropped" className="text-amber-700 dark:text-amber-400">
              {t("preview.dropped", { names: listNames(shown.dropped.map((id) => nameOf(id))) })}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:items-start">
        <EditorPalette
          key={surface}
          surface={on}
          entries={paletteEntries}
          items={items}
          rows={ownGrid.rows}
          disabled={!editable}
          onAdd={(item) => {
            commit([...items, item]);
            setSelectedIds([item.id]);
          }}
        />
        {/* Both providers, whichever face is shown: a widget reads only its own. */}
        <ScreensaverDataProvider value={data}>
          <HomeDataProvider value={homeData}>
            <EditorCanvas
              key={surface}
              surface={surface}
              grid={previewGrid!}
              items={shown.items}
              editable={editable}
              display={gridDisplay}
              selectedIds={selection}
              label={label}
              onSelect={setSelectedIds}
              onCommit={commit}
            />
          </HomeDataProvider>
        </ScreensaverDataProvider>
        <EditorInspector
          surface={on}
          item={selected}
          count={selection.length}
          disabled={!editable}
          label={label}
          onText={setText}
          onAlign={setAlign}
          onRemove={remove}
          onArrange={arrange}
          onBox={placeBox}
          onFit={surface === "home" ? fitHome : undefined}
        />
      </div>
    </div>
  );
}

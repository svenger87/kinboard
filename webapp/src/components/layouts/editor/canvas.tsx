"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import ReactGridLayout, { type Layout as GridLayout } from "react-grid-layout";
import { getCompactor, setTransform, type PositionStrategy } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import { GRID, boxRect, textPx, type Grid } from "@/lib/layouts/grid";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import type { LayoutItem, SaverWidgetKey } from "@/lib/layouts/types";
import { SAVER_WIDGET_COMPONENTS } from "@/components/layouts/saver-widgets";
import { GridOverlay, type GridDisplay } from "./grid-overlay";

/** No compaction, and a move or resize onto another widget is refused rather than pushing it. */
const COMPACTOR = getCompactor(null, false, true);
/** A frame smaller than this many screen pixels is a click on the empty canvas. */
const FRAME_MIN_PX = 4;
/**
 * The resize corner's size on screen, whatever the canvas scale: at most
 * HANDLE_PX, else a third of the box's shorter side as drawn, so a small box
 * keeps a middle to grab and move it by; not under HANDLE_MIN_PX, to stay
 * something a pointer can hit, but never over 40% of that side, which would
 * reach the middle (a 4x4 box draws 16px on a laptop-sized canvas).
 */
const HANDLE_PX = 22;
const HANDLE_MIN_PX = 6;

/** The resize corner of a box drawn `width` x `height` screen pixels, in screen pixels. */
function handlePx(width: number, height: number): number {
  const side = Math.min(width, height);
  return Math.min(HANDLE_PX, Math.max(HANDLE_MIN_PX, side / 3), side * 0.4);
}
/** Room kept under the canvas, above the navigation bar, so it fits the window without scrolling. */
const BOTTOM_ROOM = 16;
/**
 * Each grid item spans whole steps, a box plus half a gap on every side, so
 * columns are exactly a step wide with no margin; the box is drawn inset by
 * half a gap, which leaves a full gap between neighbours.
 */
const INSET = GRID.GAP / 2;

/**
 * The library's own scaled strategy (createScaledStrategy) places a dragged
 * widget from its position in the window, not in the grid, so on a canvas
 * that is not at the window's top left a drag lands rows off. Without
 * calcDragPosition the grid item measures against its offset parent and
 * divides by `scale`, which is right.
 */
function scaledStrategy(scale: number): PositionStrategy {
  return { type: "transform", scale, calcStyle: setTransform };
}

/** The canvas scale that fits a screen into the space beside the palette and above the window's bottom. */
function useFitScale(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const nav = navRef.current?.offsetHeight ?? 0;
      const availW = el.clientWidth;
      const availH = Math.max(320, window.innerHeight - top - nav - BOTTOM_ROOM);
      setScale(Math.min(1, availW / width, availH / height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width, height]);
  return { ref, navRef, scale };
}

/** A rectangle in the screen's own pixels. */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const intersects = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * The target screen at its own CSS size, scaled down to fit, with the
 * layout's widgets drawn by the real screensaver components on the grid,
 * over the grid itself (dots, lines or nothing; `display`). Editable: drag
 * to move, the corner to resize, both in whole steps and never onto another
 * widget or below the widget's minimum. Not editable: a preview, nothing moves.
 *
 * Selecting: a click picks one box, Shift+click adds or takes one away, and
 * a frame dragged from the empty canvas selects the boxes it touches (with
 * Shift, adds them). A drag moves only the box under the pointer; one that
 * is part of a selection keeps the selection.
 */
export function EditorCanvas({
  grid,
  items,
  editable,
  display,
  selectedIds,
  names,
  onSelect,
  onCommit,
}: {
  grid: Grid;
  items: LayoutItem[];
  editable: boolean;
  display: GridDisplay;
  selectedIds: string[];
  names: Record<SaverWidgetKey, string>;
  onSelect: (ids: string[]) => void;
  onCommit: (items: LayoutItem[]) => void;
}) {
  const { ref, navRef, scale } = useFitScale(grid.width, grid.height);
  const strategy = useMemo(() => scaledStrategy(scale || 1), [scale]);

  const layout = useMemo<GridLayout>(
    () =>
      items.map((i) => ({
        i: i.id,
        x: i.x,
        y: i.y,
        w: i.w,
        h: i.h,
        minW: SAVER_WIDGETS[i.widget].min.w,
        minH: SAVER_WIDGETS[i.widget].min.h,
      })),
    [items],
  );

  const commit = useCallback(
    (next: GridLayout) => {
      const byId = new Map(next.map((l) => [l.i, l]));
      onCommit(
        items.map((i) => {
          const l = byId.get(i.id);
          return l && (l.x !== i.x || l.y !== i.y || l.w !== i.w || l.h !== i.h) ? { ...i, x: l.x, y: l.y, w: l.w, h: l.h } : i;
        }),
      );
    },
    [items, onCommit],
  );

  // A box pressed with Shift, or while part of a selection of several: the
  // selection stays for a drag, and on a click that did not move Shift adds
  // or takes the box away, a plain click makes it the only one selected.
  const pressed = useRef<{ id: string; x: number; y: number; shift: boolean } | null>(null);
  // Focus that follows a press is the press's; only focus from the keyboard selects.
  const pointerFocus = useRef(false);
  // The frame being dragged, in the screen's own pixels; null when none.
  const [frame, setFrame] = useState<Rect | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  const pressBox = (e: ReactMouseEvent, id: string) => {
    if (!editable || e.button !== 0) return;
    pointerFocus.current = true;
    window.setTimeout(() => (pointerFocus.current = false));
    pressed.current = null;
    if (e.shiftKey || (selectedIds.includes(id) && selectedIds.length > 1)) pressed.current = { id, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    else onSelect([id]);
  };

  const clickBox = (e: ReactMouseEvent, id: string) => {
    const p = pressed.current;
    pressed.current = null;
    if (!p || p.id !== id || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= FRAME_MIN_PX) return;
    if (!p.shift) onSelect([id]);
    else onSelect(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  };

  /** A press on the empty canvas: a frame, or on letting go without one, a click that clears the selection. */
  const pressCanvas = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-editor-item]")) return;
    if (!editable || e.button !== 0 || !screenRef.current) {
      onSelect([]);
      return;
    }
    e.preventDefault();
    const origin = screenRef.current.getBoundingClientRect();
    const k = scale || 1;
    const start = { x: e.clientX, y: e.clientY };
    const add = e.shiftKey;
    const base = selectedIds;
    const rectTo = (x: number, y: number): Rect => ({
      left: (Math.min(start.x, x) - origin.left) / k,
      top: (Math.min(start.y, y) - origin.top) / k,
      width: Math.abs(x - start.x) / k,
      height: Math.abs(y - start.y) / k,
    });
    const big = (x: number, y: number) => Math.abs(x - start.x) >= FRAME_MIN_PX || Math.abs(y - start.y) >= FRAME_MIN_PX;
    const move = (ev: MouseEvent) => setFrame(big(ev.clientX, ev.clientY) ? rectTo(ev.clientX, ev.clientY) : null);
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", stop);
      setFrame(null);
    };
    // The window losing focus (another app, a dialog) drops the frame: its mouseup may never come here.
    const up = (ev: MouseEvent) => {
      stop();
      if (!big(ev.clientX, ev.clientY)) {
        if (!add) onSelect([]);
        return;
      }
      const r = rectTo(ev.clientX, ev.clientY);
      const hits = items.filter((i) => intersects(r, boxRect(i, grid))).map((i) => i.id);
      onSelect(add ? [...base, ...hits.filter((id) => !base.includes(id))] : hits);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", stop);
  };

  // Each item sets --kb-handle (its corner's size, in the screen's own pixels); the corner reads it.
  const zoom = scale || 1;
  const fontSize = (i: LayoutItem) => textPx(i.text, grid.width, grid.height);

  return (
    <div ref={ref} className="relative w-full min-w-0">
      {/* The navigation bar's height, which the canvas stays above. */}
      <div ref={navRef} aria-hidden="true" className="invisible absolute left-0 top-0 w-px" style={{ height: "var(--nav-spacing)" }} />
      {scale > 0 && (
        <div
          data-testid="editor-canvas"
          data-editor-canvas
          data-scale={scale}
          data-width={grid.width}
          data-height={grid.height}
          className="relative mx-auto overflow-hidden rounded-xl elev-lg ring-1 ring-border"
          style={{ width: grid.width * scale, height: grid.height * scale }}
        >
          <div
            ref={screenRef}
            className="kb-editor-screen absolute left-0 top-0 text-white"
            style={{
              width: grid.width,
              height: grid.height,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              background: "linear-gradient(160deg, #23272f 0%, #12151a 100%)",
            }}
            onMouseDown={pressCanvas}
          >
            <style>{`
              .kb-editor-screen .react-grid-item.react-grid-placeholder { background: hsl(var(--primary)); background-clip: content-box; padding: ${INSET}px; opacity: 0.35; border-radius: ${12 + INSET}px; }
              .kb-editor-screen .react-grid-item > .react-resizable-handle::after { display: none; }
              .kb-editor-screen .react-grid-item > .react-resizable-handle { opacity: 0; }
              .kb-editor-screen .react-grid-item:hover > .react-resizable-handle,
              .kb-editor-screen .react-grid-item[data-selected="true"] > .react-resizable-handle { opacity: 1; }
            `}</style>
            <GridOverlay grid={grid} display={display} scale={scale} />
            <ReactGridLayout
              width={grid.width}
              layout={layout}
              gridConfig={{
                cols: grid.columns,
                rowHeight: grid.step,
                margin: [0, 0],
                containerPadding: [grid.offsetX - INSET, grid.offsetY - INSET],
                maxRows: grid.rows,
              }}
              compactor={COMPACTOR}
              positionStrategy={strategy}
              autoSize={false}
              style={{ height: grid.height }}
              dragConfig={{ enabled: editable, bounded: true }}
              resizeConfig={{
                enabled: editable,
                handles: ["se"],
                handleComponent: (axis, handleRef) => (
                  <span
                    ref={handleRef as Ref<HTMLSpanElement>}
                    className={`react-resizable-handle react-resizable-handle-${axis} pointer-events-auto absolute cursor-se-resize`}
                    style={{ width: "var(--kb-handle)", height: "var(--kb-handle)", right: INSET, bottom: INSET }}
                  >
                    <span
                      className="absolute rounded-br-md border-b-white border-r-white"
                      style={{ right: "20%", bottom: "20%", width: "50%", height: "50%", borderRightWidth: "var(--kb-handle-line)", borderBottomWidth: "var(--kb-handle-line)", borderStyle: "solid", borderLeftWidth: 0, borderTopWidth: 0 }}
                    />
                  </span>
                ),
              }}
              onDragStop={commit}
              onResizeStop={commit}
            >
              {items.map((item) => {
                const Widget = SAVER_WIDGET_COMPONENTS[item.widget];
                const rect = boxRect(item, grid);
                const box = { width: Math.round(rect.width), height: Math.round(rect.height) };
                const selected = selectedIds.includes(item.id);
                const handle = handlePx(rect.width * zoom, rect.height * zoom);
                return (
                  <div
                    key={item.id}
                    data-editor-item={item.widget}
                    data-box={`${item.x},${item.y},${item.w},${item.h}`}
                    data-text={item.text}
                    data-selected={selected}
                    role="button"
                    tabIndex={editable ? 0 : -1}
                    aria-label={names[item.widget]}
                    aria-pressed={selected}
                    onFocus={() => {
                      if (editable && !pointerFocus.current && !selectedIds.includes(item.id)) onSelect([item.id]);
                    }}
                    className="pointer-events-none outline-none"
                    style={{
                      fontSize: fontSize(item),
                      ["--kb-handle" as string]: `${handle / zoom}px`,
                      // The corner's mark: 3px on screen, thinner on a small corner.
                      ["--kb-handle-line" as string]: `${Math.min(3, handle / 7) / zoom}px`,
                    }}
                  >
                    {/* The box as drawn: the item less half a gap all round. Only it takes the pointer, so the gap between two boxes grabs neither. */}
                    <div
                      data-editor-box
                      // Here, not on the item: the library's drag handler replaces the item's own onMouseDown.
                      onMouseDown={(e) => pressBox(e, item.id)}
                      onClick={(e) => clickBox(e, item.id)}
                      className={`pointer-events-auto absolute rounded-xl ${editable ? "cursor-grab active:cursor-grabbing" : ""}`}
                      style={{
                        inset: INSET,
                        boxShadow: selected
                          ? `0 0 0 ${3 / (scale || 1)}px hsl(var(--primary))`
                          : editable
                            ? `0 0 0 ${1 / (scale || 1)}px rgba(255,255,255,0.25)`
                            : undefined,
                      }}
                    >
                      <div className="pointer-events-none size-full overflow-hidden">
                        <Widget item={item} box={box} editing />
                      </div>
                    </div>
                  </div>
                );
              })}
            </ReactGridLayout>
            {frame && (
              <div
                data-testid="editor-frame"
                aria-hidden="true"
                className="pointer-events-none absolute z-20 rounded-sm"
                style={{
                  ...frame,
                  border: `${1 / (scale || 1)}px solid hsl(var(--primary))`,
                  background: "hsl(var(--primary) / 0.15)",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

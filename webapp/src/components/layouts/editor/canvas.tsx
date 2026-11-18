"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import ReactGridLayout, { type Layout as GridLayout } from "react-grid-layout";
import { getCompactor, setTransform, type PositionStrategy } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import { boxRect, textPx, type Grid } from "@/lib/layouts/grid";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import type { LayoutItem, SaverWidgetKey } from "@/lib/layouts/types";
import { SAVER_WIDGET_COMPONENTS } from "@/components/layouts/saver-widgets";

/** No compaction, and a move or resize onto another widget is refused rather than pushing it. */
const COMPACTOR = getCompactor(null, false, true);
/** The resize corner's size on screen, whatever the canvas scale. */
const HANDLE_PX = 22;
/** Room kept under the canvas, above the navigation bar, so it fits the window without scrolling. */
const BOTTOM_ROOM = 16;

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

/**
 * The target screen at its own CSS size, scaled down to fit, with the
 * layout's widgets drawn by the real screensaver components on the grid.
 * Editable: drag to move, the corner to resize, both in whole cells and
 * never onto another widget or below the widget's minimum; the cells show
 * while a widget is moving. Not editable: a preview, nothing moves.
 */
export function EditorCanvas({
  grid,
  items,
  editable,
  selectedId,
  names,
  onSelect,
  onCommit,
}: {
  grid: Grid;
  items: LayoutItem[];
  editable: boolean;
  selectedId: string | null;
  names: Record<SaverWidgetKey, string>;
  onSelect: (id: string | null) => void;
  onCommit: (items: LayoutItem[]) => void;
}) {
  const { ref, navRef, scale } = useFitScale(grid.width, grid.height);
  const [moving, setMoving] = useState(false);
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
      setMoving(false);
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

  const cells = useMemo(() => {
    if (!moving) return null;
    const out = [];
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.columns; x++) {
        const r = boxRect({ x, y, w: 1, h: 1 }, grid);
        out.push(
          <div
            key={`${x}-${y}`}
            className="absolute rounded-md border border-dashed border-white/20 bg-white/[0.03]"
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />,
        );
      }
    }
    return out;
  }, [moving, grid]);

  const handleSize = HANDLE_PX / (scale || 1);
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
            className="kb-editor-screen absolute left-0 top-0 text-white"
            style={{
              width: grid.width,
              height: grid.height,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
              background: "linear-gradient(160deg, #23272f 0%, #12151a 100%)",
            }}
            onMouseDown={(e: ReactMouseEvent) => {
              if (!(e.target as HTMLElement).closest("[data-editor-item]")) onSelect(null);
            }}
          >
            <style>{`
              .kb-editor-screen .react-grid-item.react-grid-placeholder { background: hsl(var(--primary)); opacity: 0.35; border-radius: 12px; }
              .kb-editor-screen .react-grid-item > .react-resizable-handle::after { display: none; }
              .kb-editor-screen .react-grid-item > .react-resizable-handle { opacity: 0; }
              .kb-editor-screen .react-grid-item:hover > .react-resizable-handle,
              .kb-editor-screen .react-grid-item[data-selected="true"] > .react-resizable-handle { opacity: 1; }
            `}</style>
            {cells}
            <ReactGridLayout
              width={grid.width}
              layout={layout}
              gridConfig={{
                cols: grid.columns,
                rowHeight: grid.cell,
                margin: [24, 24],
                containerPadding: [grid.offsetX, grid.offsetY],
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
                    className={`react-resizable-handle react-resizable-handle-${axis} absolute bottom-0 right-0 cursor-se-resize`}
                    style={{ width: handleSize, height: handleSize }}
                  >
                    <span
                      className="absolute rounded-br-md border-b-white border-r-white"
                      style={{ right: handleSize * 0.2, bottom: handleSize * 0.2, width: handleSize * 0.5, height: handleSize * 0.5, borderRightWidth: 3 / (scale || 1), borderBottomWidth: 3 / (scale || 1), borderStyle: "solid", borderLeftWidth: 0, borderTopWidth: 0 }}
                    />
                  </span>
                ),
              }}
              onDragStart={() => setMoving(true)}
              onResizeStart={() => setMoving(true)}
              onDragStop={commit}
              onResizeStop={commit}
            >
              {items.map((item) => {
                const Widget = SAVER_WIDGET_COMPONENTS[item.widget];
                const box = { width: item.w * grid.cell + (item.w - 1) * 24, height: item.h * grid.cell + (item.h - 1) * 24 };
                const selected = item.id === selectedId;
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
                    onMouseDown={() => editable && onSelect(item.id)}
                    onFocus={() => editable && onSelect(item.id)}
                    className={`rounded-xl outline-none ${editable ? "cursor-grab active:cursor-grabbing" : ""}`}
                    style={{
                      fontSize: fontSize(item),
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
                );
              })}
            </ReactGridLayout>
          </div>
        </div>
      )}
    </div>
  );
}

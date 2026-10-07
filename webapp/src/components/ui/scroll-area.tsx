"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    /**
     * Hold the content to the area's width, for lists that only ever scroll
     * vertically.
     *
     * Radix wraps the content in `<div style="display: table; min-width:
     * 100%">` so a horizontal strip can be wider than its viewport. That
     * wrapper sizes itself to its content's widest unbreakable line, so in a
     * vertical list one long name (or any `truncate`/`nowrap` text) widens the
     * whole list past the screen instead of wrapping or truncating — and the
     * ancestor's overflow-hidden clips it, so nothing scrolls and the page's
     * scrollWidth looks fine. The shopping list ran ~300px off a phone this
     * way, counters and all.
     */
    fitWidth?: boolean
  }
>(({ className, children, fitWidth = false, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    {/* overscroll-contain stops a swipe that reaches the end of a horizontal
        strip from chaining into whatever scrolls behind it — on the weather
        modal that was the dialog's own vertical scroll, so a sideways flick
        through the hourly forecast also dragged the modal body. */}
    <ScrollAreaPrimitive.Viewport
      className={cn(
        "h-full w-full rounded-[inherit] overscroll-contain",
        fitWidth && "[&>div]:!block"
      )}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }

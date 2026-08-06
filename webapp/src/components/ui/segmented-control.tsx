"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "@/lib/utils"

/**
 * A single-select control that switches what is shown elsewhere on the page:
 * pick a vehicle, a ticker, a period, month-or-week.
 *
 * These were all built with Radix Tabs, which is the wrong pattern for them.
 * The ARIA tab role is a promise that the tab owns a tabpanel, and Radix keeps
 * that promise by emitting `aria-controls="…-content-<value>"` on every
 * trigger. None of these call sites render a TabsContent — the content lives
 * elsewhere in the page — so every trigger pointed at an element that does not
 * exist, and a screen reader following the reference landed nowhere (audit
 * KB-43, 6 nodes across /calendar, /energy, /stonks, /vehicles).
 *
 * A group of toggle buttons is what these actually are, so that is what this
 * renders. Radix's ToggleGroup gives the same roving focus and arrow-key
 * movement, exposes state as `aria-pressed`, and makes no claim about a panel.
 * The styling is copied verbatim from ui/tabs.tsx so the swap is invisible.
 */

const SegmentedControl = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  Omit<
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>,
    "type" | "onValueChange" | "value" | "defaultValue"
  > & {
    value: string
    defaultValue?: string
    onValueChange?: (value: string) => void
  }
>(({ className, value, onValueChange, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    type="single"
    value={value}
    // ToggleGroup lets you press the active item again to clear the selection.
    // A "which vehicle am I looking at" control has no empty state, so an
    // unset value is dropped rather than passed on.
    onValueChange={(v) => { if (v) onValueChange?.(v) }}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
SegmentedControl.displayName = "SegmentedControl"

const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:elev-sm",
      className
    )}
    {...props}
  />
))
SegmentedControlItem.displayName = "SegmentedControlItem"

export { SegmentedControl, SegmentedControlItem }

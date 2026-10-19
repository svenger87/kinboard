"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FABProps {
  icon: LucideIcon;
  onClick: () => void;
  ariaLabel: string;
  className?: string;
}

/**
 * The phone's add button, fixed above the navigation. It floats over whatever
 * scrolls beneath it, so it also leaves room for itself at the end of the page
 * (the button and the gap above the nav): scrolled to the end, the last row
 * sits above it rather than under it. `className` is for when it shows
 * ("sm:hidden"), and the room follows it.
 */
export function FAB({ icon: Icon, onClick, ariaLabel, className }: FABProps) {
  return (
    <>
      <div aria-hidden="true" data-fab-room="" className={cn("pointer-events-none h-[4.5rem] shrink-0", className)} />
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          "fab-above-nav fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground elev-lg transition-transform [transition-duration:120ms] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className
        )}
      >
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </>
  );
}

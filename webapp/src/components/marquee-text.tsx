"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface MarqueeTextProps {
  text: string;
  className?: string;
}

/**
 * Single-line text that gently scrolls (marquee) ONLY when it overflows its
 * container, then alternates back — so the full title stays readable without
 * truncation. Non-overflowing text is static. Disabled under
 * `prefers-reduced-motion` (clips to the start). The animation runs only on
 * the specific overflowing instances, keeping kiosk repaint cost minimal.
 */
export function MarqueeText({ text, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const measure = () => {
      const c = containerRef.current;
      const t = textRef.current;
      if (!c || !t) return;
      const diff = t.scrollWidth - c.clientWidth;
      setShift(diff > 4 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (textRef.current) ro.observe(textRef.current);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span
      ref={containerRef}
      className={cn("relative block overflow-hidden whitespace-nowrap", className)}
    >
      <span
        ref={textRef}
        className={cn("inline-block align-top", shift > 0 && "marquee-scroll")}
        style={
          shift > 0
            ? ({
                "--marquee-shift": `-${shift}px`,
                // ~30px/s travel, min 5s, so longer titles scroll proportionally
                animationDuration: `${Math.max(5, Math.round(shift / 30) + 3)}s`,
              } as CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}

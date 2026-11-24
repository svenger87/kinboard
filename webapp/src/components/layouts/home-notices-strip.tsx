"use client";

import { useEffect, useRef, useState } from "react";
import { AttentionWidget } from "@/components/widgets/attention-widget";
import { ConnectivityBanner } from "@/components/connectivity-banner";
import { MessageTakeover } from "@/components/message-takeover";

/**
 * The notices of a designed Home that are not widgets (RFC-022 §3.4): "needs
 * attention", "server unreachable" and a message sent to this screen. They
 * come and go and vary in height, so they do not get a box: they slide in as
 * a strip over the top of the layout and leave when done, and the layout
 * never moves.
 *
 * Only notices that leave by themselves belong here. Today's Home also shows
 * two standing offers, the getting-started checklist and the shopping app's
 * install prompt; they stay until someone dismisses them, so over a layout
 * they would cover its top (the clock) for good. A designed Home is drawn on
 * a kiosk or a screen given a layout, which someone has already set up, so
 * they are left to today's Home and the settings.
 *
 * Each notice renders nothing when it has nothing to say, so the strip is
 * empty (zero high, nothing to tap) on a quiet day. It never takes more than
 * half the screen; a taller stack scrolls inside the strip, not the page.
 */
export function HomeNoticesStrip({ messages }: { messages: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      const has = el.getBoundingClientRect().height > 0;
      cancelAnimationFrame(frame);
      // A frame later, so the strip is laid out above the top before it slides down.
      frame = requestAnimationFrame(() => setShown(has));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      data-testid="home-notices-strip"
      data-shown={shown ? "true" : "false"}
      className="absolute inset-x-0 top-0 z-20 max-h-[50%] overflow-y-auto transition-transform duration-300 ease-out reduce-motion:transition-none"
      style={{ transform: shown ? "translateY(0)" : "translateY(-100%)", pointerEvents: shown ? undefined : "none" }}
    >
      {/* The notices bring the bottom margins they have in today's column; the strip spaces them itself,
          and gives them a ground of their own, since several are tinted see-through cards. */}
      <div ref={inner} className="flex flex-col gap-3 bg-background px-4 py-4 elev-md md:px-6 lg:px-8 [&>*]:!mb-0 empty:hidden">
        <ConnectivityBanner />
        <AttentionWidget />
        {messages && <MessageTakeover />}
      </div>
    </div>
  );
}

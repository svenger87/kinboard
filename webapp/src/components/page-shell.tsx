"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isNoNavPath } from "@/lib/constants";
import { RouteTransition } from "@/components/route-transition";

export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasNav = !isNoNavPath(pathname);

  return (
    <div style={hasNav ? { paddingBottom: "var(--nav-spacing)" } : undefined}>
      <RouteTransition>{children}</RouteTransition>
    </div>
  );
}

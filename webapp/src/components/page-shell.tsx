"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NO_NAV_PATHS } from "@/lib/constants";

export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasNav = !NO_NAV_PATHS.includes(pathname as (typeof NO_NAV_PATHS)[number]);

  return (
    <div style={hasNav ? { paddingBottom: "var(--nav-spacing)" } : undefined}>
      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  /** Lucide icon rendered in the standard tinted container. Ignored if `iconSlot` is provided. */
  icon?: LucideIcon;
  /** Custom visual that replaces the standard icon container entirely (e.g. a progress ring SVG). */
  iconSlot?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  /**
   * Names where `backHref` goes, for assistive tech and the tooltip.
   *
   * Settings sub-pages already carry a labelled "Settings" link in the layout,
   * so the only ones that still render this button are the handful that go up
   * one level instead of all the way out. Two identical unlabelled chevrons
   * pointing at different places is the thing worth avoiding.
   */
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  iconSlot,
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  className = "",
}: PageHeaderProps) {
  const t = useTranslations("components");
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {backHref && (
          <Link href={backHref} title={backLabel}>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={backLabel ?? t("back")}>
              <ChevronLeft className="size-5" />
            </Button>
          </Link>
        )}
        {iconSlot ?? (
          Icon && (
            <div className="p-2.5 rounded-xl bg-month-primary/10 shrink-0">
              <Icon className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
          )
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-light truncate">{title}</h1>
          {subtitle && (
            <div className="text-sm text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">{actions}</div>
      )}
    </motion.div>
  );
}

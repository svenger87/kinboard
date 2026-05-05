"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const LOCALES = [
  { code: "en", label: "EN" },
  { code: "de", label: "DE" },
] as const;

export function LocaleSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function pick(code: string) {
    if (code === current || pending) return;
    setPending(code);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      if (!response.ok) throw new Error("locale change failed");
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background/60 backdrop-blur p-1 text-xs",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => pick(code)}
          disabled={pending !== null}
          className={cn(
            "px-3 py-1 rounded-full transition-colors",
            current === code
              ? "bg-month-primary text-month-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={current === code}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useShortcutsHelp } from "@/hooks";

export function KeyboardShortcutsDialog() {
  const t = useTranslations("components.shortcuts");
  const [open, setOpen] = useState(false);
  const { shortcuts } = useShortcutsHelp();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in input fields
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5 text-month-primary" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 mt-2">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between py-2 px-1 rounded-lg hover:bg-muted/50"
            >
              <span className="text-sm text-muted-foreground">
                {s.description}
              </span>
              <kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted border border-border rounded-md text-muted-foreground">
                {s.keys}
              </kbd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 px-1 rounded-lg hover:bg-muted/50 border-t border-border/50 mt-2 pt-3">
            <span className="text-sm text-muted-foreground">
              {t("showHelp")}
            </span>
            <kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted border border-border rounded-md text-muted-foreground">
              ?
            </kbd>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

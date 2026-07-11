"use client";

import type { ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChangelog, type ChangelogEntry } from "@/hooks/use-changelog";

const REPO_RELEASES_URL = "https://github.com/svenger87/kinboard/releases";

// Strips markdown link syntax [text](url) -> text; everything else is kept literal.
function stripLinks(line: string): string {
  return line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// Minimal markdown-lite renderer for GitHub release bodies: headings, list
// items, and paragraphs. No raw HTML, no markdown dependency.
function renderBody(body: string): ReactNode[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-0.5 text-sm">
        {listItems.map((item, i) => (
          <li key={i}>{stripLinks(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm text-muted-foreground">
        {stripLinks(paragraph.join(" "))}
      </p>
    );
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      flushParagraph();
      blocks.push(
        <h3 key={`h2-${blocks.length}`} className="font-semibold text-base mt-3 first:mt-0">
          {stripLinks(line.slice(3))}
        </h3>,
      );
    } else if (line.startsWith("### ")) {
      flushList();
      flushParagraph();
      blocks.push(
        <h4 key={`h3-${blocks.length}`} className="font-medium text-sm mt-2">
          {stripLinks(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listItems.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushList();
  flushParagraph();

  return blocks;
}

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const t = useTranslations("components.whatsNew");
  const locale = useLocale();
  const { data, isLoading, isError } = useChangelog(open);
  const releases = data?.releases ?? [];
  const unavailable = !isLoading && (isError || releases.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-month-primary" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>
        {unavailable ? (
          <p className="text-sm text-muted-foreground">
            {t("changelogUnavailable")}{" "}
            <a
              href={REPO_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub
            </a>
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-6">
              {releases.map((release: ChangelogEntry) => (
                <div key={release.tag} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-sm">
                      {release.name || release.tag}
                    </span>
                    {release.publishedAt && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(release.publishedAt), "PP", {
                          locale: getDateFnsLocale(locale),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">{renderBody(release.body)}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

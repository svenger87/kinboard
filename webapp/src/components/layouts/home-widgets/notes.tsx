"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Plus, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNotes } from "@/hooks";
import { useNoteActions } from "@/components/widgets/notes-widget";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import type { Note } from "@/types/database";
import { CountBadge, HOME_ROW_BUTTON, HomeEmptyLine, HomeList, TARGET_SQ } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HOME_DIALOG_INPUT, HomeCard } from "./frame";

const keyOf = (n: Note) => n.id;

/**
 * The family's notes, newest first, as many as fit, each with its 48px delete
 * button (which asks first, as the card does). "+" writes a new one in a
 * dialog over the layout. "+n" and the title open /notes.
 */
export function NotesHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("notesWidget");
  const tCommon = useTranslations("common");
  const dateLocale = getDateFnsLocale(useLocale());
  const { data: notes } = useNotes();
  const { createNote, addNote, setDeleteNoteId, deleteDialog } = useNoteActions();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = async () => {
    if (createNote.isPending) return;
    if (await addNote(draft)) {
      setDraft("");
      setAdding(false);
    }
  };

  const renderItem = (note: Note) => (
    <>
      <div className={HOME_ROW_BUTTON}>
        <div className="min-w-0 flex-1 py-[0.3em]">
          {/* At most three lines: a long note is read on /notes. */}
          <p className="line-clamp-3 whitespace-pre-line break-words home-body leading-snug">{note.content}</p>
          <p className="home-meta text-muted-foreground">
            {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: dateLocale })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={TARGET_SQ}
          onClick={() => setDeleteNoteId(note.id)}
          aria-label={t("deleteAria")}
        >
          <Trash2 className="size-[0.9em] text-muted-foreground" />
        </Button>
      </div>
    </>
  );

  const all = notes ?? [];
  return (
    <>
      <HomeCard list
        testId="home-widget-notes"
        icon={StickyNote}
        title={t("title")}
        href="/notes"
        badge={<CountBadge count={all.length} />}
        editing={editing}
        right={
          <Button variant="ghost" size="icon" className={TARGET_SQ} onClick={() => setAdding(true)} aria-label={t("newNoteAria")}>
            <Plus className="size-[1em] text-muted-foreground" />
          </Button>
        }
      >
        <HomeList items={all} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyAction")} />} href="/notes" />
      </HomeCard>
      {deleteDialog}
      <Dialog open={adding} onOpenChange={(open) => { setAdding(open); if (!open) setDraft(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newNoteTooltip")}</DialogTitle>
          </DialogHeader>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t("writePlaceholder")}
            aria-label={t("newNoteInputAria")}
            rows={3}
            className={`min-h-[6rem] w-full resize-none rounded-md border border-input bg-background p-3 ${HOME_DIALOG_INPUT}`}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>{tCommon("cancel")}</Button>
            <Button onClick={() => void submit()} disabled={!draft.trim() || createNote.isPending} aria-label={t("saveAria")}>
              {createNote.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

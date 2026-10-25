"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/person-avatar";
import { doneByOrder } from "@/lib/done-by";
import type { Person } from "@/types/database";

interface DoneByPickerProps {
  /** The task being ticked; null closes the picker. */
  task: { title: string } | null;
  people: Person[];
  /** The assignee, or whose turn it is: offered first. */
  expectedId: string | null;
  onPick: (personId: string) => void;
  onCancel: () => void;
}

/**
 * "Who did it?" for a task worth points (lib/done-by.ts). One tap on a
 * person ticks the task for them; closing the dialog ticks nothing.
 */
export function DoneByPicker({ task, people, expectedId, onPick, onCancel }: DoneByPickerProps) {
  const t = useTranslations("doneBy");
  const ordered = doneByOrder(people, expectedId);

  return (
    <Dialog open={task !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{task?.title}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
          {ordered.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onPick(person.id)}
              className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatar_url} size={48} />
              <span className="text-sm font-medium leading-tight">{person.name}</span>
              {person.id === expectedId && (
                <span className="text-xs text-muted-foreground">{t("expected")}</span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

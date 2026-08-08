"use client";

import { useState, useRef } from "react";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChecklistItem } from "@/components/checklist-item";
import {
  useGiftIdeas,
  useCreateGiftIdea,
  useToggleGiftIdea,
  useDeleteGiftIdea,
} from "@/hooks";
import { useTranslations } from "next-intl";

interface GiftIdeasListProps {
  birthdayId: string;
}

export function GiftIdeasList({ birthdayId }: GiftIdeasListProps) {
  const t = useTranslations("birthdays");
  const tCommon = useTranslations("common");
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: ideas = [] } = useGiftIdeas(birthdayId);
  const createIdea = useCreateGiftIdea();
  const toggleIdea = useToggleGiftIdea();
  const deleteIdea = useDeleteGiftIdea();

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    await createIdea.mutateAsync({ birthday_id: birthdayId, text });
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {ideas.length === 0 ? (
        <p className="text-sm text-muted-foreground py-1">{t("giftIdeasEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {ideas.map((idea) => (
            <ChecklistItem
              key={idea.id}
              checked={idea.bought}
              onCheckedChange={(checked) =>
                void toggleIdea.mutate({ id: idea.id, bought: checked === true, birthday_id: birthdayId })
              }
              label={idea.text}
              meta={
                <ConfirmDestructive
                  title={tCommon("confirmDeleteGiftTitle")}
                  description={tCommon("confirmDeleteGiftBody")}
                  onConfirm={() => void deleteIdea.mutate({ id: idea.id, birthday_id: birthdayId })}
                >
                  {/* Was a 28px button that deleted on one tap, no undo. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 text-muted-foreground hover:text-destructive"
                    aria-label={t("removeGiftIdeaAria")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </ConfirmDestructive>
              }
            />
          ))}
        </div>
      )}
      {/* Add row */}
      <div className="flex gap-2 mt-1">
        <Input
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("giftIdeaPlaceholder")}
          className="h-9 text-sm"
        />
        <Button
          size="icon"
          variant="outline"
          className="size-9 shrink-0"
          aria-label={t("addGiftIdea")}
          onClick={() => void handleAdd()}
          disabled={!newText.trim() || createIdea.isPending}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRecipeTags } from "@/hooks/use-recipes";

/**
 * Tags on a recipe.
 *
 * The tables, the filter chips on the recipes page and the export/import
 * round-trip were all there; what was missing was any way to put a tag on a
 * recipe. This is that.
 *
 * Existing tags in the family are offered as you type, so a household ends up
 * with one "vegan" rather than four spellings of it.
 */
export function RecipeTagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const t = useTranslations("recipes");
  const { data: allTags = [] } = useRecipeTags();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const taken = new Set(value.map((tag) => tag.toLowerCase()));
    return allTags
      .filter((tag) => !taken.has(tag.name.toLowerCase()))
      .filter((tag) => !query || tag.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [allTags, draft, value]);

  const add = (name: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    // Case-insensitive, so "Vegan" doesn't sit next to "vegan".
    if (value.some((tag) => tag.toLowerCase() === cleaned.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, cleaned]);
    setDraft("");
  };

  const remove = (name: string) => onChange(value.filter((tag) => tag !== name));

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={t("form.tagRemoveAria", { tag })}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("form.tagPlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            // Enter inside a form would submit the whole recipe.
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            remove(value[value.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
      />

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => {
                add(tag.name);
                inputRef.current?.focus();
              }}
              className="text-xs px-2 py-1 rounded-full border border-dashed border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * The entity picker every vehicle driver uses.
 *
 * It lived inside the Tesla driver, which is why the generic driver asked
 * owners to paste entity ids into a text box — the good UX was locked to one
 * vendor. Same component, one copy, no behaviour change for Tesla.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HAEntity } from "@/types/home-assistant";

export interface EntitySelectorProps {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string) => void;
  entities: HAEntity[];
  allEntities?: HAEntity[];
  filterDomain?: string;
  filterDeviceClass?: string;
}

export function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  allEntities,
}: EntitySelectorProps) {
  const t = useTranslations("settings.tesla");
  const [search, setSearch] = useState("");

  const currentEntity = value
    ? (entities.find((e) => e.entity_id === value) ||
       allEntities?.find((e) => e.entity_id === value))
    : undefined;

  const entitiesWithCurrent =
    currentEntity && !entities.find((e) => e.entity_id === value)
      ? [currentEntity, ...entities]
      : entities;

  const filteredEntities = entitiesWithCurrent.filter((entity) => {
    if (value && entity.entity_id === value) return true;
    if (search) {
      const q = search.toLowerCase();
      return (
        entity.name.toLowerCase().includes(q) ||
        entity.entity_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleChange = (newValue: string) => {
    onChange(newValue === "__none__" ? "" : newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value || "__none__"} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("entityPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <div className="flex items-center px-2 pb-2">
            <Search className="size-4 mr-2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <SelectItem value="__none__">{t("noneOption")}</SelectItem>
          {filteredEntities
            .filter((entity) => entity.entity_id)
            .sort((a, b) => {
              const aT = a.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              const bT = b.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              return aT - bT || a.name.localeCompare(b.name);
            })
            .slice(0, 100)
            .map((entity) => (
              <SelectItem key={entity.entity_id} value={entity.entity_id}>
                <div className="flex flex-col">
                  <span>{entity.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {entity.entity_id}
                  </span>
                </div>
              </SelectItem>
            ))}
          {filteredEntities.length > 100 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("moreCount", { count: filteredEntities.length - 100 })}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

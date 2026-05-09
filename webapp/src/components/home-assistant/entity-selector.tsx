"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  // i18n strings — callers supply these so the component stays namespace-agnostic
  searchPlaceholder: string;
  noneLabel: string;
  selectPlaceholder: string;
  /** Label shown when the dropdown is truncated to ~100 visible entries.
   *  Receives the *overflow* count (`filteredEntities.length - 100`),
   *  not the total. Caller should localize: e.g. `(n) => t("moreCount", { count: n })`.
   *  This is a function prop because the overflow count is computed
   *  inside the component and would otherwise be unknown to the caller. */
  moreCountLabel: (count: number) => string;
  /** Optional substring matched against `entity_id` to float matching entries
   *  to the top of the list before alphabetical sort. Vendor-specific callers
   *  (e.g. Tesla settings) can pass `"tesla"`; generic callers omit it for
   *  plain alphabetical ordering. */
  priorityPattern?: string;
}

export function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  allEntities,
  filterDomain,
  filterDeviceClass,
  searchPlaceholder,
  noneLabel,
  selectPlaceholder,
  moreCountLabel,
  priorityPattern,
}: EntitySelectorProps) {
  const [search, setSearch] = useState("");

  // If current value isn't in the filtered entity list, find it in allEntities
  const currentEntity = value
    ? entities.find((e) => e.entity_id === value) ||
      allEntities?.find((e) => e.entity_id === value)
    : undefined;
  const entitiesWithCurrent =
    currentEntity && !entities.find((e) => e.entity_id === value)
      ? [currentEntity, ...entities]
      : entities;

  const filteredEntities = entitiesWithCurrent.filter((entity) => {
    // Always include the currently selected entity so it shows in the dropdown
    if (value && entity.entity_id === value) return true;

    // Domain filter
    if (filterDomain && !entity.domain.includes(filterDomain)) return false;

    // Device class filter (for sensors)
    if (
      filterDeviceClass &&
      entity.attributes.device_class !== filterDeviceClass
    )
      return false;

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        entity.name.toLowerCase().includes(searchLower) ||
        entity.entity_id.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const handleChange = (newValue: string) => {
    // Convert special "none" value back to empty string for clearing
    onChange(newValue === "__none__" ? "" : newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value || "__none__"} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <div className="flex items-center px-2 pb-2">
            <Search className="size-4 mr-2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <SelectItem value="__none__">{noneLabel}</SelectItem>
          {filteredEntities
            .filter((entity) => entity.entity_id)
            .sort((a, b) => {
              if (priorityPattern) {
                const pat = priorityPattern.toLowerCase();
                const aP = a.entity_id.toLowerCase().includes(pat) ? 0 : 1;
                const bP = b.entity_id.toLowerCase().includes(pat) ? 0 : 1;
                if (aP !== bP) return aP - bP;
              }
              return a.name.localeCompare(b.name);
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
              {moreCountLabel(filteredEntities.length - 100)}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

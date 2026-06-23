"use client";

import { useState } from "react";
import { Loader2, LayoutGrid, Zap, Home, Lightbulb, Tv, Thermometer, Flower2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DashboardEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, icon?: string, type?: "custom" | "energy") => Promise<void>;
  mode: "create" | "edit";
  initialName?: string;
  initialIcon?: string;
  dashboardType?: "custom" | "energy";
}

// Available icons for dashboards (labelKey resolved per-locale at render)
const AVAILABLE_ICONS = [
  { id: "home", icon: <Home className="size-5" />, labelKey: "iconHome" },
  { id: "grid", icon: <LayoutGrid className="size-5" />, labelKey: "iconGrid" },
  { id: "light", icon: <Lightbulb className="size-5" />, labelKey: "iconLight" },
  { id: "tv", icon: <Tv className="size-5" />, labelKey: "iconTv" },
  { id: "climate", icon: <Thermometer className="size-5" />, labelKey: "iconClimate" },
  { id: "garden", icon: <Flower2 className="size-5" />, labelKey: "iconGarden" },
  { id: "energy", icon: <Zap className="size-5" />, labelKey: "iconEnergy" },
] as const;

// Common emojis for dashboards
const EMOJI_OPTIONS = ["🏠", "💡", "🌡️", "📺", "🌿", "🔌", "🎵", "🛏️", "🍳", "🚗"];

export function DashboardEditor({
  open,
  onOpenChange,
  onSave,
  mode,
  initialName = "",
  initialIcon = "grid",
  dashboardType = "custom",
}: DashboardEditorProps) {
  const t = useTranslations("homeAutomation.editor");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(initialName);
  const [selectedIcon, setSelectedIcon] = useState(initialIcon);
  const [createType, setCreateType] = useState<"custom" | "energy">(dashboardType);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave(name.trim(), selectedIcon, createType);
      setName("");
      setSelectedIcon("grid");
      setCreateType("custom");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setName(initialName);
      setSelectedIcon(initialIcon);
      setCreateType(dashboardType);
    }
    onOpenChange(newOpen);
  };

  const isEnergyType = createType === "energy" || dashboardType === "energy";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("createTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("createDescription") : t("editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Dashboard Type Selection (only for create mode) */}
          {mode === "create" && (
            <div className="flex flex-col gap-2">
              <Label>{t("fieldType")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCreateType("custom")}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    createType === "custom"
                      ? "border-primary bg-primary/10"
                      : "border-input hover:bg-accent"
                  )}
                >
                  <LayoutGrid className="size-5" />
                  <div className="text-left">
                    <p className="text-sm font-medium">{t("typeCustom")}</p>
                    <p className="text-xs text-muted-foreground">{t("typeCustomDescription")}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateType("energy")}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    createType === "energy"
                      ? "border-primary bg-primary/10"
                      : "border-input hover:bg-accent"
                  )}
                >
                  <Zap className="size-5" />
                  <div className="text-left">
                    <p className="text-sm font-medium">{t("typeEnergy")}</p>
                    <p className="text-xs text-muted-foreground">{t("typeEnergyDescription")}</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Name Input */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="dashboard-name">{t("fieldName")}</Label>
            <Input
              id="dashboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isEnergyType ? t("namePlaceholderEnergy") : t("namePlaceholderCustom")}
              autoComplete="off"
            />
          </div>

          {/* Icon Selection (not for energy type) */}
          {!isEnergyType && (
            <div className="flex flex-col gap-2">
              <Label>{t("fieldIcon")}</Label>
              <div className="flex flex-col gap-3">
                {/* Icon Grid */}
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_ICONS.filter((i) => i.id !== "energy").map((iconOption) => (
                    <button
                      key={iconOption.id}
                      type="button"
                      onClick={() => setSelectedIcon(iconOption.id)}
                      className={cn(
                        "p-2 rounded-lg border transition-colors",
                        selectedIcon === iconOption.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input hover:bg-accent text-muted-foreground"
                      )}
                      title={t(iconOption.labelKey)}
                    >
                      {iconOption.icon}
                    </button>
                  ))}
                </div>

                {/* Emoji Grid */}
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setSelectedIcon(emoji)}
                      className={cn(
                        "size-9 flex items-center justify-center rounded-lg border transition-colors text-lg",
                        selectedIcon === emoji
                          ? "border-primary bg-primary/10"
                          : "border-input hover:bg-accent"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t("saving")}
              </>
            ) : mode === "create" ? (
              t("createButton")
            ) : (
              tCommon("save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

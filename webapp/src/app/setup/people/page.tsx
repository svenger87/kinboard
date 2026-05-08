"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { toast } from "sonner";
import { useCreatePerson } from "@/hooks";

interface Draft {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

function makeDraft(seed: number): Draft {
  return {
    id: crypto.randomUUID(),
    name: "",
    color: DEFAULT_COLORS[seed % DEFAULT_COLORS.length],
  };
}

export default function SetupPeoplePage() {
  const t = useTranslations("setup.people");
  const createPerson = useCreatePerson();
  const [drafts, setDrafts] = useState<Draft[]>([makeDraft(0)]);
  const [saving, setSaving] = useState(false);

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const addRow = () => setDrafts((ds) => [...ds, makeDraft(ds.length)]);
  const removeRow = (id: string) =>
    setDrafts((ds) => (ds.length > 1 ? ds.filter((d) => d.id !== id) : ds));

  const handleSave = async () => {
    const valid = drafts.filter((d) => d.name.trim().length > 0);
    if (valid.length === 0) return; // nothing to save; the WizardStepFooter's Skip handles the no-data path
    setSaving(true);
    try {
      await Promise.all(
        valid.map((d) =>
          createPerson.mutateAsync({
            name: d.name.trim(),
            color: d.color,
          }),
        ),
      );
    } catch (err) {
      console.error("setup/people: save failed:", err);
      toast.error(t("saveError"));
      // Re-throw so WizardStepFooter knows not to navigate forward;
      // user stays on this step to retry.
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <WizardProgress current="people" />
      <GlassCard className="p-6 md:p-8">
        <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

        <div className="flex flex-col gap-3">
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <input
                type="color"
                value={d.color}
                onChange={(e) => updateDraft(d.id, { color: e.target.value })}
                className="size-10 rounded-lg border-0 cursor-pointer"
                aria-label="Color"
              />
              <Input
                placeholder={t("namePlaceholder")}
                value={d.name}
                onChange={(e) => updateDraft(d.id, { name: e.target.value })}
                className="flex-1"
              />
              {drafts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(d.id)}
                  aria-label={t("remove")}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={addRow} className="mt-3">
          <Plus className="size-4 mr-2" />
          {t("addAnother")}
        </Button>
      </GlassCard>

      <WizardStepFooter
        nextHref="/setup/homeassistant"
        onNextClick={handleSave}
        disabled={saving}
      />
    </>
  );
}

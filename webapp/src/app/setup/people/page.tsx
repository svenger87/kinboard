"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { PersonColorPicker } from "@/components/person-color-picker";
import { PersonAvatar } from "@/components/person-avatar";
import { PERSON_COLORS } from "@/lib/person-color";
import { toast } from "sonner";
import { useCreatePerson } from "@/hooks";
import { safeRandomUUID } from "@/lib/uuid";
import { personRoleLabel } from "@/lib/person-role";

interface Draft {
  id: string;
  name: string;
  color: string;
  isChild: boolean;
  birthDate: string;
}

function makeDraft(seed: number): Draft {
  return {
    id: safeRandomUUID(),
    name: "",
    color: PERSON_COLORS[seed % PERSON_COLORS.length].hex,
    isChild: false,
    birthDate: "",
  };
}

export default function SetupPeoplePage() {
  const t = useTranslations("setup.people");
  const tRole = (isChild: boolean, birthDate: string) =>
    personRoleLabel(isChild, birthDate || null, {
      parent: t("roleParent"),
      child: t("roleChild"),
      years: (n) => t("ageYears", { count: n }),
    });
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
            is_child: d.isChild,
            birth_date: d.birthDate || null,
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
      <Card>
        <CardContent className="p-6 md:p-8">
          <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

          <div className="flex flex-col gap-3">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 md:p-4"
              >
                <PersonAvatar name={d.name || "?"} color={d.color} size={44} />
                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <Input
                    placeholder={t("namePlaceholder")}
                    value={d.name}
                    onChange={(e) => updateDraft(d.id, { name: e.target.value })}
                  />
                  {d.name && (
                    <p className="text-xs text-muted-foreground">
                      {tRole(d.isChild, d.birthDate)}
                    </p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Switch
                        aria-label={t("isChildAria", { name: d.name || "" })}
                        id={`is-child-${d.id}`}
                        checked={d.isChild}
                        onCheckedChange={(v) => updateDraft(d.id, { isChild: v })}
                      />
                      <Label htmlFor={`is-child-${d.id}`} className="text-sm cursor-pointer">
                        {t("isChildLabel")}
                      </Label>
                    </div>
                    <Input
                      type="date"
                      aria-label={t("birthDateLabel")}
                      value={d.birthDate}
                      onChange={(e) => updateDraft(d.id, { birthDate: e.target.value })}
                      className="w-auto flex-1 min-w-0"
                    />
                  </div>
                  <PersonColorPicker
                    value={d.color}
                    onChange={(hex) => updateDraft(d.id, { color: hex })}
                  />
                </div>
                {drafts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(d.id)}
                    aria-label={t("remove")}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 py-3.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06]"
          >
            <Plus className="size-5" strokeWidth={1.75} />
            {t("addAnother")}
          </button>
        </CardContent>
      </Card>

      <WizardStepFooter
        nextHref="/setup/calendar"
        onNextClick={handleSave}
        disabled={saving}
      />
    </>
  );
}

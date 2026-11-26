"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { PinDigits, saveSettingsPin, type PinDigitsHandle } from "@/components/settings/pin-digits";
import { useSetupState } from "@/hooks";
import { relockSettings } from "@/lib/pin-session";
import { useFamilyStore } from "@/stores/family-store";

/**
 * The settings PIN (RFC-024 §8, last step): the same PIN as Settings →
 * Security, offered here because a wall screen needs it before anything
 * else. Last, because once it is set every other step's save would ask for
 * it. Typed twice, since nobody can see the dots they typed.
 */
export default function SetupPinPage() {
  const t = useTranslations("setup.pin");
  const { family } = useFamilyStore();
  const qc = useQueryClient();
  const { data: state } = useSetupState();
  const digits = useRef<PinDigitsHandle>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const alreadySet = state?.has_pin === true && !saved;

  const onComplete = async (pin: string) => {
    if (!family?.id || saving) return;
    if (first === null) {
      setFirst(pin);
      setMismatch(false);
      digits.current?.reset();
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setMismatch(true);
      digits.current?.reset();
      return;
    }
    setSaving(true);
    try {
      const result = await saveSettingsPin(family.id, pin);
      if (result === "pin_required") {
        // A PIN appeared meanwhile (another device): this one did not set it.
        relockSettings();
        toast.error(t("saveError"));
      } else {
        setSaved(true);
        toast.success(t("saved"));
      }
      void qc.invalidateQueries({ queryKey: ["setup-state"] });
      void qc.invalidateQueries({ queryKey: ["pin-status", family.id] });
    } catch (err) {
      console.error("setup/pin: save failed:", err);
      toast.error(t("saveError"));
      setFirst(null);
      digits.current?.reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <WizardProgress current="pin" />
      <Card>
        <CardContent className="p-6 md:p-8">
          <div className="flex items-start gap-3 mb-6">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Lock className="size-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
              <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>
          </div>

          {saved ? (
            <p className="text-sm flex items-center justify-center gap-2 py-4" data-testid="setup-pin-saved">
              <CheckCircle2 className="size-5 text-success" />
              {t("saved")}
            </p>
          ) : alreadySet ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="setup-pin-already">
              {t("already")}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-sm text-center" aria-live="polite" data-testid="setup-pin-prompt">
                {mismatch ? (
                  <span className="text-destructive">{t("mismatch")}</span>
                ) : first === null ? (
                  t("enter")
                ) : (
                  t("confirm")
                )}
              </p>
              <PinDigits
                ref={digits}
                idPrefix="setup-pin"
                onComplete={onComplete}
                disabled={saving}
                digitLabel={(position) => t("digitLabel", { position })}
              />
              <p className="text-xs text-muted-foreground text-center">{t("hint")}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <WizardStepFooter step="pin" disabled={saving} />
    </>
  );
}

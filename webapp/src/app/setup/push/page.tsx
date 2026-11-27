"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { PushContactField } from "@/components/setup/instance-fields";
import { useFinishInstanceSteps, useInstanceSetup, useSaveInstanceSetup } from "@/hooks/use-instance-setup";
import { normaliseVapidSubject, subjectForDisplay } from "@/lib/first-run";
import { HttpsGuideLink } from "@/components/https-guide-link";

/**
 * Push (RFC-024 §8, step 2): it works already, because the install made its
 * own VAPID keys (on https or localhost; on plain http it says push needs
 * https and links the guide); optionally, the contact push services are given. Leaving
 * this step, by Continue or Skip, closes the install's steps for good.
 */
export default function SetupPushPage() {
  const t = useTranslations("setup.push");
  const router = useRouter();
  const { data: instance, isLoading } = useInstanceSetup();
  const save = useSaveInstanceSetup();
  const finish = useFinishInstanceSteps();
  const [contact, setContact] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  // Push needs a secure context: https, or localhost. On a plain http LAN
  // address the keys are there but no browser will subscribe, so "works
  // already" would be wrong. Read after mount: the server can't know.
  const [insecure, setInsecure] = useState(false);
  useEffect(() => setInsecure(!window.isSecureContext), []);

  useEffect(() => {
    if (!isLoading && instance && !instance.operator) router.replace("/setup");
  }, [isLoading, instance, router]);

  const stored = instance?.pushContact?.source === "install" ? instance.pushContact.value : null;
  const value = contact ?? stored ?? "";
  const fromEnvironment = instance?.pushContact?.source === "environment";

  const handleNext = async () => {
    if (fromEnvironment) return;
    // Emptied: back to the default contact.
    const next = value.trim() === "" ? null : normaliseVapidSubject(value);
    if (value.trim() !== "" && !next) {
      setInvalid(true);
      throw new Error("invalid contact");
    }
    if ((next === null && !stored) || (next && stored && subjectForDisplay(next) === stored)) return;
    try {
      await save.mutateAsync({ vapid_subject: next });
    } catch (err) {
      console.error("setup/push: save failed:", err);
      toast.error(t("saveError"));
      throw err;
    }
  };

  if (isLoading || !instance?.operator) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <WizardProgress current="push" />
      <Card>
        <CardContent className="p-6 md:p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
            {instance.pushReady && insecure ? (
              <p className="text-sm flex items-start gap-2" data-testid="push-needs-https">
                <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" />
                <span className="text-muted-foreground">
                  {t("needsHttps")} <HttpsGuideLink testId="push-https-guide" />
                </span>
              </p>
            ) : instance.pushReady ? (
              <p className="text-sm flex items-start gap-2" data-testid="push-ready">
                <CheckCircle2 className="size-4 shrink-0 text-success mt-0.5" />
                <span className="text-muted-foreground">{t("ready")}</span>
              </p>
            ) : (
              <p className="text-sm flex items-start gap-2" data-testid="push-not-ready">
                <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" />
                <span className="text-muted-foreground">{t("notReady")}</span>
              </p>
            )}
          </div>
          <PushContactField
            value={value}
            onChange={(v) => {
              setContact(v);
              setInvalid(false);
            }}
            source={instance.pushContact?.source}
            inForce={instance.pushContact?.value}
            invalid={invalid}
            disabled={save.isPending}
          />
          <p className="text-xs text-muted-foreground">{t("deviceHint")}</p>
        </CardContent>
      </Card>
      <WizardStepFooter
        step="push"
        onNextClick={handleNext}
        onLeave={() => finish.mutateAsync()}
        disabled={save.isPending || finish.isPending}
      />
    </>
  );
}

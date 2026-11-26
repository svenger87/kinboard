"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { DataLocationNote, SiteAddressField } from "@/components/setup/instance-fields";
import { useInstanceSetup, useSaveInstanceSetup } from "@/hooks/use-instance-setup";
import { normaliseSiteUrl } from "@/lib/first-run";

/**
 * The install's address (RFC-024 §8, step 1), and where its data lives.
 * Only the install's operator gets here; anyone else is sent on to the
 * family's steps.
 */
export default function SetupInstallPage() {
  const t = useTranslations("setup.install");
  const router = useRouter();
  const { data: instance, isLoading } = useInstanceSetup();
  const save = useSaveInstanceSetup();
  const [address, setAddress] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!isLoading && instance && !instance.operator) router.replace("/setup");
  }, [isLoading, instance, router]);

  const stored = instance?.siteUrl?.source === "install" ? instance.siteUrl.value : null;
  // The address this page was opened at, which is what the RFC proposes.
  const suggested = stored ?? (typeof window !== "undefined" ? window.location.origin : "");
  const value = address ?? suggested;
  const fromEnvironment = instance?.siteUrl?.source === "environment";

  const handleNext = async () => {
    if (fromEnvironment) return;
    const normalised = normaliseSiteUrl(value);
    if (!normalised) {
      setInvalid(true);
      throw new Error("invalid address");
    }
    if (normalised === stored) return;
    try {
      await save.mutateAsync({ site_url: normalised });
    } catch (err) {
      console.error("setup/install: save failed:", err);
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
      <WizardProgress current="install" />
      <Card>
        <CardContent className="p-6 md:p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <SiteAddressField
            value={value}
            onChange={(v) => {
              setAddress(v);
              setInvalid(false);
            }}
            source={instance.siteUrl?.source}
            inForce={instance.siteUrl?.value}
            invalid={invalid}
            disabled={save.isPending}
          />
          <DataLocationNote />
        </CardContent>
      </Card>
      <WizardStepFooter step="install" onNextClick={handleNext} disabled={save.isPending} />
    </>
  );
}

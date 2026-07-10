"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import {
  useSaveHomeAssistantSettings,
  useTestHomeAssistantConnection,
} from "@/hooks";

export default function SetupHomeAssistantPage() {
  const t = useTranslations("setup.homeassistant");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; locationName: string }
    | { ok: false; message: string }
    | null
  >(null);

  const test = useTestHomeAssistantConnection();
  const save = useSaveHomeAssistantSettings();

  const handleTest = async () => {
    setTestResult(null);
    try {
      const res = await test.mutateAsync({ url, access_token: token });
      const locationName: string = res?.config?.location_name ?? "Home Assistant";
      setTestResult({ ok: true, locationName });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : t("fail") });
    }
  };

  const handleNext = async () => {
    if (!url || !token) return;
    try {
      await save.mutateAsync({ url, access_token: token });
    } catch (err) {
      console.error("setup/homeassistant: save failed:", err);
      toast.error(t("fail"));
      throw err;
    }
  };

  return (
    <>
      <WizardProgress current="homeassistant" />
      <Card><CardContent className="p-6 md:p-8">
        <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ha-url">{t("urlLabel")}</Label>
            <Input
              id="ha-url"
              type="url"
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ha-token">{t("tokenLabel")}</Label>
            <div className="relative">
              <Input
                id="ha-token"
                type={showToken ? "text" : "password"}
                placeholder={t("tokenPlaceholder")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={showToken ? t("hideToken") : t("showToken")}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t("tokenHelp")}</p>
          </div>

          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!url || !token || test.isPending}
            className="self-start"
          >
            {test.isPending ? t("testing") : t("test")}
          </Button>

          {testResult?.ok && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              {t("ok", { locationName: testResult.locationName })}
            </div>
          )}
          {testResult && !testResult.ok && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {testResult.message}
            </div>
          )}
        </div>
      </CardContent></Card>

      <WizardStepFooter
        backHref="/setup/calendar"
        nextHref="/setup/weather"
        onNextClick={handleNext}
        disabled={save.isPending}
      />
    </>
  );
}

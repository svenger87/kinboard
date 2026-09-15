"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CodeInput } from "@/components/code-input";
import {
  Users,
  ArrowRight,
  Sparkles,
  RefreshCw,
  PartyPopper,
  Plus,
  KeyRound,
  Upload,
  Loader2,
  AlertCircle,
  CalendarDays,
  House,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNextPath } from "@/components/auth-guard";
import {
  useJoinFamily,
  useCreateFamilyWithDevice,
  useFindDeviceByFingerprint,
  useQuickRejoin,
} from "@/hooks";
import { getDeviceFingerprint } from "@/lib/device-id";
import { postLocale } from "@/lib/locale-client";
import { LocaleSwitcher } from "@/components/locale-switcher";

interface RecognizedDevice {
  device: {
    id: string;
    name: string;
    last_seen: string;
  };
  family: {
    id: string;
    name: string;
  };
}

export default function JoinPage() {
  const t = useTranslations("join");
  const locale = useLocale();
  const [mode, setMode] = useState<"join" | "create">("join");
  // Welcome gate: until the user picks a CTA (or is recognized / fresh-install
  // forced into create), show the welcome hero instead of a form.
  const [modeChosen, setModeChosen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Surfaces the demo family's join code on public-demo deployments
  // (KINBOARD_DEMO_FAMILY_CODE set on the server). Self-hosters running
  // their own household leave the env var unset and the banner never
  // renders.
  const { data: demoCode } = useQuery({
    queryKey: ["demo-code"],
    queryFn: async (): Promise<string | null> => {
      const r = await fetch("/api/demo");
      if (!r.ok) return null;
      const data = await r.json();
      return typeof data.code === "string" && data.code.length > 0 ? data.code : null;
    },
    staleTime: 60 * 60 * 1000,
  });

  // Fingerprint recognition state
  const [recognizedDevices, setRecognizedDevices] = useState<RecognizedDevice[]>([]);
  const [isCheckingFingerprint, setIsCheckingFingerprint] = useState(true);

  // Fresh-install detection: when no families exist yet, default to "Create"
  // mode and surface a welcome message instead of asking for a code that
  // doesn't exist.
  const [isFreshInstall, setIsFreshInstall] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const joinFamily = useJoinFamily();
  const createFamily = useCreateFamilyWithDevice();
  const findByFingerprint = useFindDeviceByFingerprint();
  const quickRejoin = useQuickRejoin();

  const loading = joinFamily.isPending || createFamily.isPending || quickRejoin.isPending;

  // Check fingerprint on mount
  useEffect(() => {
    const checkFingerprint = async () => {
      try {
        const fingerprint = getDeviceFingerprint();
        if (fingerprint) {
          const result = await findByFingerprint.mutateAsync(fingerprint);
          if (result && result.length > 0) {
            setRecognizedDevices(result);
          }
        }
      } catch (e) {
        console.log("Fingerprint check failed:", e);
      } finally {
        setIsCheckingFingerprint(false);
      }
    };
    checkFingerprint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect fresh install — flip to "create" mode if no families exist
  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data: { hasFamilies?: boolean }) => {
        if (cancelled) return;
        if (data.hasFamilies === false) {
          setIsFreshInstall(true);
          setMode("create");
          setModeChosen(true);
        }
      })
      .catch(() => {
        // Network/API error → leave defaults; never push the user into
        // "Create" mode unless we're sure the database is empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Quick rejoin handler
  const handleQuickRejoin = async (deviceId: string) => {
    setError("");
    try {
      await quickRejoin.mutateAsync({ deviceId });
      router.push(safeNextPath(searchParams.get("next")));
    } catch (err) {
      console.error("Quick rejoin failed:", err);
      setError(t("rejoinError"));
      setRecognizedDevices([]); // Clear recognition on error
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await joinFamily.mutateAsync({
        joinCode: joinCode.toUpperCase(),
        deviceName: deviceName || t("deviceNameDefault"),
      });
      router.push(safeNextPath(searchParams.get("next")));
    } catch {
      setError(t("joinError"));
    }
  };

  // Restore from a Kinboard export file. /api/import already creates the
  // new family server-side (fresh id + join_code); joining it here is
  // functionally the same device-registration business logic handleCreate
  // triggers after its own family insert — useJoinFamily just looks the
  // family up by join_code instead of inserting it — so we reuse that hook
  // rather than duplicating device-registration code, then back-fill the
  // locale exactly like handleCreate does for a brand-new family.
  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Backup file is not valid JSON");
      }

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        throw new Error(`Import failed with status ${res.status}`);
      }
      const result: {
        family_id: string;
        join_code: string;
        name: string;
        warnings: string[];
      } = await res.json();

      await joinFamily.mutateAsync({
        joinCode: result.join_code,
        deviceName: deviceName || t("deviceNameDefault"),
      });
      // Best-effort, same as handleCreate — never blocks or fails the flow.
      postLocale(locale, result.family_id).catch(() => {});

      if (result.warnings.length > 0) {
        toast(t("restoreWarnings", { count: result.warnings.length }));
      }
      router.push(safeNextPath(searchParams.get("next")));
    } catch (err) {
      console.error("join: restore from backup failed:", err);
      toast.error(t("restoreFailed"));
    } finally {
      setRestoring(false);
      // Reset so the same file can be re-selected after a failed attempt
      // (browsers don't re-fire onChange for an unchanged input value).
      e.target.value = "";
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const { family } = await createFamily.mutateAsync({
        familyName: familyName.trim(),
        deviceName: deviceName || t("deviceNameDefault"),
      });
      // Best-effort: back-fill the family-level locale setting so
      // server-generated push notifications match the UI language the
      // family onboarded in. Must never block or fail the join flow.
      postLocale(locale, family.id).catch(() => {});
      router.push("/setup/people");
    } catch {
      setError(t("createError"));
    }
  };

  return (
    <main className="min-h-page flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background — flat page gradient, theme-following, no glass */}
      <div className="page-gradient" />

      <LocaleSwitcher className="absolute top-4 right-4 z-20 safe-area-inset" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        // max-w-md is a phone measure. On a 1080x1920 portrait panel it left
        // roughly 70% of the first screen anyone ever sees empty (audit KB-45).
        className="relative z-10 w-full max-w-6xl"
      >
        {/* Header / Welcome hero */}
        {!modeChosen && recognizedDevices.length === 0 && !isFreshInstall && !isCheckingFingerprint ? (
          <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16">
            <div>
              <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Users className="size-4" strokeWidth={2} />
                </span>
                {t("welcomeEyebrow")}
              </div>
              <h1 className="max-w-2xl text-5xl font-display font-medium leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
                {t("welcomeTitle")}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                {t("welcomeBody")}
              </p>
              <div className="mt-10 grid gap-4 sm:grid-cols-3 lg:max-w-2xl">
                {[
                  { icon: CalendarDays, title: t("welcomeFeatureCalendarTitle"), body: t("welcomeFeatureCalendarBody") },
                  { icon: House, title: t("welcomeFeatureHomeTitle"), body: t("welcomeFeatureHomeBody") },
                  { icon: ShieldCheck, title: t("welcomeFeaturePrivacyTitle"), body: t("welcomeFeaturePrivacyBody") },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
                    <Icon className="mb-3 size-5 text-primary" strokeWidth={1.8} />
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
            </div>
            <Card className="border-primary/20 bg-card/90 p-2 shadow-xl shadow-primary/5">
              <CardContent className="p-6 sm:p-8">
                <div className="mb-7 flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Sparkles className="size-6" strokeWidth={1.8} />
                  </div>
                  <div>
                    <p className="text-lg font-medium">{t("welcomeActionTitle")}</p>
                    <p className="text-sm text-muted-foreground">{t("welcomeActionBody")}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <Button
                    size="kiosk"
                    className="w-full justify-between"
                    onClick={() => {
                      setMode("create");
                      setModeChosen(true);
                    }}
                  >
                    <span className="flex items-center gap-2"><Plus className="size-5" strokeWidth={1.75} />{t("welcomeCreateCta")}</span>
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    size="kiosk"
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => {
                      setMode("join");
                      setModeChosen(true);
                    }}
                  >
                    <span className="flex items-center gap-2"><KeyRound className="size-5" strokeWidth={1.75} />{t("welcomeJoinCta")}</span>
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-16 icon-badge rounded-2xl mb-4">
              <Users className="size-8" strokeWidth={1.75} />
            </div>
            <h1 className="text-2xl font-display font-medium tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-2">{t("tagline")}</p>
          </div>
        )}

        {/* Fresh-install welcome (only when DB is empty) */}
        <AnimatePresence>
          {isFreshInstall && recognizedDevices.length === 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Card className="p-4 border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-4 text-primary" />
                  <span className="text-sm font-medium">
                    {t("freshInstallTitle")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("freshInstallDescription")}
                </p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Demo banner — only shown on public-demo installs */}
        {demoCode && recognizedDevices.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Card className="p-4 border-primary/30 bg-primary/5">
              <div className="flex items-start gap-3">
                <PartyPopper className="size-5 shrink-0 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t("demoBannerTitle")}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("demoBannerDescription")}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <code className="rounded bg-background px-2 py-1 font-mono text-base tracking-[0.2em]">
                      {demoCode}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setMode("join");
                        setJoinCode(demoCode);
                        setModeChosen(true);
                      }}
                    >
                      {t("demoBannerUseCode")}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Quick Rejoin Section (shown when device is recognized) */}
        <AnimatePresence>
          {!isCheckingFingerprint && recognizedDevices.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Card className="p-4 border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw className="size-4 text-primary" />
                  <span className="text-sm font-medium">
                    {t("rejoinTitle")}
                  </span>
                </div>

                {recognizedDevices.map((item) => (
                  <div
                    key={item.device.id}
                    className="flex items-center justify-between py-3 border-t border-border/50 first:border-t-0"
                  >
                    <div>
                      <p className="font-medium">{item.family.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("rejoinSubtitle", { deviceName: item.device.name })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleQuickRejoin(item.device.id)}
                      disabled={loading}
                    >
                      {quickRejoin.isPending ? t("rejoinPending") : t("rejoinAction")}
                    </Button>
                  </div>
                ))}

                <button
                  onClick={() => setRecognizedDevices([])}
                  className="text-xs text-muted-foreground hover:text-foreground mt-3 w-full text-center transition-colors"
                >
                  {t("rejoinNotMe")}
                </button>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode Tabs — hidden on fresh install (Create is the only valid path) */}
        {!isFreshInstall && modeChosen && recognizedDevices.length === 0 && (
          <div className="flex gap-2 mb-6 p-1 bg-secondary/50 rounded-xl">
            <button
              onClick={() => setMode("join")}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                mode === "join"
                  ? "bg-background elev-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tabJoin")}
            </button>
            <button
              onClick={() => setMode("create")}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                mode === "create"
                  ? "bg-background elev-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tabCreate")}
            </button>
          </div>
        )}

        {/* Form Card — only after a mode is chosen (or fresh install forces create) */}
        {(modeChosen || isFreshInstall) && recognizedDevices.length === 0 && (
        <Card>
          <CardContent className="p-6">
          {mode === "join" ? (
            <form onSubmit={handleJoin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="join-code" className="text-sm font-medium">{t("joinCodeLabel")}</label>
                <CodeInput value={joinCode} onChange={setJoinCode} length={6} invalid={!!error} />
                {error ? (
                  <p id="join-code-error" role="alert" className="mt-1 flex items-center justify-center gap-1.5 text-sm font-medium text-destructive">
                    <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                    {error}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5 mt-1">
                    {t("joinCodeHint")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="join-device-name" className="text-sm font-medium">{t("deviceNameLabel")}</label>
                <Input
                  id="join-device-name"
                  placeholder={t("deviceNamePlaceholder")}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                size="kiosk"
                className="w-full"
                disabled={loading || joinCode.length < 6}
              >
                {loading ? (
                  t("joinSubmitting")
                ) : (
                  <>
                    {t("joinSubmit")}
                    <ArrowRight className="size-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="create-family-name" className="text-sm font-medium">{t("familyNameLabel")}</label>
                <Input
                  id="create-family-name"
                  placeholder={t("familyNamePlaceholder")}
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="create-device-name" className="text-sm font-medium">{t("deviceNameLabel")}</label>
                <Input
                  id="create-device-name"
                  placeholder={t("deviceNamePlaceholder")}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                size="kiosk"
                className="w-full"
                disabled={loading || !familyName.trim()}
              >
                {loading ? (
                  t("createSubmitting")
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" />
                    {t("createSubmit")}
                  </>
                )}
              </Button>
            </form>
          )}
          </CardContent>
        </Card>
        )}

        {/* Restore from backup — quiet secondary action, create-family
            screen only (a restore rebuilds a whole family, so it doesn't
            belong on the join-with-code tab). */}
        {mode === "create" && (modeChosen || isFreshInstall) && recognizedDevices.length === 0 && (
          <div className="mt-4 text-center">
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleRestoreFile}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={loading || restoring}
              onClick={() => restoreInputRef.current?.click()}
            >
              {restoring ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Upload className="size-4 mr-2" />
              )}
              {t("restoreButton")}
            </Button>
          </div>
        )}

        {/* Recovery hint — shows after the fingerprint check has run
            and found no recognized device, but only on the Join tab
            (not Create tab / fresh install). Helps users who wiped
            site data + got a different fingerprint due to a browser
            update find their family code on another device. */}
        {!isFreshInstall &&
          modeChosen &&
          !isCheckingFingerprint &&
          recognizedDevices.length === 0 &&
          mode === "join" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-6"
            >
              <Card className="p-4 bg-muted/20">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("recoveryHint")}
                </p>
              </Card>
            </motion.div>
          )}

      </motion.div>
    </main>
  );
}

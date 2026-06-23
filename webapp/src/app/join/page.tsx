"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CodeInput } from "@/components/code-input";
import { Users, ArrowRight, Sparkles, RefreshCw, PartyPopper, Plus, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useJoinFamily,
  useCreateFamilyWithDevice,
  useFindDeviceByFingerprint,
  useQuickRejoin,
} from "@/hooks";
import { getDeviceFingerprint } from "@/lib/device-id";
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
  const [mode, setMode] = useState<"join" | "create">("join");
  // Welcome gate: until the user picks a CTA (or is recognized / fresh-install
  // forced into create), show the welcome hero instead of a form.
  const [modeChosen, setModeChosen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");

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
      router.push("/");
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
      router.push("/");
    } catch {
      setError(t("joinError"));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await createFamily.mutateAsync({
        familyName,
        deviceName: deviceName || t("deviceNameDefault"),
      });
      router.push("/setup/people");
    } catch {
      setError(t("createError"));
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden">
      {/* Background — flat page gradient, theme-following, no glass */}
      <div className="page-gradient" />

      <LocaleSwitcher className="absolute top-4 right-4 z-20 safe-area-inset" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Header / Welcome hero */}
        {!modeChosen && recognizedDevices.length === 0 && !isFreshInstall && !isCheckingFingerprint ? (
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center size-20 icon-badge rounded-3xl mb-6">
              <Users className="size-10" strokeWidth={1.75} />
            </div>
            <p className="text-kiosk-label text-primary mb-3">{t("welcomeEyebrow")}</p>
            <h1 className="text-4xl font-display font-medium tracking-tight mb-3">
              {t("welcomeTitle")}
            </h1>
            <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto mb-8">
              {t("welcomeBody")}
            </p>
            <div className="flex flex-col gap-3">
              <Button
                size="kiosk"
                className="w-full"
                onClick={() => {
                  setMode("create");
                  setModeChosen(true);
                }}
              >
                <Plus className="size-5" strokeWidth={1.75} />
                {t("welcomeCreateCta")}
              </Button>
              <Button
                size="kiosk"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMode("join");
                  setModeChosen(true);
                }}
              >
                <KeyRound className="size-5" strokeWidth={1.75} />
                {t("welcomeJoinCta")}
              </Button>
            </div>
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
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("tabJoin")}
            </button>
            <button
              onClick={() => setMode("create")}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                mode === "create"
                  ? "bg-background shadow-sm text-foreground"
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
                <CodeInput value={joinCode} onChange={setJoinCode} length={6} />
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5 mt-1">
                  {t("joinCodeHint")}
                </p>
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

              {error && (
                <p className="text-sm text-destructive text-center" role="alert">{error}</p>
              )}

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

              {error && (
                <p className="text-sm text-destructive text-center" role="alert">{error}</p>
              )}

              <Button
                type="submit"
                size="kiosk"
                className="w-full"
                disabled={loading || !familyName}
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

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Users, ArrowRight, Sparkles, RefreshCw } from "lucide-react";
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
  const [joinCode, setJoinCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");

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
      router.push("/");
    } catch {
      setError(t("createError"));
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-br from-month-primary/10 via-background to-background pointer-events-none" />

      {/* Decorative elements */}
      <div className="absolute top-20 left-20 size-64 bg-month-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-month-accent/5 rounded-full blur-3xl" />

      <LocaleSwitcher className="absolute top-4 right-4 z-20 safe-area-inset" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="inline-flex items-center justify-center size-20 rounded-2xl bg-month-primary/10 border border-month-primary/20 mb-4"
          >
            <Users className="size-10 text-month-primary" strokeWidth={1.5} />
          </motion.div>
          <h1 className="text-3xl font-display font-light tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {t("tagline")}
          </p>
        </div>

        {/* Fresh-install welcome (only when DB is empty) */}
        <AnimatePresence>
          {isFreshInstall && recognizedDevices.length === 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <GlassCard className="p-4 border-month-primary/30 bg-month-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="size-4 text-month-primary" />
                  <span className="text-sm font-medium">
                    {t("freshInstallTitle")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("freshInstallDescription")}
                </p>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Rejoin Section (shown when device is recognized) */}
        <AnimatePresence>
          {!isCheckingFingerprint && recognizedDevices.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <GlassCard className="p-4 border-month-primary/30 bg-month-primary/5">
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw className="size-4 text-month-primary" />
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
                      variant="month"
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
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode Tabs — hidden on fresh install (Create is the only valid path) */}
        {!isFreshInstall && (
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

        {/* Form Card */}
        <GlassCard className="p-6">
          {mode === "join" ? (
            <form onSubmit={handleJoin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="join-code" className="text-sm font-medium">{t("joinCodeLabel")}</label>
                <Input
                  id="join-code"
                  placeholder={t("joinCodePlaceholder")}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="text-center text-2xl font-mono tracking-[0.5em] uppercase h-14"
                  maxLength={6}
                  required
                />
                <p className="text-xs text-muted-foreground text-center">
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
                variant="month"
                size="lg"
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
                variant="month"
                size="lg"
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
        </GlassCard>

      </motion.div>
    </main>
  );
}

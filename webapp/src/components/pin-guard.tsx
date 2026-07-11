"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Lock, ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFamilyStore } from "@/stores/family-store";
import { useRouter } from "next/navigation";

const PIN_LENGTH = 4;

// sessionStorage key. Value is a literal marker, not the PIN itself — the
// PIN is never sent to the browser (verified server-side via /api/pin).
// A side effect: changing the PIN on one device no longer invalidates an
// already-unlocked session on another tab/device; that's an accepted
// tradeoff of not shipping the PIN client-side. Sessions are still scoped
// to sessionStorage (cleared on tab close) and re-verified on every mount
// via the /api/pin status query below.
const SESSION_KEY = "kinboard_settings_unlock";
const UNLOCKED_MARKER = "unlocked";

interface PinGuardProps {
  children: React.ReactNode;
  /** Where to navigate when cancel is pressed. Defaults to "/" */
  cancelHref?: string;
}

function readSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Wraps content behind a 4-digit PIN entry screen.
 * If no PIN is configured, children render immediately.
 * Once unlocked, the session persists (via sessionStorage) so navigating to a
 * sub-page and returning does not re-prompt.
 */
export function PinGuard({ children, cancelHref = "/" }: PinGuardProps) {
  const { family } = useFamilyStore();
  const { data: status, isLoading } = useQuery({
    queryKey: ["pin-status", family?.id],
    queryFn: async (): Promise<{ set: boolean }> => {
      const res = await fetch(`/api/pin?family_id=${family!.id}`);
      if (!res.ok) throw new Error("Failed to load PIN status");
      return res.json();
    },
    enabled: !!family?.id,
  });
  const pinIsSet = !!status?.set;

  // Optimistic initial state from sessionStorage; reconciled against actual
  // PIN status once it loads (a PIN that was removed elsewhere clears it).
  const [unlocked, setUnlocked] = useState<boolean>(() => readSession() === UNLOCKED_MARKER);
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState<"wrong" | "rateLimited" | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!pinIsSet) {
      setUnlocked(false);
      return;
    }
    if (readSession() !== UNLOCKED_MARKER) {
      setUnlocked(false);
    }
  }, [isLoading, pinIsSet]);

  // No PIN set — pass through
  if (!isLoading && !pinIsSet) {
    return <>{children}</>;
  }

  if (unlocked) {
    return <>{children}</>;
  }

  if (isLoading) {
    return null;
  }

  return (
    <PinEntryScreen
      digits={digits}
      setDigits={setDigits}
      error={error}
      setError={setError}
      inputRefs={inputRefs}
      familyId={family!.id}
      onSuccess={() => {
        try { sessionStorage.setItem(SESSION_KEY, UNLOCKED_MARKER); } catch { /* noop */ }
        setUnlocked(true);
      }}
      onCancel={() => router.push(cancelHref)}
    />
  );
}

function PinEntryScreen({
  digits,
  setDigits,
  error,
  setError,
  inputRefs,
  familyId,
  onSuccess,
  onCancel,
}: {
  digits: string[];
  setDigits: (d: string[]) => void;
  error: "wrong" | "rateLimited" | null;
  setError: (e: "wrong" | "rateLimited" | null) => void;
  inputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  familyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("components.pin");
  const [verifying, setVerifying] = useState(false);
  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [inputRefs]);

  const checkPin = useCallback(
    async (newDigits: string[]) => {
      const entered = newDigits.join("");
      if (entered.length !== PIN_LENGTH || verifying) return;
      setVerifying(true);
      try {
        const res = await fetch("/api/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_id: familyId, action: "verify", pin: entered }),
        });
        if (res.status === 429) {
          setError("rateLimited");
          setDigits(Array(PIN_LENGTH).fill(""));
          inputRefs.current[0]?.focus();
          return;
        }
        const data = res.ok ? await res.json() : { valid: false };
        if (data.valid) {
          onSuccess();
          return;
        }
        setError("wrong");
        setTimeout(() => {
          setDigits(Array(PIN_LENGTH).fill(""));
          setError(null);
          inputRefs.current[0]?.focus();
        }, 600);
      } catch (err) {
        console.error("pin-guard: verify failed:", err);
        setError("wrong");
      } finally {
        setVerifying(false);
      }
    },
    [familyId, onSuccess, setDigits, setError, inputRefs, verifying]
  );

  const handleChange = (index: number, value: string) => {
    // Only accept digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    if (digit && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    checkPin(newDigits);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (!pasted) return;
    const newDigits = Array(PIN_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    const nextFocus = Math.min(pasted.length, PIN_LENGTH - 1);
    inputRefs.current[nextFocus]?.focus();
    checkPin(newDigits);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative safe-area-inset">
      <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-sm"
      >
        <Card className="p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="p-3 rounded-xl bg-month-primary/10">
              <Lock className="size-8 text-month-primary" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-display font-light mb-1">{t("title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("description")}
              </p>
            </div>

            <div className="flex gap-3" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={`w-14 h-16 text-center text-2xl font-mono rounded-xl border-2 bg-background/50 outline-none transition-all duration-200 ${
                    error === "wrong"
                      ? "border-destructive animate-shake"
                      : digit
                      ? "border-month-primary"
                      : "border-border focus:border-month-primary/60"
                  }`}
                  autoComplete="off"
                  disabled={verifying}
                />
              ))}
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-destructive"
              >
                {error === "rateLimited" ? t("pinRateLimited") : t("incorrect")}
              </motion.p>
            )}

            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground gap-2"
              onClick={onCancel}
            >
              <ArrowLeft className="size-4" />
              {t("cancel")}
            </Button>
          </div>
        </Card>
      </motion.div>
    </main>
  );
}

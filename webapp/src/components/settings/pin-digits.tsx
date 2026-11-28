"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { isPinRequired } from "@/lib/pin-session";

export interface PinDigitsHandle {
  /** Empty the four boxes and put the cursor in the first. */
  reset: () => void;
  focus: () => void;
}

interface PinDigitsProps {
  /** Called once all four digits are in. */
  onComplete: (pin: string) => void;
  disabled?: boolean;
  /** Accessible name of each box, given the 1-based position. */
  digitLabel?: (position: number) => string;
  idPrefix?: string;
}

/**
 * The settings PIN's four boxes, as Settings → Data & safety and the setup
 * wizard's PIN step (RFC-024 §8) ask for it: one digit each, the cursor
 * moving on as they fill and back on Backspace.
 */
export const PinDigits = forwardRef<PinDigitsHandle, PinDigitsProps>(function PinDigits(
  { onComplete, disabled, digitLabel, idPrefix = "pin-digit" },
  ref,
) {
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      setDigits(["", "", "", ""]);
      setTimeout(() => inputs.current[0]?.focus(), 0);
    },
    focus: () => inputs.current[0]?.focus(),
  }));

  const change = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 3) inputs.current[index + 1]?.focus();
    const entered = next.join("");
    if (entered.length === 4 && !disabled) onComplete(entered);
  };

  const keyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  };

  return (
    <div className="flex gap-3">
      {digits.map((digit, i) => (
        <input
          key={i}
          id={`${idPrefix}-${i}`}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={digitLabel?.(i + 1)}
          onChange={(e) => change(i, e.target.value)}
          onKeyDown={(e) => keyDown(i, e)}
          className="w-14 h-16 text-center text-2xl font-mono rounded-xl border-2 bg-background/50 outline-none transition-all duration-200 border-border focus:border-primary/60"
          autoComplete="off"
        />
      ))}
    </div>
  );
});

/**
 * Sets the family's settings PIN through /api/pin. "pin_required" when one
 * exists already and this device has not entered it (the caller relocks).
 */
export async function saveSettingsPin(familyId: string, pin: string): Promise<"ok" | "pin_required"> {
  const res = await fetch("/api/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ family_id: familyId, action: "set", pin }),
  });
  if (await isPinRequired(res)) return "pin_required";
  if (!res.ok) throw new Error(`PIN save failed: ${res.status}`);
  // Refresh the unlock session so the new PIN becomes the current session proof
  try {
    sessionStorage.setItem("kinboard_settings_unlock", "unlocked");
  } catch {
    /* noop */
  }
  return "ok";
}

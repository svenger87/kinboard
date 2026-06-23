"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface CodeInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  onComplete?: () => void;
  className?: string;
}

/** Allowed join-code characters: A–Z and 0–9 (matches generateJoinCode). */
function sanitize(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function CodeInput({
  value,
  onChange,
  length = 6,
  onComplete,
  className,
}: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? "");

  const commit = (next: string) => {
    const clipped = sanitize(next).slice(0, length);
    onChange(clipped);
    if (clipped.length === length) onComplete?.();
  };

  const focusCell = (i: number) => {
    const clamped = Math.max(0, Math.min(length - 1, i));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const cleaned = sanitize(raw);
    if (!cleaned) return;
    const arr = chars.slice();
    // Typing into a cell may paste multiple chars; spread across cells.
    let cursor = index;
    for (const ch of cleaned) {
      if (cursor >= length) break;
      arr[cursor] = ch;
      cursor += 1;
    }
    commit(arr.join(""));
    focusCell(cursor);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = chars.slice();
      if (arr[index]) {
        arr[index] = "";
        commit(arr.join(""));
      } else if (index > 0) {
        arr[index - 1] = "";
        commit(arr.join(""));
        focusCell(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCell(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const cleaned = sanitize(e.clipboardData.getData("text"));
    if (!cleaned) return;
    commit(cleaned);
    focusCell(Math.min(cleaned.length, length - 1));
  };

  return (
    <div className={cn("flex gap-2", className)}>
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={char}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Character ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-16 min-w-0 flex-1 rounded-xl border bg-card text-center font-mono text-2xl font-bold uppercase text-foreground",
            "transition-colors focus-visible:outline-none focus-visible:border-primary",
            "focus-visible:ring-2 focus-visible:ring-primary/30",
            char ? "border-primary/40" : "border-border",
          )}
        />
      ))}
    </div>
  );
}

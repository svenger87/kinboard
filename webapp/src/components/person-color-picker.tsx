"use client";

import { cn } from "@/lib/utils";
import { PERSON_COLORS } from "@/lib/person-color";

interface PersonColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}

export function PersonColorPicker({ value, onChange, className }: PersonColorPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Color"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {PERSON_COLORS.map(({ key, hex }) => {
        const selected = value.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            onClick={() => onChange(hex)}
            className={cn(
              "size-7 rounded-full transition-[box-shadow,transform] active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected && "ring-2 ring-offset-2 ring-offset-card",
            )}
            style={{
              backgroundColor: hex,
              ...(selected ? { ["--tw-ring-color" as string]: hex } : {}),
            }}
          />
        );
      })}
    </div>
  );
}

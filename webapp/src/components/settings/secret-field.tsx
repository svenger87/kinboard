"use client";

import { useState } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SecretFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: LucideIcon;
  placeholder?: string;
  hint?: string;
  showLabel: string; // aria-label for reveal
  hideLabel: string; // aria-label for conceal
  autoComplete?: string;
}

// Matches the eye-toggle markup previously copy-pasted across the HA,
// Immich, Unsplash and Bring connect dialogs — keep classes in sync if
// this ever needs to change so all four stay visually identical.
export function SecretField({
  id,
  label,
  value,
  onChange,
  icon: Icon,
  placeholder,
  hint,
  showLabel,
  hideLabel,
  autoComplete = "off",
}: SecretFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {Icon && <Icon className="size-4 inline mr-2" />}
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={visible ? hideLabel : showLabel}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

"use client";

import { useRef } from "react";
import { ImagePlus, X, Cake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function BirthdayPhotoField({
  value,
  onChange,
  label,
  removeLabel,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  removeLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
          {value ? (
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <Cake className="size-6 text-muted-foreground" strokeWidth={1.75} />
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-4" strokeWidth={1.75} />
            {label}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              <X className="size-4" strokeWidth={1.75} />
              {removeLabel}
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}

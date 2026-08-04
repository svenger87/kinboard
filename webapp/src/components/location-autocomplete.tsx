"use client";

import { useState, useRef, useEffect } from "react";
import { MapPin, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { useLocationSearch, type LocationResult } from "@/hooks";
import { cn } from "@/lib/utils";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function LocationAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  id,
}: LocationAutocompleteProps) {
  const t = useTranslations("components.locationAutocomplete");
  const resolvedPlaceholder = placeholder ?? t("placeholder");
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { results, isLoading, search, clear, formatLocation } = useLocationSearch({
    debounceMs: 300,
    limit: 5,
    countryCode: "de",
  });

  // Sync input value with external value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);

    if (newValue.length >= 3) {
      search(newValue);
      setIsOpen(true);
    } else {
      clear();
      setIsOpen(false);
    }
  };

  const handleSelectLocation = (location: LocationResult) => {
    const formatted = formatLocation(location);
    setInputValue(formatted);
    onChange(formatted);
    setIsOpen(false);
    clear();
  };

  const handleClear = () => {
    setInputValue("");
    onChange("");
    clear();
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (results.length > 0) {
      setIsOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={resolvedPlaceholder}
          className="pl-9 pr-8"
          autoComplete="off"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
        )}
        {!isLoading && inputValue && (
          <button
            type="button"
            onClick={handleClear}
            aria-label={t("clearAria")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <ul className="py-1 max-h-60 overflow-auto">
            {results.map((location) => (
              <li key={location.place_id}>
                <button
                  type="button"
                  onClick={() => handleSelectLocation(location)}
                  className="w-full px-3 py-2 text-left hover:bg-accent transition-colors flex items-start gap-2"
                >
                  <MapPin className="size-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {formatLocation(location)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {location.display_name}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

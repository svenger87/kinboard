"use client";

import { useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

interface ShortcutConfig {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  action: () => void;
  description: string;
}

/**
 * Hook for global keyboard shortcuts
 * Provides navigation shortcuts and custom action bindings
 */
export function useKeyboardShortcuts(customShortcuts: ShortcutConfig[] = []) {
  const router = useRouter();

  // Default navigation shortcuts (Alt + key) - memoized to keep stable references
  const navigationShortcuts = useMemo<ShortcutConfig[]>(() => [
    { key: "h", altKey: true, action: () => router.push("/"), description: "Home / Dashboard" },
    { key: "c", altKey: true, action: () => router.push("/calendar"), description: "Kalender" },
    { key: "t", altKey: true, action: () => router.push("/todos"), description: "Aufgaben" },
    { key: "e", altKey: true, action: () => router.push("/shopping"), description: "Einkauf" },
    { key: "b", altKey: true, action: () => router.push("/birthdays"), description: "Geburtstage" },
    { key: "s", altKey: true, action: () => router.push("/settings"), description: "Einstellungen" },
  ], [router]);

  const allShortcuts = useMemo(() => [...navigationShortcuts, ...customShortcuts], [navigationShortcuts, customShortcuts]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of allShortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrlKey ? event.ctrlKey : !event.ctrlKey;
        const altMatch = shortcut.altKey ? event.altKey : !event.altKey;
        const shiftMatch = shortcut.shiftKey ? event.shiftKey : !event.shiftKey;

        if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [allShortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts: allShortcuts };
}

/**
 * Hook to show keyboard shortcuts help dialog
 */
export function useShortcutsHelp() {
  const defaultShortcuts = [
    { keys: "Alt + H", description: "Home / Dashboard" },
    { keys: "Alt + C", description: "Kalender" },
    { keys: "Alt + T", description: "Aufgaben" },
    { keys: "Alt + E", description: "Einkauf" },
    { keys: "Alt + B", description: "Geburtstage" },
    { keys: "Alt + S", description: "Einstellungen" },
    { keys: "Tab", description: "Nächstes Element" },
    { keys: "Shift + Tab", description: "Vorheriges Element" },
    { keys: "Enter / Space", description: "Aktivieren" },
    { keys: "Escape", description: "Schließen / Abbrechen" },
  ];

  return { shortcuts: defaultShortcuts };
}

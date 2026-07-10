"use client";

import { useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  // Note: descriptions below are internal matcher-only strings, never rendered to users
  const navigationShortcuts = useMemo<ShortcutConfig[]>(() => [
    { key: "h", altKey: true, action: () => router.push("/"), description: "Home" },
    { key: "c", altKey: true, action: () => router.push("/calendar"), description: "Calendar" },
    { key: "t", altKey: true, action: () => router.push("/todos"), description: "Tasks" },
    { key: "e", altKey: true, action: () => router.push("/shopping"), description: "Shopping" },
    { key: "b", altKey: true, action: () => router.push("/birthdays"), description: "Birthdays" },
    { key: "s", altKey: true, action: () => router.push("/settings"), description: "Settings" },
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
  const t = useTranslations("components.shortcuts");
  const shortcuts = [
    { keys: "Alt + H", description: t("navHome") },
    { keys: "Alt + C", description: t("navCalendar") },
    { keys: "Alt + T", description: t("navTodos") },
    { keys: "Alt + E", description: t("navShopping") },
    { keys: "Alt + B", description: t("navBirthdays") },
    { keys: "Alt + S", description: t("navSettings") },
    { keys: "Tab", description: t("nextElement") },
    { keys: "Shift + Tab", description: t("prevElement") },
    { keys: "Enter / Space", description: t("activate") },
    { keys: "Escape", description: t("close") },
  ];
  return { shortcuts };
}

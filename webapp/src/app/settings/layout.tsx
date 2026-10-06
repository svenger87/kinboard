"use client";

import { PinGuard } from "@/components/pin-guard";
import { useSettingsAnchor } from "@/hooks/use-settings-anchor";

/** Inside the guard, so a locked screen does not scroll to anything. */
function SettingsAnchors() {
  useSettingsAnchor();
  return null;
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PinGuard cancelHref="/">
      <SettingsAnchors />
      <div className="settings-safe-area-top min-h-page relative">
        <div className="page-gradient fixed inset-0 pointer-events-none z-[-1]" />
        {children}
      </div>
    </PinGuard>
  );
}

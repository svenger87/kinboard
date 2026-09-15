"use client";

import { PinGuard } from "@/components/pin-guard";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PinGuard cancelHref="/">
      <div className="settings-safe-area-top min-h-page relative">
        <div className="page-gradient fixed inset-0 pointer-events-none z-[-1]" />
        {children}
      </div>
    </PinGuard>
  );
}

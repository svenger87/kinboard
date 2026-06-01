"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSetupState } from "@/hooks";

export default function SetupRootPage() {
  const router = useRouter();
  const { data: state, isLoading } = useSetupState();

  useEffect(() => {
    if (isLoading || !state) return;
    // Send the user to the first incomplete step. Skipping is fine —
    // the user comes back here via the dashboard banner; we always
    // route forward, never back.
    if (!state.has_people) router.replace("/setup/people");
    else if (!state.has_calendar) router.replace("/setup/calendar");
    else if (!state.has_home_assistant) router.replace("/setup/homeassistant");
    else if (!state.has_weather_location) router.replace("/setup/weather");
    else router.replace("/setup/done");
  }, [isLoading, state, router]);

  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

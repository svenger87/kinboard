"use client";

import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutTemplate } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutEditor } from "@/components/layouts/editor/layout-editor";
import { LayoutUnusedNotice } from "@/components/layouts/layout-unused-notice";
import { useLayoutDefaults, useLayouts } from "@/hooks/use-layouts";
import { useDevices } from "@/hooks/use-supabase-queries";

/**
 * The editor of one layout's screensaver (Settings → Layouts → a layout).
 * Behind the settings PIN with the rest of Settings.
 */
export default function LayoutEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("settings.layouts.editor");
  const { data: layouts, isLoading, isFetching, error, refetch } = useLayouts();
  const layout = layouts?.find((l) => l.id === id);
  // The "no screen shows it" notice needs these; waiting for them keeps it from pushing the canvas down mid-drag.
  const devices = useDevices();
  const defaults = useLayoutDefaults();
  const usageLoading = (devices.isLoading && !devices.error) || (defaults.isLoading && !defaults.error);
  // A reload after someone else's save starts the editor over from the server's copy.
  const [generation, setGeneration] = useState(0);

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 mx-auto max-w-[1600px]">
        <PageHeader
          icon={LayoutTemplate}
          title={layout?.name ?? t("title")}
          subtitle={layout ? t("subtitle", { width: layout.width, height: layout.height }) : undefined}
          className="mb-6"
        />
        {/* A copy just made may not be in the list yet: wait for the refetch rather than say "not found". */}
        {isLoading || usageLoading || (!layouts && !error) || (!layout && isFetching) ? (
          <Skeleton className="h-[60vh] w-full rounded-xl" />
        ) : !layout ? (
          <p className="text-sm text-muted-foreground" data-testid="editor-not-found">
            {error ? t("loadFailed") : t("notFound")}
          </p>
        ) : (
          <>
          <LayoutUnusedNotice layout={layout} />
          <LayoutEditor
            key={`${layout.id}:${generation}`}
            layout={layout}
            onReload={async () => {
              await refetch();
              setGeneration((g) => g + 1);
            }}
          />
          </>
        )}
      </div>
    </main>
  );
}

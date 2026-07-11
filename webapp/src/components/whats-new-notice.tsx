"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { useVersionCheck } from "@/hooks/use-version-check";
import { WhatsNewDialog } from "@/components/whats-new-dialog";

const LAST_SEEN_VERSION_KEY = "kinboard_last_seen_version";

/**
 * Mounted once at the providers level (next to the Toaster). Watches the
 * running app version and, once per version change, shows a toast pointing
 * at the release notes. Never fires on the very first run (no stored
 * baseline yet) — only once a previously-seen version differs from current.
 */
export function WhatsNewNotice() {
  const t = useTranslations("components.whatsNew");
  const { data: version } = useVersionCheck();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!version?.current) return;
    const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);

    // Write-on-detect (not write-on-view): the localStorage value updates as
    // soon as we notice a version change, regardless of whether the toast is
    // ever seen/dismissed. Otherwise a toast that's missed would re-fire on
    // every reload instead of just once.
    if (lastSeen && lastSeen !== version.current) {
      toast(t("updatedToast", { version: version.current }), {
        action: {
          label: t("whatsNewAction"),
          onClick: () => setOpen(true),
        },
        duration: 12000,
        icon: <Sparkles className="size-4" />,
      });
    }

    if (lastSeen !== version.current) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, version.current);
    }
  }, [version, t]);

  return <WhatsNewDialog open={open} onOpenChange={setOpen} />;
}

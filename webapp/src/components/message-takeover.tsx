"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBoardMessage, useAcknowledgeMessage } from "@/hooks/use-messages";

export function MessageTakeover() {
  const t = useTranslations("messages");
  const shown = useBoardMessage();
  const acknowledge = useAcknowledgeMessage();

  // A deep link to an already-acknowledged message (RFC-005 §3.3): there is
  // nothing left to acknowledge, so "Close" only has to hide the panel on
  // this screen. Keyed by id rather than a bare boolean so a different
  // message arriving afterwards is not born pre-closed.
  const [closedId, setClosedId] = useState<string | null>(null);

  if (!shown || shown.id === closedId) return null;

  const alreadySeen = Boolean(shown.acknowledged_at);

  return (
    <Card
      data-message-takeover
      className="mb-4 flex items-center gap-4 border-month-primary/40 bg-month-primary/5 p-5"
    >
      <span className="icon-badge">
        <MessageSquare className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-2xl leading-tight">{shown.body}</p>
        {alreadySeen && (
          <p className="mt-1 text-sm text-muted-foreground">{t("alreadySeen")}</p>
        )}
      </div>
      {alreadySeen ? (
        <Button
          variant="outline"
          className="min-h-[44px] gap-2"
          onClick={() => setClosedId(shown.id)}
        >
          <X className="size-4" />
          {t("close")}
        </Button>
      ) : (
        <Button
          className="min-h-[44px] gap-2"
          onClick={() => acknowledge.mutate(shown.id)}
        >
          <Check className="size-4" />
          {t("gotIt")}
        </Button>
      )}
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMessages, useTakeoverMessage, useAcknowledgeMessage } from "@/hooks/use-messages";
import type { Message } from "@/types/database";

/**
 * Read `?message=<id>` once, on mount, from the URL itself.
 *
 * Deliberately not `useSearchParams`: that pulls the dashboard into a Suspense
 * boundary requirement at build time, and this needs one value once. A
 * notification click navigates an existing window (sw.js), which remounts the
 * page, so once is enough.
 */
function useRequestedMessageId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("message"));
  }, []);
  return id;
}

export function MessageTakeover() {
  const t = useTranslations("messages");
  const takeover = useTakeoverMessage();
  const { data: messages = [] } = useMessages();
  const acknowledge = useAcknowledgeMessage();
  const requestedId = useRequestedMessageId();

  /*
    Somebody tapped a notification about a particular message. Show that one,
    even if its minute has passed — showing them the dashboard with no
    explanation would be worse. RFC-005 §3.3.

    An already-acknowledged message is not in this list at all (the route
    returns only unacknowledged ones), so the deep link then falls through to
    whatever else is demanding attention, or to nothing. That is the honest
    outcome: somebody dealt with it between the push and the tap.
  */
  const requested = requestedId ? messages.find((m) => m.id === requestedId) : undefined;
  const shown: Message | null = requested ?? takeover;
  if (!shown) return null;

  return (
    <Card
      data-message-takeover
      className="mb-4 flex items-center gap-4 border-month-primary/40 bg-month-primary/5 p-5"
    >
      <span className="icon-badge">
        <MessageSquare className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="min-w-0 flex-1 font-display text-2xl leading-tight">{shown.body}</p>
      <Button
        className="min-h-[44px] gap-2"
        onClick={() => acknowledge.mutate(shown.id)}
      >
        <Check className="size-4" />
        {t("gotIt")}
      </Button>
    </Card>
  );
}

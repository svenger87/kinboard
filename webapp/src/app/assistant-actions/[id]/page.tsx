"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionHeadline, AssistantActionCard, useTickingServerNow } from "@/components/assistant-action-prompt";
import { useAssistantAction } from "@/hooks/use-assistant-actions";
import type { ScreenRequest } from "@/lib/home/action-requests";
import { newerRequest, secondsLeft, statusMessageKey } from "@/lib/home/action-prompt";

/**
 * One assistant request — where the push notification lands (RFC-011 §4.3).
 *
 * While it is pending and has time left, the same card as on the dashboard;
 * afterwards, what became of it, so a phone that opens the notification late
 * learns that the door was (or was not) unlocked rather than seeing nothing.
 */
export default function AssistantActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("assistantActions");
  const { data, isPending, isError } = useAssistantAction(id);
  const [decided, setDecided] = useState<ScreenRequest | null>(null);
  // The decision's own answer until the poll has caught up with it, then the poll.
  const request = newerRequest(data, decided);
  const now = useTickingServerNow(request?.status === "pending");

  let body: React.ReactNode;
  if (isPending) {
    body = <Skeleton className="h-48 w-full" aria-label={t("loading")} />;
  } else if (isError || !request) {
    body = <Card className="p-6">{t(isError ? "errors.generic" : "errors.not_found")}</Card>;
  } else if (request.status === "pending" && secondsLeft(request.expires_at, now) > 0) {
    body = <AssistantActionCard request={request} now={now} onDecided={setDecided} />;
  } else {
    // A pending row whose time ran out on this screen is expired, whatever the server has written yet.
    const key = request.status === "pending" ? "status.expired" : statusMessageKey(request);
    body = (
      <Card className="space-y-2 p-6">
        <ActionHeadline request={request} className="font-display text-xl leading-tight" />
        <p role="status" className="text-muted-foreground">{t(key)}</p>
      </Card>
    );
  }

  return (
    <main id="main-content" className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
      {body}
      <Link href="/" className="text-sm underline underline-offset-4">{t("backToDashboard")}</Link>
    </main>
  );
}

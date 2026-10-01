"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeAction, type ActionTranslator, type ScreenRequest } from "@/lib/home/action-requests";
import { canDecide, decisionErrorKey, secondsLeft, visibleRequests } from "@/lib/home/action-prompt";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "@/hooks/use-server-clock";
import {
  DecisionError,
  useDecideAssistantAction,
  usePendingAssistantActions,
} from "@/hooks/use-assistant-actions";

/** The server-corrected time, ticking once a second while `active`. */
export function useTickingServerNow(active: boolean): Date {
  const offset = useServerClockOffset();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return applyOffset(now, offset);
}

/**
 * One request: who wants to do what, a countdown, the settings PIN and
 * Allow / Deny. Shared by the dashboard prompt and the deep-link page.
 */
export function AssistantActionCard({
  request,
  now,
  onDecided,
}: {
  request: ScreenRequest;
  now: Date;
  onDecided?: (request: ScreenRequest) => void;
}) {
  const t = useTranslations("assistantActions");
  const decide = useDecideAssistantAction();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remaining = secondsLeft(request.expires_at, now);
  const enabled = canDecide(pin, decide.isPending, remaining);
  const inputId = `assistant-action-pin-${request.id}`;

  function submit(decision: "approve" | "deny") {
    if (!enabled) return;
    setError(null);
    decide.mutate(
      { id: request.id, decision, pin },
      {
        onSuccess: (decided) => {
          setPin("");
          onDecided?.(decided);
        },
        onError: (err) => {
          setPin("");
          const code = err instanceof DecisionError ? err.code : "generic";
          setError(t(decisionErrorKey(code)));
          if (err instanceof DecisionError && err.request) onDecided?.(err.request);
        },
      },
    );
  }

  return (
    <Card
      data-assistant-action={request.id}
      role="alertdialog"
      aria-labelledby={`${inputId}-title`}
      className="mb-4 space-y-4 border-amber-500/50 bg-amber-500/5 p-5"
    >
      <div className="flex items-start gap-4">
        <span className="icon-badge">
          <ShieldQuestion className="size-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{t("title")}</p>
          <p id={`${inputId}-title`} className="font-display text-2xl leading-tight">
            {describeAction(t as unknown as ActionTranslator, request)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>
        </div>
        <p className="shrink-0 text-sm tabular-nums text-muted-foreground" aria-live="off">
          {t("expiresIn", { seconds: remaining })}
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit("approve");
        }}
      >
        <div className="min-w-[8rem]">
          <Label htmlFor={inputId}>{t("pinLabel")}</Label>
          <Input
            id={inputId}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={!enabled} onClick={() => submit("deny")}>
            {t("deny")}
          </Button>
          <Button type="submit" className="min-h-[44px]" disabled={!enabled}>
            {decide.isPending ? t("working") : t("allow")}
          </Button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

/**
 * Every pending assistant request, on the dashboard, above everything else
 * (RFC-011 §4.3). Renders nothing when nobody is waiting, which is almost
 * always. Not tied to the messages widget's visibility: a screen that does
 * not show messages can still be the one somebody is standing at when the
 * front door asks to be unlocked.
 */
export function AssistantActionPrompt() {
  const requests = usePendingAssistantActions();
  const now = useTickingServerNow(requests.length > 0);
  const visible = visibleRequests(requests, now);
  if (visible.length === 0) return null;
  return (
    <div aria-live="polite">
      {visible.map((r) => <AssistantActionCard key={r.id} request={r} now={now} />)}
    </div>
  );
}

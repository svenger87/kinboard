"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientLabel, type ScreenRequest } from "@/lib/home/action-requests";
import {
  canApprove, canDeny, decisionErrorKey, isFinalError, outcomeNoticeKey, secondsLeft, visibleRequests,
} from "@/lib/home/action-prompt";
import { useAssistantActionNotices } from "@/stores/assistant-action-notices";
import { applyOffset } from "@/lib/server-clock";
import { useServerClockOffset } from "@/hooks/use-server-clock";
import {
  DecisionError,
  useDecideAssistantAction,
  usePendingAssistantActions,
} from "@/hooks/use-assistant-actions";

/**
 * "[Claude] wants to unlock Front door". The assistant's name is whatever it
 * registered itself as, so it is cut to 40 characters and set apart as a
 * label — not running text a crafted name could turn into an instruction.
 * What it wants is the server's `description`, in this screen's language,
 * for every kind of request — the screen never builds it from the fields.
 */
export function ActionHeadline({
  request,
  id,
  className,
}: {
  request: ScreenRequest;
  id?: string;
  className: string;
}) {
  const t = useTranslations("assistantActions");
  const label = clientLabel(request.client_name);
  return (
    <p id={id} className={className}>
      <span
        data-assistant-client
        title={request.client_name.length > label.length ? request.client_name.slice(0, 200) : undefined}
        className="mr-2 inline-block max-w-full truncate rounded-md border border-border bg-muted px-2 py-0.5 align-middle font-sans text-sm font-medium"
      >
        {label}
      </span>
      {t("wantsTo", { action: request.description })}
    </p>
  );
}

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
 * Allow / Deny. Shared by the overlay prompt and the deep-link page.
 *
 * Allow needs the PIN; Deny does not (anyone at a screen may stop it), and
 * Enter in the PIN field only ever allows. `onFinalError` hands an error that
 * ends the request (expired, already answered, outcome unknown, …) to the
 * parent, because this card disappears with the request and its message must
 * not disappear with it. `onDecided` gets the decided request, and — when
 * this screen's own decision succeeded — which decision it was.
 */
export function AssistantActionCard({
  request,
  now,
  onDecided,
  onFinalError,
}: {
  request: ScreenRequest;
  now: Date;
  onDecided?: (request: ScreenRequest, decision?: "approve" | "deny") => void;
  onFinalError?: (request: ScreenRequest, messageKey: string) => void;
}) {
  const t = useTranslations("assistantActions");
  const decide = useDecideAssistantAction();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remaining = secondsLeft(request.expires_at, now);
  const approveEnabled = canApprove(pin, decide.isPending, remaining);
  const denyEnabled = canDeny(decide.isPending, remaining);
  const inputId = `assistant-action-pin-${request.id}`;

  function submit(decision: "approve" | "deny") {
    if (decision === "approve" ? !approveEnabled : !denyEnabled) return;
    setError(null);
    decide.mutate(
      decision === "approve" ? { id: request.id, decision, pin } : { id: request.id, decision },
      {
        onSuccess: (decided) => {
          setPin("");
          onDecided?.(decided, decision);
        },
        onError: (err) => {
          setPin("");
          const code = err instanceof DecisionError ? err.code : "network";
          const messageKey = decisionErrorKey(code, decision);
          setError(t(messageKey));
          if (isFinalError(code, decision)) onFinalError?.(request, messageKey);
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
      className="space-y-4 border-amber-500/50 bg-background p-5 elev-lg"
    >
      <div className="flex items-start gap-4">
        <span className="icon-badge">
          <ShieldQuestion className="size-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{t("title")}</p>
          <ActionHeadline request={request} id={`${inputId}-title`} className="font-display text-2xl leading-tight" />
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
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={!denyEnabled} onClick={() => submit("deny")}>
            {t("deny")}
          </Button>
          <Button type="submit" className="min-h-[44px]" disabled={!approveEnabled}>
            {decide.isPending ? t("working") : t("allow")}
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">{t("denyHint")}</p>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

/**
 * Every pending assistant request, over whatever page is showing (RFC-011
 * §4.3) — mounted once for the whole app inside the authenticated shell, so
 * the person standing at any screen sees it. Renders nothing when nobody is
 * waiting, which is almost always. After Allow, the outcome — done, didn't
 * work, or unknown and "check the device" — stays on screen until someone
 * closes it, as does an error that ended a request; while it does, the
 * screensaver stays off (lib/screensaver-gate.ts).
 */
export function AssistantActionPrompt() {
  const t = useTranslations("assistantActions");
  const requests = usePendingAssistantActions();
  const notices = useAssistantActionNotices((s) => s.notices);
  const showNotice = useAssistantActionNotices((s) => s.show);
  const dismiss = useAssistantActionNotices((s) => s.dismiss);
  const now = useTickingServerNow(requests.length > 0);
  const noticeIds = new Set(notices.map((n) => n.request.id));
  const visible = visibleRequests(requests, now).filter((r) => !noticeIds.has(r.id));
  if (visible.length === 0 && notices.length === 0) return null;
  return (
    <div
      data-testid="assistant-action-overlay"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[90] mx-auto flex max-h-[80dvh] w-full max-w-2xl flex-col gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {notices.map(({ request, messageKey }) => (
        <Card key={`notice-${request.id}`} data-assistant-action-notice={request.id} className="space-y-3 bg-background p-5 elev-lg">
          <ActionHeadline request={request} className="font-display text-xl leading-tight" />
          <p role="alert" className="text-sm">{t(messageKey)}</p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="min-h-[44px]"
              onClick={() => dismiss(request.id)}
            >
              {t("close")}
            </Button>
          </div>
        </Card>
      ))}
      {visible.map((r) => (
        <AssistantActionCard
          key={r.id}
          request={r}
          now={now}
          onDecided={(decided, decision) => {
            if (decision !== "approve") return;
            const messageKey = outcomeNoticeKey(decided);
            if (messageKey) showNotice({ request: decided, messageKey });
          }}
          onFinalError={(request, messageKey) => showNotice({ request, messageKey })}
        />
      ))}
    </div>
  );
}

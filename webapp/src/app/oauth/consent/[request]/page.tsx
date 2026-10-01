"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface ConsentDetails {
  clientName: string;
  /** True for a client identified by a metadata document on its own host (CIMD); false for a self-registered (DCR) one. */
  verified: boolean;
  clientHost: string | null;
  redirectHost: string;
  loopbackOnly: boolean;
  scopes: string[];
  pinSet: boolean;
}

const PIN_DIGITS = /^\d{4}$/;

/**
 * The one screen that hands a family's data to an assistant (RFC-010 §3.5).
 * Behind AuthGuard, so the browser is a joined device; the PIN is checked on
 * the server, and is mandatory to approve (controller Ruling 1, amendment to
 * Task 7): a family with no PIN yet sets its first one right here, in the
 * same request. The redirect host is shown because the MCP spec requires it
 * — it is what tells a user that "Claude" is really claude.ai.
 */
export default function ConsentPage({ params }: { params: Promise<{ request: string }> }) {
  const { request } = use(params);
  const t = useTranslations("oauthConsent");
  const [granted, setGranted] = useState<string[] | null>(null);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isPending, isError, error: loadError } = useQuery({
    queryKey: ["oauth-consent", request],
    queryFn: async () => {
      const r = await fetch(`/api/oauth/consent?request=${encodeURIComponent(request)}`);
      // The server's error code is the message, so the page can tell
      // "assistants are switched off" from "this request is gone".
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? String(r.status));
      return (await r.json()) as ConsentDetails;
    },
    retry: false,
  });
  const selected = granted ?? data?.scopes ?? [];
  const settingNewPin = data ? !data.pinSet : false;
  const newPinsValid = PIN_DIGITS.test(newPin) && PIN_DIGITS.test(confirmPin);
  const existingPinValid = PIN_DIGITS.test(pin);

  async function decide(decision: "approve" | "deny") {
    if (decision === "approve" && settingNewPin) {
      if (!newPinsValid) return;
      if (newPin !== confirmPin) {
        setError(t("pinMismatch"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request,
          decision,
          scopes: selected,
          ...(settingNewPin ? { newPin } : { pin }),
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (body.redirect) {
        // Stay busy: the browser is about to leave for the client's redirect
        // URI, and resetting here would let a second click race a second
        // request against a request that is about to be gone either way.
        window.location.assign(body.redirect);
        return;
      }
      setError(
        body.error === "pin_invalid" ? t("pinInvalid")
          : body.error === "rate_limited" ? t("rateLimited")
          : body.error === "no_scopes" ? t("noScopes")
          : body.error === "new_pin_invalid" ? t("newPinInvalid")
          : body.error === "pin_changed" ? t("pinChanged")
          : body.error === "assistants_disabled" ? t("assistantsDisabled")
          : body.error === "not_found" ? t("expired")
          : t("failed"),
      );
      setBusy(false);
    } catch {
      setError(t("failed"));
      setBusy(false);
    }
  }

  if (isPending) return <main className="mx-auto max-w-lg p-4"><Skeleton className="h-64 w-full" /></main>;
  if (isError || !data) {
    const message = loadError?.message === "assistants_disabled" ? t("assistantsDisabled") : t("expired");
    return <main className="mx-auto max-w-lg p-4"><Card className="p-6">{message}</Card></main>;
  }

  const approveDisabled =
    busy || selected.length === 0 || (settingNewPin ? !newPinsValid : !existingPinValid);

  return (
    <main className="mx-auto max-w-lg p-4">
      <Card className="space-y-5 p-6">
        <h1 className="text-xl font-semibold">{t("title", { client: data.clientName })}</h1>
        {/* The MCP spec asks the consent screen to show who is really asking.
            A self-registered name is just a string anyone could send. */}
        {data.verified && data.clientHost ? (
          <p className="text-sm text-muted-foreground">{t("verifiedBy", { host: data.clientHost })}</p>
        ) : (
          <p className="rounded-md bg-amber-500/10 p-3 text-sm">{t("selfRegisteredWarning", { client: data.clientName })}</p>
        )}
        <p className="text-sm text-muted-foreground">{t("intro", { client: data.clientName, host: data.redirectHost })}</p>
        {data.loopbackOnly && <p className="rounded-md bg-amber-500/10 p-3 text-sm">{t("loopbackWarning")}</p>}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{t("scopesHeading")}</legend>
          {data.scopes.map((scope) => (
            <div key={scope} className="flex items-center gap-2">
              <Checkbox
                id={`scope-${scope}`}
                checked={selected.includes(scope)}
                onCheckedChange={() =>
                  setGranted(selected.includes(scope) ? selected.filter((s) => s !== scope) : [...selected, scope])
                }
              />
              <Label htmlFor={`scope-${scope}`} className="font-normal">{t(`scope_${scope.replace(":", "_")}`)}</Label>
            </div>
          ))}
        </fieldset>

        {settingNewPin ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("setPinIntro")}</p>
            <div>
              <Label htmlFor="consent-new-pin">{t("newPinLabel")}</Label>
              <Input
                id="consent-new-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="consent-confirm-pin">{t("confirmPinLabel")}</Label>
              <Input
                id="consent-confirm-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="consent-pin">{t("pinLabel")}</Label>
            <Input id="consent-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void decide("deny")}>{t("deny")}</Button>
          <Button disabled={approveDisabled} onClick={() => void decide("approve")}>{t("approve")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("revokeHint")}</p>
      </Card>
    </main>
  );
}

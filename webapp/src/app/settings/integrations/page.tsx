"use client";

import { useState, useEffect } from "react";
import { KeyRound, Copy, Check, Ban, Bot, ShieldCheck } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDestructive } from "@/components/confirm-destructive";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { isPinRequired, relockSettings } from "@/lib/pin-session";

interface TokenRow {
  id: string;
  name: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  oauth_client_id: string | null;
  /** "Trust this assistant": when it was switched on, or null. */
  trusted_at?: string | null;
}

/** What the trust route's refusals mean, as the key of their words. */
const TRUST_ERRORS: Record<string, string> = {
  pin_invalid: "trustPinInvalid",
  rate_limited: "trustRateLimited",
  pin_required: "trustPinRequired",
};

/**
 * Integration tokens — the credentials Home Assistant (and later the Bridge)
 * use to talk to this Kinboard.
 *
 * The whole screen is arranged around one fact: the token is shown **once**.
 * It is stored only as a hash, so it cannot be shown again, and a screen that
 * lets someone navigate away from it without noticing is a screen that
 * generates support questions. Hence the panel that stays until it is
 * explicitly dismissed, and the copy button next to it.
 */
export default function IntegrationsPage() {
  const t = useTranslations("settings.integrations");
  const locale = useLocale();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["family:read"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("/api/mcp");

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
  }, []);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["integration-tokens"],
    queryFn: async () => {
      const r = await fetch("/api/integration-tokens");
      if (!r.ok) throw new Error(`integration-tokens: ${r.status}`);
      return (await r.json()) as { tokens: TokenRow[]; scopes: string[] };
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/integration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      // The server wants the PIN again (RFC-010 §3.5): PinGuard re-prompts
      // and says why, so this is not an error to toast as well.
      if (await isPinRequired(r)) {
        relockSettings();
        return null;
      }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return (await r.json()) as { secret: string };
    },
    onSuccess: (result) => {
      if (!result) return;
      setSecret(result.secret);
      setName("");
      void qc.invalidateQueries({ queryKey: ["integration-tokens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch("/api/integration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id }),
      });
      if (await isPinRequired(r)) {
        relockSettings();
        return false;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success(t("revoked"));
      void qc.invalidateQueries({ queryKey: ["integration-tokens"] });
    },
    onError: () => toast.error(t("revokeFailed")),
  });

  // "Trust this assistant", per assistant connection. On asks for the
  // settings PIN in a dialog that says plainly what it means; the server
  // checks the PIN (lib/assistant-trust.ts). Off needs nothing.
  const [trusting, setTrusting] = useState<TokenRow | null>(null);
  const [trustPin, setTrustPin] = useState("");
  const [trustError, setTrustError] = useState<string | null>(null);

  const setTrust = useMutation({
    mutationFn: async (input: { token: TokenRow; trusted: boolean; pin?: string }) => {
      const r = await fetch(`/api/assistants/${input.token.id}/trust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.trusted ? { trusted: true, pin: input.pin } : { trusted: false }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(TRUST_ERRORS[body.error ?? ""] ?? "trustFailed");
      return input;
    },
    onSuccess: (input) => {
      toast.success(t(input.trusted ? "trustOn" : "trustOff", { name: input.token.name }));
      setTrusting(null);
      setTrustPin("");
      setTrustError(null);
      void qc.invalidateQueries({ queryKey: ["integration-tokens"] });
    },
    onError: (e: Error, input) => {
      setTrustPin("");
      if (input.trusted) setTrustError(t(e.message));
      else toast.error(t(e.message));
    },
  });

  const openTrust = (token: TokenRow) => {
    setTrustPin("");
    setTrustError(null);
    setTrusting(token);
  };

  // "Allow AI assistants" (RFC-010), off by default. While it is off the
  // OAuth and MCP routes answer 404, so the address below would only lead
  // to an error — it is hidden rather than offered.
  const assistants = useQuery({
    queryKey: ["assistants-enabled"],
    queryFn: async () => {
      const r = await fetch("/api/assistants");
      if (!r.ok) throw new Error(`assistants: ${r.status}`);
      return (await r.json()) as { enabled: boolean };
    },
  });
  const assistantsEnabled = assistants.data?.enabled === true;

  const setAssistants = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await fetch("/api/assistants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (await isPinRequired(r)) {
        relockSettings();
        return null;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { enabled: boolean };
    },
    onSuccess: (result) => {
      if (!result) return;
      qc.setQueryData(["assistants-enabled"], result);
      // Switching off revoked every assistant connection; show that.
      void qc.invalidateQueries({ queryKey: ["integration-tokens"] });
    },
    onError: () => toast.error(t("assistantsToggleFailed")),
  });

  const toggleScope = (scope: string) =>
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const copyMcpUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" }) : "—";

  return (
    // The shared settings shell. This page used its own wrapper, which had no
    // consistent heading clearance or safe-area padding on a tablet. The
    // wider max-w-3xl column is kept —
    // it holds a table of tokens — but the frame is the common one.
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 mx-auto w-full max-w-3xl">
      <PageHeader icon={KeyRound} title={t("title")} subtitle={t("subtitle")} className="mb-8" />

      {/* Shown once. Deliberately not a toast: a toast disappears on its own,
          and this is the only moment the value exists. */}
      {secret && (
        <Card className="mb-8 border-primary p-6">
          <h2 className="mb-2 font-semibold">{t("secretHeading")}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t("secretWarning")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-sm">
              {secret}
            </code>
            <Button variant="outline" size="icon" onClick={copySecret} aria-label={t("copyAria")}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button className="mt-4" variant="outline" onClick={() => setSecret(null)}>
            {t("secretDismiss")}
          </Button>
        </Card>
      )}

      <Card id="assistants" data-setting="assistants" className="mb-8 p-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold">{t("assistantsHeading")}</h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="assistants-enabled" className="text-sm font-normal">{t("assistantsToggle")}</Label>
            <Switch
              id="assistants-enabled"
              checked={assistantsEnabled}
              disabled={assistants.isPending || assistants.isError || setAssistants.isPending}
              onCheckedChange={(v) => setAssistants.mutate(v)}
            />
          </div>
        </div>
        {assistantsEnabled ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{t("assistantsBody")}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-sm">{mcpUrl}</code>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("copyMcpUrl")}
                onClick={() => void copyMcpUrl()}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("assistantsReachability")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("assistantsOffHint")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("assistantsOff")}</p>
        )}
      </Card>

      <Card id="create-token" data-setting="create-token" className="mb-8 p-6">
        <h2 className="mb-4 font-semibold">{t("createHeading")}</h2>

        <div className="mb-4">
          <Label htmlFor="token-name">{t("nameLabel")}</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={100}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("nameHint")}</p>
        </div>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium">{t("scopesLabel")}</legend>
          <p className="mb-3 text-xs text-muted-foreground">{t("scopesHint")}</p>
          <div className="space-y-2">
            {(data?.scopes ?? []).map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <Checkbox
                  id={`scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onCheckedChange={() => toggleScope(scope)}
                />
                <Label htmlFor={`scope-${scope}`} className="font-normal">
                  <code className="text-xs">{scope}</code>
                </Label>
              </div>
            ))}
          </div>
        </fieldset>

        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || name.trim() === "" || scopes.length === 0}
        >
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </Card>

      <h2 id="tokens" data-setting="tokens" className="mb-4 font-semibold">{t("existingHeading")}</h2>

      {isPending && <Skeleton className="h-24 w-full" />}

      {isError && (
        <EmptyState
          icon={KeyRound}
          title={t("loadFailed")}
          action={{ label: t("retry"), onClick: () => void refetch() }}
        />
      )}

      {data && data.tokens.length === 0 && (
        <EmptyState icon={KeyRound} title={t("empty")} description={t("emptyHint")} />
      )}

      <div className="space-y-3">
        {(data?.tokens ?? []).map((token) => {
          const revoked = token.revoked_at !== null;
          return (
            <Card key={token.id} className={`p-4 ${revoked ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {token.name}
                    {revoked && (
                      <span className="ml-2 text-xs text-muted-foreground">{t("revokedBadge")}</span>
                    )}
                    {token.oauth_client_id && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        <Bot className="size-3" aria-hidden />
                        {t("assistantBadge")}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {(token.scopes ?? []).map((s) => (
                      <code key={s} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {s}
                      </code>
                    ))}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("created", { date: fmt(token.created_at) })}
                    {" · "}
                    {token.last_used_at
                      ? t("lastUsed", { date: fmt(token.last_used_at) })
                      : t("neverUsed")}
                  </p>
                  {token.oauth_client_id && !revoked && (
                    <div className="mt-3 flex flex-wrap items-center gap-2" data-assistant-trust={token.id}>
                      <Switch
                        id={`trust-${token.id}`}
                        checked={Boolean(token.trusted_at)}
                        disabled={setTrust.isPending}
                        onCheckedChange={(on) => (on ? openTrust(token) : setTrust.mutate({ token, trusted: false }))}
                      />
                      <Label htmlFor={`trust-${token.id}`} className="text-sm font-normal">{t("trustToggle")}</Label>
                      {token.trusted_at && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          <ShieldCheck className="size-3" aria-hidden />
                          {t("trustBadge")}
                        </span>
                      )}
                    </div>
                  )}
                  {token.oauth_client_id && !revoked && token.trusted_at && (
                    <p className="mt-1 text-xs text-muted-foreground">{t("trustOnHint")}</p>
                  )}
                </div>

                {!revoked && (
                  <ConfirmDestructive
                    title={t("revokeConfirmTitle")}
                    description={t("revokeConfirmBody", { name: token.name })}
                    confirmLabel={t("revoke")}
                    onConfirm={() => revoke.mutate(token.id)}
                  >
                    <Button variant="ghost" size="sm" aria-label={t("revokeAria", { name: token.name })}>
                      <Ban className="mr-1 size-4" />
                      {t("revoke")}
                    </Button>
                  </ConfirmDestructive>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={trusting !== null} onOpenChange={(open) => { if (!open && !setTrust.isPending) setTrusting(null); }}>
        <DialogContent data-trust-dialog className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("trustDialogTitle", { name: trusting?.name ?? "" })}</DialogTitle>
            <DialogDescription data-trust-warning>{t("trustWarning")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("trustNotice")}</p>
          <form
            id="trust-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (trusting && trustPin.length === 4) setTrust.mutate({ token: trusting, trusted: true, pin: trustPin });
            }}
          >
            <Label htmlFor="trust-pin">{t("trustPinLabel")}</Label>
            <Input
              id="trust-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={trustPin}
              onChange={(e) => setTrustPin(e.target.value.replace(/\D/g, ""))}
            />
            {trustError && <p role="alert" className="mt-2 text-sm text-destructive">{trustError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrusting(null)} disabled={setTrust.isPending}>
              {t("trustCancel")}
            </Button>
            <Button type="submit" form="trust-form" disabled={trustPin.length !== 4 || setTrust.isPending}>
              {t("trustConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </main>
  );
}

"use client";

import { useState } from "react";
import { KeyRound, Copy, Check, Ban } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDestructive } from "@/components/confirm-destructive";

interface TokenRow {
  id: string;
  name: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

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
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return (await r.json()) as { secret: string };
    },
    onSuccess: (result) => {
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
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      toast.success(t("revoked"));
      void qc.invalidateQueries({ queryKey: ["integration-tokens"] });
    },
    onError: () => toast.error(t("revokeFailed")),
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

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" }) : "—";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
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

      <Card className="mb-8 p-6">
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

      <h2 className="mb-4 font-semibold">{t("existingHeading")}</h2>

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
    </div>
  );
}

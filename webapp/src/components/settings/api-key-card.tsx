"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Key, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SecretField } from "@/components/settings/secret-field";
import {
  useApiKeys,
  useClearApiKey,
  useGeneratePresenceToken,
  useSaveApiKey,
} from "@/hooks/use-api-keys";
import type { ApiKeyName, ApiKeyStatus } from "@/lib/api-key-status";

export interface ApiKeyFieldSpec {
  /** The stored field (lib/api-key-status.ts API_KEY_FIELDS). */
  field: string;
  label: string;
  placeholder?: string;
  /** Typed as a password, with a show/hide eye. The Google client ID is not a secret. */
  secret?: boolean;
}

interface ApiKeyCardProps {
  name: ApiKeyName;
  title: string;
  /** What the key is for and where it comes from, with a link. */
  description: ReactNode;
  fields: ApiKeyFieldSpec[];
  /** What the household loses with no key at all, for the "not set" line. */
  noneNote?: string;
  /** Said under the form, e.g. that a new Google client means connecting again. */
  footnote?: string;
  /** The presence token's "New token" button. */
  generate?: boolean;
  id?: string;
}

function errorText(t: ReturnType<typeof useTranslations>, err: unknown): string | null {
  const code = err instanceof Error ? err.message : "";
  if (code === "pin_required") return null; // PinGuard re-prompts on its own
  if (code === "token_too_short") return t("tokenTooShort");
  if (code === "bad_value") return t("badValue");
  return t("saveFailed");
}

/**
 * One install key in Settings (RFC-023 §4.4): where the value in force comes
 * from (this family, the server's environment, or nowhere), a form to set the
 * family's own, and a way back to the server's. The stored value is never
 * shown; a masked hint is, so a household can tell which key it set.
 *
 * Saving and removing need the settings unlock on the server
 * (/api/settings/keys); a refusal puts the PIN screen back up.
 */
export function ApiKeyCard({ name, title, description, fields, noneNote, footnote, generate, id }: ApiKeyCardProps) {
  const t = useTranslations("settings.apiKeys");
  const { data: keys, isLoading, isError } = useApiKeys();
  const status: ApiKeyStatus | undefined = keys?.[name];
  const save = useSaveApiKey();
  const clear = useClearApiKey();
  const regenerate = useGeneratePresenceToken();
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const freshField = useRef<HTMLInputElement>(null);

  const complete = fields.every((f) => (values[f.field] ?? "").trim() !== "");
  const busy = save.isPending || clear.isPending || regenerate.isPending;

  const onSave = () => {
    save.mutate(
      { name, values },
      {
        onSuccess: () => {
          setValues({});
          setFresh(null);
          toast.success(t("savedToast"));
        },
        onError: (err) => {
          const text = errorText(t, err);
          if (text) toast.error(text);
        },
      },
    );
  };

  const onClear = () => {
    clear.mutate(name, {
      onSuccess: () => {
        setFresh(null);
        toast.success(t("removedToast"));
      },
      onError: (err) => {
        const text = errorText(t, err);
        if (text) toast.error(text);
      },
    });
  };

  const onGenerate = () => {
    setConfirmRegenerate(false);
    regenerate.mutate(undefined, {
      onSuccess: ({ token }) => {
        setFresh(token);
        setCopied(false);
      },
      onError: (err) => {
        const text = errorText(t, err);
        if (text) toast.error(text);
      },
    });
  };

  // Works on a plain-http LAN address too, where the Clipboard API is missing.
  const copyFresh = async () => {
    if (!fresh) return;
    let done = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fresh);
        done = true;
      }
    } catch {
      // fall through to selecting the field
    }
    if (!done && freshField.current) {
      freshField.current.focus();
      freshField.current.select();
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
    }
    if (done) setCopied(true);
  };

  const source = status?.source ?? "none";
  const badge =
    source === "family" ? (
      <Badge variant="success">{t("statusFamily")}</Badge>
    ) : source === "environment" ? (
      <Badge variant="neutral">{t("statusEnvironment")}</Badge>
    ) : (
      <Badge variant="warning">{t("statusNone")}</Badge>
    );

  return (
    <Card className="p-4 mb-6" id={id} data-testid={`api-key-${name}`}>
      <div className="flex gap-3">
        <Key className="size-5 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{title}</p>
            {isLoading || !status ? (
              isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <span data-testid={`api-key-${name}-status`} data-source={source}>
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

          {isError && !status && (
            <p className="text-xs text-destructive" data-testid={`api-key-${name}-note`}>
              {t("statusFailed")}
            </p>
          )}

          {!isLoading && status && (
            <p className="text-xs" data-testid={`api-key-${name}-note`}>
              {source === "family"
                ? status?.environment
                  ? t("noteFamilyOverEnvironment", { hint: status?.hint ?? "…" })
                  : t("noteFamily", { hint: status?.hint ?? "…" })
                : source === "environment"
                  ? t("noteEnvironment")
                  : (noneNote ?? t("noteNone"))}
            </p>
          )}

          {fresh && (
            <div className="space-y-2 rounded-md border border-success/30 bg-success/5 p-3" data-testid="presence-token-fresh">
              <p className="text-xs font-medium">{t("freshHeading")}</p>
              <div className="flex gap-2">
                <input
                  ref={freshField}
                  readOnly
                  value={fresh}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={t("freshHeading")}
                  data-testid="presence-token-value"
                  className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1.5 font-mono text-xs"
                />
                <Button type="button" variant="outline" size="sm" onClick={copyFresh}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  <span className="ml-1">{copied ? t("copied") : t("copy")}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("freshHint")}</p>
            </div>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (complete && !busy) onSave();
            }}
          >
            {fields.map((f) =>
              f.secret ? (
                <SecretField
                  key={f.field}
                  id={`api-key-${name}-${f.field}`}
                  label={f.label}
                  value={values[f.field] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.field]: v }))}
                  placeholder={f.placeholder}
                  showLabel={t("showKey")}
                  hideLabel={t("hideKey")}
                />
              ) : (
                <div key={f.field} className="flex flex-col gap-2">
                  <Label htmlFor={`api-key-${name}-${f.field}`}>{f.label}</Label>
                  <Input
                    id={`api-key-${name}-${f.field}`}
                    value={values[f.field] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.field]: e.target.value }))}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ),
            )}
            {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!complete || busy} data-testid={`api-key-${name}-save`}>
                {save.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
                {source === "family" ? t("replace") : t("save")}
              </Button>
              {generate && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  // Straight away only when it is known that no token is in force.
                  onClick={() => (status?.source === "none" ? onGenerate() : setConfirmRegenerate(true))}
                  data-testid={`api-key-${name}-generate`}
                >
                  {regenerate.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <RefreshCw className="size-4 mr-1" />}
                  {t("generate")}
                </Button>
              )}
              {source === "family" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={onClear}
                  data-testid={`api-key-${name}-clear`}
                >
                  {clear.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
                  {status?.environment ? t("removeToEnvironment") : t("remove")}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>

      {generate && (
        <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("generateConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("generateConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={onGenerate} data-testid={`api-key-${name}-generate-confirm`}>
                {t("generate")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

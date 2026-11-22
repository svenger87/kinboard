"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface GoogleRedirectHintProps {
  /** The redirect URI a Connect from this screen asks Google for. */
  redirectUri: string;
  /** It comes from GOOGLE_REDIRECT_URI rather than this screen's address. */
  fixed: boolean;
  /** Google lets a web client register it. */
  accepted: boolean;
}

/**
 * The one address Google Cloud Console needs, exactly as this install will
 * send it (#503). Copying works on a plain-http LAN address too, where the
 * Clipboard API is missing: the field is selected and copied the old way.
 */
export function GoogleRedirectHint({ redirectUri, fixed, accepted }: GoogleRedirectHintProps) {
  const t = useTranslations("settings.google");
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let done = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(redirectUri);
        done = true;
      }
    } catch {
      // fall through to selecting the field
    }
    if (!done && field.current) {
      field.current.focus();
      field.current.select();
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
    }
    if (done) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="p-4 mb-6" data-testid="google-redirect-hint">
      <div className="flex gap-3">
        <Link2 className="size-5 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-medium">{t("redirectHeading")}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{t("redirectBody")}</p>
          <div className="flex gap-2">
            <input
              ref={field}
              readOnly
              value={redirectUri}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("redirectHeading")}
              data-testid="google-redirect-uri"
              className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1.5 font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="ml-1">{copied ? t("redirectCopied") : t("redirectCopy")}</span>
            </Button>
          </div>
          {fixed && <p className="text-xs text-muted-foreground">{t("redirectFixed")}</p>}
          {!accepted && (
            <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid="google-redirect-unsupported">
              <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" strokeWidth={1.5} />
              <p className="text-xs leading-relaxed">{t("redirectUnsupported")}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

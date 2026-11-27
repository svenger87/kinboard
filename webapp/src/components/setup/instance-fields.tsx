"use client";

import { useTranslations } from "next-intl";
import { Database, Globe, BellRing } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InstanceValueSource } from "@/lib/first-run";

/**
 * The install's settings (RFC-024 §8) as the first-run steps and Settings →
 * This install show them. One place for the words, so both say the same.
 * Controlled: the parent saves, on Continue in the wizard and on Save in
 * Settings.
 */

interface FieldProps {
  value: string;
  onChange: (v: string) => void;
  /** Where the value in force comes from; "environment" makes the field read-only. */
  source: InstanceValueSource | undefined;
  /** The value in force when it comes from the environment. */
  inForce: string | null | undefined;
  invalid?: boolean;
  disabled?: boolean;
}

export function SiteAddressField({ value, onChange, source, inForce, invalid, disabled }: FieldProps) {
  const t = useTranslations("setup.install");
  return (
    <section className="space-y-3" data-testid="instance-address">
      <div className="flex items-start gap-3">
        <Globe className="size-5 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0 space-y-1">
          <Label htmlFor="instance-site-url" className="text-sm font-medium">
            {t("addressLabel")}
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed">{t("addressBody")}</p>
        </div>
      </div>
      {source === "environment" ? (
        <p className="text-xs rounded-md border bg-muted/40 p-3 break-all" data-testid="instance-address-env">
          {t("addressFromEnvironment", { value: inForce ?? "" })}
        </p>
      ) : (
        <>
          <Input
            id="instance-site-url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("addressPlaceholder")}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={invalid || undefined}
          />
          {invalid && (
            <p className="text-xs text-destructive" role="alert">
              {t("addressInvalid")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function PushContactField({ value, onChange, source, inForce, invalid, disabled }: FieldProps) {
  const t = useTranslations("setup.push");
  return (
    <section className="space-y-3" data-testid="instance-push-contact">
      <div className="flex items-start gap-3">
        <BellRing className="size-5 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
        <div className="min-w-0 space-y-1">
          <Label htmlFor="instance-push-contact" className="text-sm font-medium">
            {t("contactLabel")}
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed">{t("contactBody")}</p>
        </div>
      </div>
      {source === "environment" ? (
        <p className="text-xs rounded-md border bg-muted/40 p-3 break-all" data-testid="instance-push-contact-env">
          {t("contactFromEnvironment", { value: inForce ?? "" })}
        </p>
      ) : (
        <>
          <Input
            id="instance-push-contact"
            type="email"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("contactPlaceholder")}
            autoComplete="email"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={invalid || undefined}
          />
          {invalid && (
            <p className="text-xs text-destructive" role="alert">
              {t("contactInvalid")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Where the data is: the folder mapped to /data in the all-in-one image, DATA_DIR in a compose install. */
export function DataLocationNote({ aio }: { aio?: boolean }) {
  const t = useTranslations("setup.install");
  return (
    <section className="flex items-start gap-3" data-testid="instance-data-location">
      <Database className="size-5 shrink-0 text-primary mt-0.5" strokeWidth={1.5} />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{t("dataTitle")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t.rich(aio ? "dataBodyAio" : "dataBody", {
            code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">{chunks}</code>,
          })}
        </p>
      </div>
    </section>
  );
}

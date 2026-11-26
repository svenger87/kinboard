"use client";

import { FileWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { COMPOSE_FILE_URL, composeReleaseUrl, type ComposeRevisionStatus } from "@/lib/compose-revision";
import type { UpdateStatus } from "@/lib/update-status";

/**
 * Under the version in Settings, where "update available" is: the install's
 * compose.yml is older than this version of Kinboard needs (RFC-023 §4.6,
 * §4.11.3). Kinboard keeps running; the notice says which lines to change, or
 * to replace the file and keep the household's own settings.
 *
 * Shown only to the install's operator (the route decides) and only when the
 * file declares a revision, so a git install never sees it.
 */
export function ComposeRevisionNotice({ status }: { status: ComposeRevisionStatus | null | undefined }) {
  const t = useTranslations("settings.composeRevision");
  if (!status || !status.outdated) return null;

  const newest = status.changes.length > 0 ? status.changes[status.changes.length - 1].release : null;

  return (
    <div
      role="status"
      data-testid="compose-revision-notice"
      className="mx-auto mt-3 max-w-xl rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-foreground"
    >
      <div className="flex items-start gap-2">
        <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground">{t("body")}</p>
          <p className="text-muted-foreground">
            {t("revisions", { declared: status.declared, required: status.required })}
          </p>
          {status.changes.length > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground">{t("linesIntro")}</p>
              <ul className="space-y-2">
                {status.changes.map((c, i) => (
                  <li key={`${c.revision}-${c.id}-${i}`} data-testid="compose-revision-change">
                    <p>
                      {t(`changes.${c.id}`)}{" "}
                      <span className="text-muted-foreground">{t("inService", { service: c.service })}</span>
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-2xs leading-relaxed">
                      {c.from !== undefined && <span className="block text-red-700 dark:text-red-400">- {c.from}</span>}
                      {c.to !== undefined && <span className="block text-green-700 dark:text-green-400">+ {c.to}</span>}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {newest && (
              <a href={composeReleaseUrl(newest)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {t("whatChanged")}
              </a>
            )}
            <a href={COMPOSE_FILE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {t("currentFile")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

/** A version a release link can name: X.Y.Z, optionally with a pre-release. */
const RELEASE_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Under the version too: kinboard-updater found a newer release that needs a
 * newer compose file than the install runs, and applied nothing (RFC-023
 * §4.11.3). It updates images only, never the household's file, which may
 * hold their port and folders. The route sends the record only while the
 * install still runs the file revision it was held for, and only to the
 * install's operator.
 */
export function ComposeHoldNotice({ status }: { status: UpdateStatus | null | undefined }) {
  const t = useTranslations("settings.composeRevision");
  if (!status || status.status !== "held_compose") return null;
  const release = RELEASE_VERSION.exec(status.to)?.[1];

  return (
    <div
      role="status"
      data-testid="compose-hold-notice"
      className="mx-auto mt-3 max-w-xl rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-foreground"
    >
      <div className="flex items-start gap-2">
        <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-medium">{t("title")}</p>
          <p className="text-muted-foreground">
            {status.neededRevision
              ? t("heldBody", { version: status.to, needed: status.neededRevision, declared: status.fileRevision, current: status.from })
              : t("heldBodyUnknown", { version: status.to, declared: status.fileRevision, current: status.from })}
          </p>
          <p className="text-muted-foreground">{t("heldHow")}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {release && (
              <a href={composeReleaseUrl(release)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {t("whatChanged")}
              </a>
            )}
            <a href={COMPOSE_FILE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {t("currentFile")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

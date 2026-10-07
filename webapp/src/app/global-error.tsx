"use client";

import { useEffect, useRef, useState } from "react";
import {
  isChunkLoadError,
  noteStaleBundleRetry,
  recoverFromStaleBundle,
  staleBundleRetryDelayMs,
} from "@/lib/stale-bundle";

/**
 * This page replaces the root layout when rendering fails there, so there is
 * no next-intl provider and no `useTranslations` — which is why it was
 * written in hardcoded German and stayed that way while error.tsx and
 * not-found.tsx were translated. An English or French household saw German
 * at the one moment nothing else on screen could explain itself.
 *
 * A three-language table inline is the whole fix. It stays in step with
 * messages/*.json by being tiny: eight strings and a single `{seconds}`
 * placeholder, substituted by hand — there is no ICU formatter here either.
 */
const STRINGS = {
  en: {
    heading: "Something broke badly",
    fallback: "A serious error occurred. Please try again.",
    retry: "Try again",
    home: "Go to dashboard",
    autoRetry: "Retrying automatically in {seconds}s…",
    autoRetryExhausted: "Automatic retries stopped.",
    newVersion: "A new version is available — reloading…",
    newVersionBroken: "The new version didn't load properly.",
  },
  de: {
    heading: "Kritischer Fehler",
    fallback: "Ein schwerwiegender Fehler ist aufgetreten. Bitte versuche es erneut.",
    retry: "Erneut versuchen",
    home: "Zum Dashboard",
    autoRetry: "Automatischer Neuversuch in {seconds}s…",
    autoRetryExhausted: "Automatische Neuversuche beendet.",
    newVersion: "Eine neue Version ist da – wird neu geladen…",
    newVersionBroken: "Die neue Version wurde nicht richtig geladen.",
  },
  fr: {
    heading: "Une erreur grave est survenue",
    fallback: "Une erreur grave s'est produite. Veuillez réessayer.",
    retry: "Réessayer",
    home: "Aller au tableau de bord",
    autoRetry: "Nouvelle tentative automatique dans {seconds} s…",
    autoRetryExhausted: "Tentatives automatiques arrêtées.",
    newVersion: "Une nouvelle version est disponible — rechargement…",
    newVersionBroken: "La nouvelle version ne s'est pas chargée correctement.",
  },
} as const;

/**
 * The wall display is the point of Kinboard, and nobody is standing in front
 * of it. Without this, a root-layout crash — a bad deploy, a chunk that
 * failed to load — leaves the panel showing an apology until a human walks up
 * and taps "Try again".
 *
 * So: retry on our own, backing off, a bounded number of times. Escalating
 * delays let a mid-deploy server settle instead of us reloading into the same
 * failure every few seconds; the budget ends so a genuinely broken build
 * comes to rest on a readable error rather than flashing forever.
 *
 * The counters live at module scope on purpose. `reset()` re-renders the
 * failing tree, and if it throws again React mounts a *fresh* boundary —
 * component state would restart at zero attempts each time, turning the
 * budget into an endless loop. They self-clear after a quiet spell so a
 * later, unrelated crash gets the full budget again.
 */
const AUTO_RETRY_DELAYS_MS = [20_000, 45_000, 120_000, 300_000];
const RETRY_BUDGET_RESET_MS = 15 * 60_000;
let autoRetryCount = 0;
let lastAutoRetryAt = 0;

/** Delay before the next automatic retry, or `null` once the budget is spent. */
function nextRetryDelayMs(chunkError: boolean): number | null {
  // A chunk error retries with a full reload, which would start the
  // module-scope count from zero; its budget is kept across reloads instead.
  if (chunkError) return staleBundleRetryDelayMs(AUTO_RETRY_DELAYS_MS, RETRY_BUDGET_RESET_MS);
  if (Date.now() - lastAutoRetryAt > RETRY_BUDGET_RESET_MS) autoRetryCount = 0;
  return AUTO_RETRY_DELAYS_MS[autoRetryCount] ?? null;
}

type ErrorLocale = keyof typeof STRINGS;

/**
 * The locale, worked out client-side.
 *
 * Same cookie the rest of the app negotiates on (src/i18n/locales.ts), with
 * the browser's own preference as the fallback — the cookie is only set once
 * someone has picked a language.
 */
function detectLocale(): ErrorLocale {
  if (typeof document === "undefined") return "en";

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("NEXT_LOCALE="))
    ?.split("=")[1];
  if (cookie && cookie in STRINGS) return cookie as ErrorLocale;

  const browser = navigator.language?.slice(0, 2);
  if (browser && browser in STRINGS) return browser as ErrorLocale;

  return "en";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  // Resolved after mount so the server and the first client render agree —
  // neither cookies nor navigator.language exist during SSR, and a mismatch
  // here would hydrate-error inside the error page itself.
  const [locale, setLocale] = useState<ErrorLocale>("en");
  useEffect(() => setLocale(detectLocale()), []);
  const t = STRINGS[locale];

  /*
    A chunk that failed to load means this page runs a build the server no
    longer has (#383). `reset()` would re-render the same old bundle into the
    same missing file, so reload straight away instead, and say so calmly.
    If that reload is refused (another chunk error within a minute — the new
    build is likely broken), fall back to the countdown, with full loads only.
  */
  const chunkError = isChunkLoadError(error);
  const [reloading, setReloading] = useState(chunkError);
  useEffect(() => {
    if (chunkError && !recoverFromStaleBundle()) setReloading(false);
  }, [chunkError]);
  const retry = chunkError ? () => window.location.reload() : reset;

  // Seeded from the same helper the timer effect uses, so the first paint
  // already shows the real countdown instead of flashing "retries stopped".
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => {
    const delay = nextRetryDelayMs(chunkError);
    return delay === null ? null : Math.round(delay / 1000);
  });

  // `reset` is kept in a ref: the countdown re-renders once a second, and an
  // effect that depended on `reset` directly would reschedule its timer on
  // every one of those renders if the identity ever changed — so it would
  // never actually fire.
  const resetRef = useRef(retry);
  resetRef.current = retry;

  useEffect(() => {
    if (reloading) return;
    const delay = nextRetryDelayMs(chunkError);
    if (delay === null) {
      setSecondsLeft(null);
      return;
    }

    const tick = setInterval(() => {
      setSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0));
    }, 1000);
    const timer = setTimeout(() => {
      if (chunkError) {
        noteStaleBundleRetry(RETRY_BUDGET_RESET_MS);
      } else {
        autoRetryCount += 1;
        lastAutoRetryAt = Date.now();
      }
      resetRef.current();
    }, delay);

    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [reloading, chunkError]);

  if (reloading) {
    return (
      <html lang={locale}>
        <body>
          <div
            role="status"
            aria-live="polite"
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0a0a0a",
              color: "#a1a1aa",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "0.875rem",
            }}
          >
            {t.newVersion}
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang={locale}>
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            color: "#fafafa",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "linear-gradient(180deg, #0a0a0a 0%, #0f0a0a 100%)",
          }}
        >
          <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "64px",
                height: "64px",
                borderRadius: "16px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                marginBottom: "1.5rem",
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem", fontWeight: 300 }}>
              {t.heading}
            </h2>
            <p style={{ color: "#71717a", marginBottom: "1rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
              {chunkError ? t.newVersionBroken : error.message || t.fallback}
            </p>
            {/* Quiet, but never silent — a panel that reloads itself out of
                nowhere is baffling to whoever does eventually look at it. */}
            <p
              aria-live="polite"
              style={{ color: "#52525b", marginBottom: "2rem", fontSize: "0.75rem" }}
            >
              {secondsLeft !== null
                ? t.autoRetry.replace("{seconds}", String(secondsLeft))
                : t.autoRetryExhausted}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={retry}
                style={{
                  padding: "0.625rem 1.25rem",
                  backgroundColor: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "0.75rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                {t.retry}
              </button>
              <button
                onClick={() => { window.location.href = "/"; }}
                style={{
                  padding: "0.625rem 1.25rem",
                  backgroundColor: "transparent",
                  color: "#a1a1aa",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.75rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                {t.home}
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

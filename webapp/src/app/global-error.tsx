"use client";

import { useEffect, useState } from "react";

/**
 * This page replaces the root layout when rendering fails there, so there is
 * no next-intl provider and no `useTranslations` — which is why it was
 * written in hardcoded German and stayed that way while error.tsx and
 * not-found.tsx were translated. An English or French household saw German
 * at the one moment nothing else on screen could explain itself.
 *
 * A three-language table inline is the whole fix. It stays in step with
 * messages/*.json by being tiny: four strings, no interpolation.
 */
const STRINGS = {
  en: {
    heading: "Something broke badly",
    fallback: "A serious error occurred. Please try again.",
    retry: "Try again",
    home: "Go to dashboard",
  },
  de: {
    heading: "Kritischer Fehler",
    fallback: "Ein schwerwiegender Fehler ist aufgetreten. Bitte versuche es erneut.",
    retry: "Erneut versuchen",
    home: "Zum Dashboard",
  },
  fr: {
    heading: "Une erreur grave est survenue",
    fallback: "Une erreur grave s'est produite. Veuillez réessayer.",
    retry: "Réessayer",
    home: "Aller au tableau de bord",
  },
} as const;

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
            <p style={{ color: "#71717a", marginBottom: "2rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
              {error.message || t.fallback}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              <button
                onClick={reset}
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

"use client";

import { useEffect } from "react";

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

  return (
    <html>
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
              Kritischer Fehler
            </h2>
            <p style={{ color: "#71717a", marginBottom: "2rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
              {error.message || "Ein schwerwiegender Fehler ist aufgetreten. Bitte versuche es erneut."}
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
                Erneut versuchen
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
                Zum Dashboard
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

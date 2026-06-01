// crypto.randomUUID() only exists in a SECURE context (HTTPS, or
// http://localhost on the same machine). A plain-HTTP LAN deployment — a
// documented, common Kinboard setup — would otherwise throw
// "crypto.randomUUID is not a function", which crashed the setup wizard's
// People step and any other code generating a client-side id.
//
// These ids are used for React keys, local/offline action ids, and room ids
// — not security tokens — so a non-secure-context fallback is acceptable.
// We prefer crypto.getRandomValues (available in insecure contexts, unlike
// randomUUID) for a proper v4 UUID, and only fall back to Math.random when
// no Web Crypto is present at all.
export function safeRandomUUID(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // fall through to the Math.random fallback below
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

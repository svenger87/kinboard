import { randomUUID } from "node:crypto";

/** Keep the machine credential out of URLs, logs, and MCP tool results. */
export function createKinboardClient(env = process.env, fetchImpl = fetch) {
  const rawUrl = env.KINBOARD_URL;
  const token = env.KINBOARD_INTEGRATION_TOKEN;
  if (!rawUrl || !token || !/^kbi_[A-Za-z0-9_-]{40,}$/.test(token)) {
    throw new Error("Set KINBOARD_URL and a Kinboard Integration API token in KINBOARD_INTEGRATION_TOKEN");
  }

  let base;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new Error("KINBOARD_URL must be an absolute HTTP(S) URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && (local || env.KINBOARD_ALLOW_HTTP === "1"))) {
    throw new Error("Use HTTPS for Kinboard, or explicitly set KINBOARD_ALLOW_HTTP=1 for a trusted LAN");
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("KINBOARD_URL must be an origin with no credentials, path, query, or fragment");
  }

  async function request(path, { method = "GET", body } = {}) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Integration API path");
    const url = new URL(`/api/integration/v1${path}`, base);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      // A new key per intended mutation; the API stores it to deduplicate retries.
      headers["Idempotency-Key"] = randomUUID();
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error("Kinboard is unreachable or the request timed out");
    }
    // Bound content before parsing: the model does not need an unlimited dump.
    const size = Number(response.headers.get("content-length"));
    if (size > 1_000_000) throw new Error("Kinboard response is too large");
    const chunks = [];
    let received = 0;
    if (!response.body) throw new Error("Kinboard returned an empty response");
    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > 1_000_000) throw new Error("Kinboard response is too large");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Kinboard returned an invalid response (HTTP ${response.status})`); }
    if (!response.ok) {
      const code = typeof data?.code === "string" ? data.code : `http_${response.status}`;
      throw new Error(`Kinboard request failed: ${code} (HTTP ${response.status})`);
    }
    return data;
  }
  return { request };
}

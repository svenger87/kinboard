/**
 * Why a home request could not be answered — RFC-011 §4.4, "fail closed".
 *
 * In their own module, with no imports, so the pure decision flow in
 * `devices.ts` can recognise them without pulling in the database or the
 * network, and the specs can throw them from stubs.
 *
 * Messages never contain a URL, a token or a response body from Home
 * Assistant — only a status code at most — because they reach logs.
 */

/** Home Assistant is not connected for this family, or its address is unusable. */
export class HomeUnavailable extends Error {
  constructor(message = "Home Assistant is not connected") {
    super(message);
    this.name = "HomeUnavailable";
  }
}

/** Home Assistant was asked and did not answer usefully: unreachable, an error, or nonsense. */
export class HomeUpstreamError extends Error {
  constructor(message = "Home Assistant did not answer") {
    super(message);
    this.name = "HomeUpstreamError";
  }
}

/** The family's catalogue could not be read, so nothing can be shown to be in it. */
export class CatalogueUnavailable extends Error {
  constructor(message = "The device catalogue could not be read") {
    super(message);
    this.name = "CatalogueUnavailable";
  }
}

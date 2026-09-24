import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Discussion #277: an evening lost to `:8001` instead of `:8100`.
 *
 * The two ports a self-hoster types are 3001 (the page) and 8100 (the API),
 * and transposing the second into 8001 produces exactly the failure this
 * whole thread has been about: the page loads, the family step works, and
 * every call after it goes nowhere. Nothing said which port it was reaching
 * for, and the address is typed once and then lives in a file nobody reads
 * again.
 *
 * Kinboard knows both numbers — API_EXTERNAL_URL is right there next to
 * KONG_HTTP_PORT — so it can say so. A warning rather than a refusal: a
 * reverse proxy on another port in front of Kong is a legitimate setup, and
 * the verdict cannot tell that apart from a typo.
 */

function verdict(url: string, kongPort: string): string {
  return execFileSync(
    "bash",
    [
      "-c",
      `eval "$(sed -n '/^api_url_port_verdict()/,/^}$/p' docker/start.sh)"; ` +
        `api_url_port_verdict "$1" "$2"`,
      "_",
      url,
      kongPort,
    ],
    // No cwd override: Playwright runs from webapp/, the same place every
    // other spec reads its source files from. An absolute path here passed on
    // the machine it was written on and failed everywhere else.
    { encoding: "utf8" },
  ).trim();
}

test("the ports agreeing is the normal case", () => {
  expect(verdict("http://192.168.1.50:8100", "8100")).toBe("match");
  expect(verdict("http://localhost:8100", "8100")).toBe("match");
});

test("a transposed port is reported", () => {
  // The actual mistake: 8001 for 8100.
  expect(verdict("http://192.168.1.50:8001", "8100")).toBe("mismatch 8001 8100");
});

test("the webapp's own port in the API address is reported too", () => {
  // The other plausible mix-up between the two numbers on the page.
  expect(verdict("http://192.168.1.50:3001", "8100")).toBe("mismatch 3001 8100");
});

test("an address with no port says nothing — that is Traefik's shape", () => {
  expect(verdict("https://kinboard.example.com", "8100")).toBe("none");
  expect(verdict("https://kinboard.example.com/", "8100")).toBe("none");
});

test("a non-default Kong port is honoured rather than assumed", () => {
  expect(verdict("http://192.168.1.50:9000", "9000")).toBe("match");
});

test("nothing configured yet is not a complaint", () => {
  expect(verdict("", "8100")).toBe("none");
});

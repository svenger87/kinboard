import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Discussion #277. setup.sh asks where the family will open Kinboard and
 * suggests an answer — and whatever is accepted becomes API_EXTERNAL_URL,
 * the absolute address every browser data call and the realtime socket go
 * to (window.__ENV.NEXT_PUBLIC_SUPABASE_URL). The page itself can load fine
 * from localhost while every call after it goes somewhere unreachable.
 *
 * The suggestion was:
 *
 *   if public_ip != lan_ip  -> "server with a public IP (VPS)" -> public IP
 *
 * which is the wrong way round. On a VPS the public address sits on the
 * interface, so the two are EQUAL. Behind any home router they always
 * DIFFER — so a home install was offered its own public IP, reachable from
 * inside only with a port forward and hairpin NAT. Under WSL2 `hostname -I`
 * returns the VM's internal 172.x on top, and the same branch fires.
 *
 * The reporter pressed Enter, got past the family-name step (a same-origin
 * Next route) and then "Kinboard-Server nicht erreichbar" on the first
 * PostgREST call, with live updates permanently paused.
 */

/** Run the real function out of setup.sh with injected facts. */
function suggest(publicIp: string, ownIps: string, routeIp: string, isWsl: "0" | "1"): string {
  return execFileSync(
    "bash",
    [
      "-c",
      `eval "$(sed -n '/^suggest_api_url()/,/^}$/p' ../setup.sh)"; ` +
        `suggest_api_url "$1" "$2" "$3" "$4"`,
      "_",
      publicIp,
      ownIps,
      routeIp,
      isWsl,
    ],
    { encoding: "utf8" },
  ).split("|")[0].trim();
}

test("a home server behind a router is offered its LAN address, not its public one", () => {
  // The case that was broken for everyone at home: the two always differ.
  expect(suggest("87.1.2.3", "192.168.1.50 172.17.0.1", "192.168.1.50", "0")).toBe(
    "http://192.168.1.50:8100",
  );
});

test("a VPS, whose public address is on the interface, is offered that address", () => {
  expect(suggest("5.6.7.8", "5.6.7.8 172.17.0.1", "5.6.7.8", "0")).toBe("http://5.6.7.8:8100");
});

test("WSL is offered localhost, because its own address is the VM's", () => {
  // hostname -I under WSL2 is the VM's internal address; nothing on the LAN
  // reaches it and it changes on restart. localhost is what the Windows
  // browser on the same PC actually reaches.
  expect(suggest("87.1.2.3", "172.28.1.5", "172.28.1.5", "1")).toBe("http://localhost:8100");
});

test("the LAN address comes from the default route, not whichever address is listed first", () => {
  // On a Docker host `hostname -I` can list the docker0 bridge before the
  // real interface; the route to the outside world does not.
  expect(suggest("87.1.2.3", "172.17.0.1 192.168.1.50", "192.168.1.50", "0")).toBe(
    "http://192.168.1.50:8100",
  );
});

test("with no public IP detected, a home server still gets its LAN address", () => {
  expect(suggest("", "192.168.1.50", "192.168.1.50", "0")).toBe("http://192.168.1.50:8100");
});

test("with nothing detected at all, the suggestion is localhost", () => {
  expect(suggest("", "", "", "0")).toBe("http://localhost:8100");
});

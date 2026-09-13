import { test, expect } from "@playwright/test";
import { establishSession } from "./session";
const FAMILY_CODE = process.env.FAMILY_CODE ?? "";

/*
  Kinboard registers a PWA service worker, and it answers `fetch` before
  Playwright's routing sees it — a stubbed endpoint then silently serves the
  real response. It passed in Chromium and failed in WebKit when this was last
  learned the hard way, which is why the block is here and why the browse calls
  are counted rather than assumed.
*/
test.use({ serviceWorkers: "block" });

test("browsing drills into a folder and plays what is tapped", async ({ page }, testInfo) => {
  test.skip(!FAMILY_CODE, "needs FAMILY_CODE");
  await establishSession(page, FAMILY_CODE, `claude-br-${testInfo.project.name}`);

  // Both Playwright projects run against one family on one database at the
  // same time, so a fixed nickname has the two runs writing over each other
  // and `getByText` matching the other run's row.
  const suffix = `${testInfo.project.name.replace(/[^a-z0-9]/gi, "")}${Date.now()}`.toLowerCase();
  const nickname = `probe-tv-${suffix}`;
  const entityId = `media_player.probe_tv_${suffix}`;

  // Apple TV mask: includes BROWSE_MEDIA (131072) and PLAY_MEDIA (512).
  await page.route("**/api/homeassistant/states**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entities: [{
      entity_id: entityId, domain: "media_player", name: "TV", state: "playing",
      attributes: { friendly_name: "TV", supported_features: 450487 },
      last_changed: new Date().toISOString() }] }) }));

  let browseCalls = 0;
  await page.route("**/api/media-players/*/browse**", (r) => {
    browseCalls += 1;
    const u = new URL(r.request().url());
    const at = u.searchParams.get("media_content_id");
    const body = at === "folder1"
      ? { title: "Folder One", nodes: [{ id: "track1", title: "Probe Track", type: "music", playable: true, expandable: false }] }
      : { title: "Library", nodes: [{ id: "folder1", title: "Probe Folder", type: "directory", playable: false, expandable: true }] };
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  const calls: string[] = [];
  await page.route("**/api/homeassistant/services**", async (r) => {
    calls.push(r.request().postData() ?? "");
    await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  const familyId = await page.evaluate(() => {
    const raw = decodeURIComponent(document.cookie.split("; ").find(c => c.startsWith("family-calendar-storage="))!.split("=")[1]);
    return JSON.parse(raw).state.family.id as string;
  });
  const created = await page.evaluate(async ({ fid, nick, eid }) => {
    const res = await fetch("/api/media-players", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: fid, driver: "home_assistant", nickname: nick, config: { entity_id: eid } }) });
    return res.ok ? { id: (await res.json()).player.id as string } : { error: `${res.status}` };
  }, { fid: familyId, nick: nickname, eid: entityId });
  if ("error" in created) throw new Error("create " + created.error);

  try {
    await page.goto("/media", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(nickname)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Browse" }).click();
    await expect(page.getByText("Probe Folder")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Probe Folder").click();
    await expect(page.getByText("Probe Track")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Probe Track").click();
    await page.waitForTimeout(1500);
    console.log("BROWSE CALLS:", browseCalls);
    console.log("SERVICE CALL:", calls[0]?.slice(0, 200));
    expect(browseCalls).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toContain("play_media");
    expect(calls[0]).toContain("track1");
  } finally {
    await page.evaluate(async ({ fid, id }) => { await fetch(`/api/media-players/${id}?family_id=${fid}`, { method: "DELETE" }).catch(()=>{}); }, { fid: familyId, id: created.id });
  }
});

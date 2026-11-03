// Captures Kinboard's Home and screensaver for the RFC-020 mockups, from a
// throwaway household on a local stack (dev server on :3000, its database in
// the container KINBOARD_DB_CONTAINER, default kinboard-db). Run from webapp/:
//
//   node ../docs/rfc/020/capture.cjs <captures>
//   python3 ../docs/rfc/020/mockups.py <captures> ../docs/rfc/020
//
// The household is made through the same call the welcome screen makes,
// filled with SQL, and deleted again at the end. Weather and news are stubbed:
// no API key needed, and no real headlines or press photos in the mockups.
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd()] }));
const { execSync } = require("child_process");
const fs = require("fs");
const out = process.argv[2];
const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
const NOW = new Date("2026-12-12T16:42:00+01:00"); // a Saturday in Advent

const DB = process.env.KINBOARD_DB_CONTAINER || "kinboard-db";
if (!/^[\w.-]+$/.test(DB)) throw new Error("KINBOARD_DB_CONTAINER: a container name");
const sql = (q) => execSync(`docker exec -i ${DB} psql -U supabase_admin -d postgres -tA -v ON_ERROR_STOP=1`, { input: q }).toString().trim();

const FESTIVE = {
  christmas: ["355 72% 52%", "150 55% 36%"],
  newyear: ["43 85% 55%", "232 60% 50%"],
  lunar: ["357 80% 52%", "43 85% 55%"],
  easter: ["105 50% 55%", "50 85% 62%"],
  halloween: ["28 88% 55%", "275 50% 48%"],
  diwali: ["35 100% 55%", "330 65% 50%"],
};

const HATS = {
  christmas: `<path d="M -29 -19 Q -27 -50 2 -62 Q 30 -72 46 -44 Q 36 -49 27 -43 Q 21 -31 29 -19 Z" fill="#D9363E"/><path d="M -6 -56 Q 8 -62 20 -60" stroke="#B02A31" stroke-width="2" fill="none"/><rect x="-33" y="-27" width="66" height="13" rx="6.5" fill="#FFFFFF"/><circle cx="46" cy="-44" r="7.5" fill="#FFFFFF"/>`,
  newyear: `<path d="M -17 -22 L 2 -78 L 21 -22 Z" fill="#4AA8FF"/><path d="M -11 -40 L 15 -40 M -5 -58 L 9 -58" stroke="#FFD24A" stroke-width="5"/><circle cx="2" cy="-80" r="6.5" fill="#FF5A5A"/><circle cx="-30" cy="-58" r="2.6" fill="#FFD24A"/><rect x="30" y="-68" width="5" height="5" fill="#4AD66D" transform="rotate(20 32 -66)"/><circle cx="34" cy="-44" r="2.6" fill="#FF5A5A"/>`,
  lunar: `<path d="M -29 -20 Q -27 -52 0 -54 Q 27 -52 29 -20 Z" fill="#D62F2F"/><rect x="-31" y="-26" width="62" height="8" rx="4" fill="#E3B341"/><circle cy="-56" r="5.5" fill="#E3B341"/><path d="M 30 -22 L 40 -2" stroke="#E3B341" stroke-width="1.5"/><ellipse cx="40" cy="8" rx="9" ry="8" fill="#D62F2F"/><rect x="35" y="-1" width="10" height="3" fill="#E3B341"/><rect x="35" y="15" width="10" height="3" fill="#E3B341"/>`,
  easter: `<path d="M -30 -18 Q 0 -40 30 -18" stroke="#F3F1EC" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="-13" cy="-58" rx="10" ry="27" fill="#F6F4EF" transform="rotate(-12 -13 -58)"/><ellipse cx="-13" cy="-56" rx="5" ry="19" fill="#FFB3C4" transform="rotate(-12 -13 -56)"/><ellipse cx="15" cy="-58" rx="10" ry="27" fill="#F6F4EF" transform="rotate(14 15 -58)"/><ellipse cx="15" cy="-56" rx="5" ry="19" fill="#FFB3C4" transform="rotate(14 15 -56)"/>`,
  halloween: `<ellipse cy="-24" rx="45" ry="8" fill="#2B2140"/><path d="M -21 -26 L 3 -86 Q 9 -93 16 -82 L 10 -76 L 21 -26 Z" fill="#3B2D5C"/><rect x="-20" y="-36" width="41" height="7" fill="#F5B84A"/>`,
  diwali: Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i / 8) * Math.PI; return `<circle cx="${(Math.cos(a) * 31).toFixed(1)}" cy="${(-14 + Math.sin(a) * 18).toFixed(1)}" r="5.2" fill="${i % 2 ? "#FFD24A" : "#FF9F1C"}"/>`; }).join(""),
};

function weather() {
  return { temp: -1, feelsLike: -5, condition: "light snow", conditionMain: "Snow", conditionIcon: "13d", humidity: 86,
    windSpeed: 9, location: "Hamburg", high: 1, low: -3, visibility: 6000, sunrise: "08:29", sunset: "15:56", timezoneOffset: 3600, units: "metric" };
}
function forecast() {
  const days = ["Sat", "Sun", "Mon", "Tue", "Wed"];
  const daily = days.map((d, i) => ({ date: `2026-12-${12 + i}`, dayName: d, tempMax: [1, 2, 0, 3, 4][i], tempMin: [-3, -2, -4, -1, 0][i],
    condition: "snow", conditionMain: i === 3 ? "Clouds" : "Snow", conditionIcon: i === 3 ? "04d" : "13d", humidity: 80, windSpeed: 8,
    precipProbability: [80, 60, 40, 10, 20][i], rainAmount: 0, snowAmount: [3, 1, 0, 0, 0][i] }));
  const hourly = Array.from({ length: 8 }, (_, i) => ({ time: `${String(15 + i * 3).padStart(2, "0")}:00`, temp: -1 - (i % 3), condition: "snow",
    conditionMain: "Snow", conditionIcon: "13d", precipProbability: 70, windSpeed: 8, at: NOW.getTime() - 3600e3 + i * 3 * 3600e3 }));
  return { location: "Hamburg", coords: { lat: 53.55, lon: 9.99 }, timezone: 3600, daily, hourly, units: "metric" };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: "dark", serviceWorkers: "block", timezoneId: "Europe/Berlin", locale: "en-GB" });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://localhost:3000" }]);
  await ctx.route(/\/api\/weather\/forecast\?/, (r) => r.fulfill({ json: forecast() }));
  await ctx.route(/\/api\/weather\?/, (r) => r.fulfill({ json: weather() }));
  // No real headlines or press photos in a public mockup.
  await ctx.route(/\/api\/news/, (r) => r.fulfill({ json: { articles: [], items: [] } }));
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/join", { waitUntil: "domcontentloaded" });
  const fam = await p.evaluate(async () => {
    const res = await fetch("/api/session/create", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyName: "Berger", hardwareId: "rfc-mockups", deviceName: "rfc-mockups" }) });
    if (!res.ok) return { error: res.status + " " + (await res.text()).slice(0, 200) };
    const d = await res.json();
    document.cookie = "family-calendar-storage=" + encodeURIComponent(JSON.stringify({ state: { family: d.family, device: d.device }, version: 0 })) + "; path=/; max-age=86400";
    localStorage.setItem("theme", "dark");
    localStorage.setItem("kinboard_motion", "off");
    localStorage.setItem("kinboard.widget-order", JSON.stringify(["weather", "upcomingEvents", "creatures", "weekOverview", "tasks", "shopping", "mealPlan", "messages"]));
    return { id: d.family.id };
  });
  if (fam.error) throw new Error(fam.error);
  const F = fam.id;
  sql(`
    INSERT INTO people (family_id, name, color, is_child, birth_date) VALUES
      ('${F}','Anna','#e11d48',false,NULL), ('${F}','Tom','#6366f1',false,NULL),
      ('${F}','Mira','#f59e0b',true,'2017-05-04'), ('${F}','Jonas','#0ea5e9',true,'2019-09-21');
    WITH c AS (INSERT INTO calendars (family_id, name, color) VALUES ('${F}','Family','#e11d48') RETURNING id)
    INSERT INTO events (calendar_id, title, start_at, end_at, all_day, person_id)
    SELECT c.id, t, s::timestamptz, e::timestamptz, false, (SELECT id FROM people WHERE family_id='${F}' AND name=pn)
    FROM c, (VALUES
      ('Bake cookies with Oma','2026-12-12 14:00+01','2026-12-12 16:00+01',NULL),
      ('Christmas market','2026-12-12 17:30+01','2026-12-12 19:30+01',NULL),
      ('3rd Advent brunch','2026-12-13 10:00+01','2026-12-13 12:00+01',NULL),
      ('Nativity play rehearsal','2026-12-14 15:30+01','2026-12-14 17:00+01','Mira'),
      ('Swimming','2026-12-15 16:00+01','2026-12-15 17:00+01','Jonas')) v(t,s,e,pn);
    INSERT INTO todos (family_id, title, person_id, due_date, icon)
    SELECT '${F}', t, (SELECT id FROM people WHERE family_id='${F}' AND name=pn), '2026-12-12', NULL FROM (VALUES
      ('Feed Luna','Mira'), ('Water the tree','Jonas'), ('Write cards to the grandparents','Anna')) v(t,pn);
    INSERT INTO creatures (person_id, family_id, species, style, look, best_tier, last_seen_tier, grows_with, enabled)
    SELECT id, '${F}', sp, 'gumdrop', '{"head":"cap"}'::jsonb, tier, tier, 'points', true FROM people p
      JOIN (VALUES ('Mira','dragon',5), ('Jonas','unicorn',4)) v(pn, sp, tier) ON p.name = v.pn WHERE p.family_id='${F}';
    INSERT INTO point_purchases (family_id, person_id, item_id, cost)
    SELECT '${F}', id, 'cap', 25 FROM people WHERE family_id='${F}' AND name IN ('Mira','Jonas');
    INSERT INTO settings (family_id, key, value) VALUES ('${F}', 'widget_visibility', '{"creatures": true, "schedule": false, "timers": false}'::jsonb);
    INSERT INTO shopping_items (family_id, name, quantity, unit) VALUES
      ('${F}','Milk',2,'l'), ('${F}','Flour',1,'kg'), ('${F}','Cinnamon',NULL,NULL), ('${F}','Candles',4,NULL), ('${F}','Oranges',6,NULL);
  `);
  await p.clock.install({ time: NOW });
  await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await p.clock.runFor(8000);
  await p.waitForTimeout(6000);
  await p.clock.runFor(3000);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  // The install banner is a first-visit prompt, not part of Home.
  await p.evaluate(() => {
    for (const el of document.querySelectorAll("main *")) {
      if (el.childElementCount && /^(Install shopping app|Finish setting up Kinboard)/.test(el.innerText || "") && el.getBoundingClientRect().height < 420) { el.remove(); }
    }
  });
  await p.waitForTimeout(800);

  const geo = await p.evaluate(() => {
    const grid = [...document.querySelectorAll("main section")].find((s) => s.className.includes("grid"));
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cards = grid ? [...grid.children].map((c) => ({ ...box(c), title: (c.innerText || "").split("\n")[0].slice(0, 40) })) : [];
    const clock = [...document.querySelectorAll("main *")].find((e) => /^\d\d:\d\d$/.test((e.innerText || "").replace(/\s/g, "")) && e.getBoundingClientRect().height > 80);
    const nav = document.querySelector("nav");
    const cs = getComputedStyle(document.body);
    return { cards, clock: clock ? box(clock) : null, nav: nav ? box(nav) : null,
      fontSans: cs.fontFamily, fontDisplay: clock ? getComputedStyle(clock).fontFamily : null,
      bg: cs.backgroundColor, card: grid && grid.children[0] ? getComputedStyle(grid.children[0].querySelector("*") || grid.children[0]).backgroundColor : null,
      monthPrimary: getComputedStyle(document.documentElement).getPropertyValue("--month-primary") };
  });
  fs.writeFileSync(out + "/geo.json", JSON.stringify(geo, null, 1));

  await p.screenshot({ path: out + "/home-december.png" });
  for (const [name, [top, bottom]] of Object.entries(FESTIVE)) {
    await p.evaluate(([t, bt]) => {
      let s = document.getElementById("festive-wash");
      if (!s) { s = document.createElement("style"); s.id = "festive-wash"; document.head.appendChild(s); }
      s.textContent = `body::before{background:radial-gradient(ellipse 90% 55% at 50% 0%, hsl(${t} / 0.22), transparent 70%), linear-gradient(to top, hsl(${bt} / 0.16), transparent 45%) !important}`;
    }, [top, bottom]);
    await p.evaluate((hat) => document.querySelectorAll('[data-item="cap"]').forEach((g) => { g.innerHTML = hat; }), HATS[name]);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/home-${name}.png` });
    const markup = await p.evaluate(() => [...document.querySelectorAll('[data-item="cap"]')].map((g) => g.ownerSVGElement.outerHTML));
    fs.writeFileSync(`${out}/creature-svg-${name}.json`, JSON.stringify(markup));
  }
  // The screensaver: let the (fake) clock run past the idle timeout.
  await p.evaluate(() => document.getElementById("festive-wash")?.remove());
  await p.clock.runFor(130_000);
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.screenshot({ path: out + "/screensaver.png" });
  await b.close();
  sql(`DELETE FROM devices WHERE hardware_id = 'rfc-mockups'; DELETE FROM families WHERE id = '${F}' AND name = 'Berger';`);
})().catch((e) => { console.error(e); process.exit(1); });

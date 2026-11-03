"""Builds docs/rfc/020/prototype/scene.html: the §5.1 pipeline, running, and a
benchmark of it. One self-contained file (no server, no network), so it can be
opened on a Raspberry Pi from a USB stick or a download.

    python3 docs/rfc/020/bench.py docs/rfc/020/art docs/rfc/020/prototype [background.jpg]

It runs three scenes for the same time each and reports frame times:
  weather  snow only, the way the weather effects draw today (the baseline)
  sprites  snow plus the sleigh team, every part rasterised once to an
           ImageBitmap and moved on the canvas (§5.1's proposal)
  svg      snow plus the same team as live SVG, transforms set every frame
           (the alternative §5.1 sets aside)
"""
import base64, json, os, sys

ART, OUT = sys.argv[1], sys.argv[2]
BG = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(ART, "parts.json")))
parts = {n: open(os.path.join(ART, f"{n}.svg")).read() for n in meta["parts"]}
bg = ("data:image/jpeg;base64," + base64.b64encode(open(BG, "rb").read()).decode()) if BG else ""

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kinboard festival scene · benchmark</title>
<style>
  :root { --bg:#1b140e; --card:#2d241a; --line:#463a2c; --text:#f2ebe0; --muted:#a89a88; --accent:#4fbf93; }
  html,body { margin:0; height:100%; background:var(--bg) __BG__ center/cover no-repeat; color:var(--text);
    font-family:'Hanken Grotesk',system-ui,sans-serif; overflow:hidden; }
  canvas, #svgLayer { position:fixed; inset:0; width:100vw; height:100vh; pointer-events:none; }
  #back { z-index:1 } #svgLayer { z-index:2 } #front { z-index:3 }
  #panel { position:fixed; z-index:10; left:50%; top:50%; transform:translate(-50%,-50%); width:min(720px,92vw);
    background:rgba(27,20,14,.94); border:1px solid var(--line); border-radius:18px; padding:24px 26px; box-shadow:0 20px 60px #0008 }
  #panel h1 { font-size:22px; margin:0 0 6px } #panel p { color:var(--muted); margin:6px 0 14px; line-height:1.45 }
  button { font:inherit; font-weight:600; border:0; border-radius:12px; padding:12px 18px; background:var(--accent); color:#0f1a14; cursor:pointer }
  button.ghost { background:transparent; color:var(--text); border:1px solid var(--line) }
  table { width:100%; border-collapse:collapse; margin:10px 0 14px; font-variant-numeric:tabular-nums }
  td,th { text-align:right; padding:6px 8px; border-bottom:1px solid var(--line); font-size:14px } td:first-child,th:first-child { text-align:left }
  th { color:var(--muted); font-weight:500 } .ok { color:#4ad66d } .warn { color:#f5b84a } .bad { color:#ff6b6b }
  #status { position:fixed; z-index:11; right:14px; bottom:12px; background:#000a; padding:8px 12px; border-radius:10px; font-size:14px }
  textarea { width:100%; height:120px; background:#120d09; color:var(--text); border:1px solid var(--line); border-radius:10px; font:12px ui-monospace,monospace }
</style></head><body>
<canvas id="back"></canvas><div id="svgLayer"></div><canvas id="front"></canvas>
<div id="panel">
  <h1>Festival scene benchmark</h1>
  <p>Runs three scenes for <b id="secsL"></b> s each and measures how smoothly this device draws them at Kinboard's 30 frames a second:
  snow alone (today's weather effects), snow with the sleigh drawn from cached images (RFC-020's plan), and snow with the sleigh as live SVG.
  Leave the screen alone while it runs. About <b id="totalL"></b> s.</p>
  <button id="go">Run the benchmark</button> <button class="ghost" id="demo">Just show the scene</button>
  <div id="results"></div>
</div>
<div id="status" hidden></div>
<script>
const PARTS = __PARTS__;
const META = __META__;
const Q = new URLSearchParams(location.search);
const SECS = +(Q.get("secs") || 20), WARM = 2;
// Only the three known scenes: the names are written into the results table.
const MODES = (Q.get("modes") || "weather,sprites,svg").split(",").filter((m) => ["weather", "sprites", "svg"].includes(m));
// Everything from the URL (the note) is shown escaped, never as markup.
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SCALE = +(Q.get("scale") || 0.62);          // team size on a 1080p screen
const FRAME_MS = 1000 / 30;                          // Kinboard's cap
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
document.getElementById("secsL").textContent = SECS;
document.getElementById("totalL").textContent = MODES.length * (SECS + WARM) + 3;

// ------------------------------------------------------------- the gait (same curves as art.py)
const G = META.rig.gait, R = META.rig.reindeer, SL = META.rig.sleigh, P = META.parts;
function curve(keys, t) {
  t = ((t % 1) + 1) % 1; const n = keys.length;
  for (let i = 0; i < n; i++) {
    const p0 = keys[i][0], p1 = i + 1 < n ? keys[i + 1][0] : keys[0][0] + 1;
    if ((p0 <= t && t < p1) || (i === n - 1 && t >= p0)) {
      const u = (t - p0) / (p1 - p0), v0 = keys[(i - 1 + n) % n][1], v1 = keys[i][1], v2 = keys[(i + 1) % n][1], v3 = keys[(i + 2) % n][1];
      return 0.5 * (2 * v1 + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
    }
  }
  return keys[0][1];
}
const wave = ([a, ph], t, f = 1) => a * Math.sin(2 * Math.PI * (f * t + ph));
function pose(t) {
  const o = {};
  for (const [leg, ph] of Object.entries(G.phase)) { const k = leg.split("-")[0]; o[leg] = [curve(G.legs[k].upper, t + ph), curve(G.legs[k].lower, t + ph)]; }
  o.pitch = wave(G.body.pitch, t); o.bob = -G.body.bob[0] * Math.cos(2 * Math.PI * t);
  o.head = G.head.follow * o.pitch + wave(G.head.nod, t); o.tail = wave(G.tail.flick, t, G.tail.freq);
  return o;
}
const RAD = Math.PI / 180;

// ------------------------------------------------------------- the flight: a 10 s pass on an arc, banking, pushed by the wind
function flight(ms, W, H) {
  const u = (ms / 10000) % 1;                         // one pass every 10 s, back to back (the worst case)
  const teamW = (R.first[0] + R.spacing + 260) * SCALE;
  const x = -teamW + u * (W + teamW * 1.2);
  const arc = Math.sin(u * Math.PI);
  const y = H * 0.36 - arc * H * 0.08 + Math.sin(ms / 1700) * 6;
  const bank = Math.cos(u * Math.PI) * -3;            // nose up climbing, down descending
  return { x, y, bank };
}
const windAt = ms => 0.6 + 0.4 * Math.sin(ms / 2300);  // the weather's gust, shared by snow and team

// ------------------------------------------------------------- snow (the weather effects' approach: sprites drawn once)
function flakeSprite(r) {
  const c = new OffscreenCanvas(Math.ceil(r * 4 * DPR), Math.ceil(r * 4 * DPR)), x = c.getContext("2d"), m = c.width / 2;
  const g = x.createRadialGradient(m, m, 0, m, m, m); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); return c.transferToImageBitmap();
}
let flakes = [], frontFlakes = [], FLAKES = [];
function makeSnow(W, H) {
  FLAKES = [1.4, 2.0, 2.8, 3.6].map(flakeSprite);
  const mk = n => Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.floor(Math.random() * 4), v: 30 + Math.random() * 50, d: Math.random() * 6.28 }));
  flakes = mk(+(Q.get("snow") || 160)); frontFlakes = mk(+(Q.get("front") || 36));
}
function drawSnow(ctx, list, dt, ms, W, H) {
  const wind = windAt(ms) * 40;
  for (const f of list) {
    f.y += f.v * dt; f.x += (wind + Math.sin(ms / 900 + f.d) * 12) * dt;
    if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; } if (f.x > W + 10) f.x = -10;
    const b = FLAKES[f.s]; ctx.drawImage(b, f.x - b.width / DPR / 2, f.y - b.height / DPR / 2, b.width / DPR, b.height / DPR);
  }
}

// ------------------------------------------------------------- the team on a canvas, from cached bitmaps
const BMP = {};
async function rasterise() {
  const k = SCALE * DPR * 1.0;
  for (const [name, svg] of Object.entries(PARTS)) {
    const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); await img.decode();
    const w = Math.ceil(P[name].w * k), h = Math.ceil(P[name].h * k);
    const c = new OffscreenCanvas(w, h); c.getContext("2d").drawImage(img, 0, 0, w, h);
    BMP[name] = c.transferToImageBitmap();
  }
}
function part(ctx, name) { const p = P[name]; ctx.drawImage(BMP[name], -p.pivot[0], -p.pivot[1], p.w, p.h); }
function at(ctx, x, y, deg, fn) { ctx.save(); ctx.translate(x, y); if (deg) ctx.rotate(deg * RAD); fn(); ctx.restore(); }
const reins = [];
function drawDeer(ctx, k, p, lead) {
  const bp = P["reindeer-body"].pivot, rel = ([x, y], o = [0, 0]) => [x + o[0] - bp[0], y + o[1] - bp[1]];
  ctx.save(); ctx.translate(0, p.bob); ctx.rotate(p.pitch * RAD);
  const leg = (kind, far) => {
    const key = kind + (far ? "-far" : ""), up = `reindeer-${kind}-upper${far ? "-far" : ""}`, lo = `reindeer-${kind}-lower${far ? "-far" : ""}`;
    const [ax, ay] = rel(R.legs[kind], far ? R.far_offset : [0, 0]), j = R.joints[kind], upv = P[up].pivot;
    at(ctx, ax, ay, p[key][0], () => { at(ctx, j[0] - upv[0], j[1] - upv[1], p[key][1], () => part(ctx, lo)); part(ctx, up); });
  };
  leg("back", true); leg("front", true);
  const [tx, ty] = rel(R.tail); at(ctx, tx, ty, p.tail, () => part(ctx, "reindeer-tail"));
  leg("back", false); leg("front", false);
  part(ctx, "reindeer-body");
  const [hx, hy] = rel(R.head); at(ctx, hx, hy, p.head, () => part(ctx, lead ? "reindeer-head-lead" : "reindeer-head"));
  const [rx, ry] = rel(R.rein_ring); reins[k] = ctx.getTransform().transformPoint(new DOMPoint(rx, ry));
  ctx.restore();
}
function drawTeam(ctx, ms, fl) {
  const t = ms / 1000 / G.period, sp = P.sleigh.pivot, sg = G.sleigh;
  ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(fl.bank * RAD); ctx.scale(SCALE, SCALE);
  // the sleigh, riding the stride with a lag
  ctx.save(); ctx.translate(sp[0], sp[1] + wave(sg.bob, t / 2)); ctx.rotate(wave(sg.sway, t / 2) * RAD);
  part(ctx, "sleigh");
  const arm = SL.arm.at; at(ctx, arm[0] - sp[0], arm[1] - sp[1], wave(sg.arm, t), () => part(ctx, "santa-arm"));
  const hands = ctx.getTransform().transformPoint(new DOMPoint(SL.reins_from[0] - sp[0], SL.reins_from[1] - sp[1]));
  ctx.restore();
  const bp = P["reindeer-body"].pivot, gust = windAt(ms);
  for (let k = 0; k < 2; k++) {
    const p = pose(t + k * G.second_deer_phase);
    ctx.save(); ctx.translate(R.first[0] + k * R.spacing + bp[0], R.first[1] + bp[1] + Math.sin(ms / 800 + k) * 3 * gust);
    drawDeer(ctx, k, p, k === 1); ctx.restore();
  }
  ctx.restore();
  // reins, under everything already drawn on this layer, sagging between the hands and the rings
  ctx.save(); ctx.globalCompositeOperation = "destination-over"; ctx.strokeStyle = "#C9A46E"; ctx.lineWidth = 2 * DPR;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const r of reins) { if (!r) continue; ctx.beginPath(); ctx.moveTo(hands.x, hands.y);
    ctx.quadraticCurveTo((hands.x + r.x) / 2, Math.max(hands.y, r.y) + 26 * SCALE * DPR, r.x, r.y); ctx.stroke(); }
  ctx.restore();
}

// ------------------------------------------------------------- the team as live SVG, transforms set every frame
let svgRefs = null;
function buildSvg(W, H) {
  const ns = "http://www.w3.org/2000/svg", host = document.getElementById("svgLayer");
  let defs = "";
  for (const [name, svg] of Object.entries(PARTS)) {
    let inner = svg.split(">").slice(1).join(">").replace(/<\/svg>\s*$/, "");
    for (const id of new Set([...inner.matchAll(/id="([^"]+)"/g)].map(m => m[1])))
      inner = inner.split(`id="${id}"`).join(`id="${name}-${id}"`).split(`url(#${id})`).join(`url(#${name}-${id})`);
    defs += `<symbol id="p-${name}" viewBox="0 0 ${P[name].w} ${P[name].h}" overflow="visible">${inner}</symbol>`;
  }
  const use = n => `<use href="#p-${n}" x="${-P[n].pivot[0]}" y="${-P[n].pivot[1]}" width="${P[n].w}" height="${P[n].h}"/>`;
  const bp = P["reindeer-body"].pivot, rel = ([x, y], o = [0, 0]) => [x + o[0] - bp[0], y + o[1] - bp[1]];
  const grp = (id, [x, y], inner) => `<g transform="translate(${x},${y})"><g id="${id}">${inner}</g></g>`;
  let deer = "";
  for (let k = 0; k < 2; k++) {
    const leg = (kind, far) => { const key = kind + (far ? "-far" : ""), j = R.joints[kind], up = `reindeer-${kind}-upper${far ? "-far" : ""}`, upv = P[up].pivot;
      return grp(`d${k}-${key}-u`, rel(R.legs[kind], far ? R.far_offset : [0, 0]), grp(`d${k}-${key}-l`, [j[0] - upv[0], j[1] - upv[1]], use(`reindeer-${kind}-lower${far ? "-far" : ""}`)) + use(up)); };
    deer += `<g transform="translate(${R.first[0] + k * R.spacing + bp[0]},${R.first[1] + bp[1]})"><g id="d${k}-body">` +
      leg("back", true) + leg("front", true) + grp(`d${k}-tail`, rel(R.tail), use("reindeer-tail")) + leg("back", false) + leg("front", false) +
      use("reindeer-body") + grp(`d${k}-head`, rel(R.head), use(k ? "reindeer-head-lead" : "reindeer-head")) + `</g></g>`;
  }
  const sp = P.sleigh.pivot;
  host.innerHTML = `<svg xmlns="${ns}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>` +
    `<g id="team"><path id="rein0" stroke="#C9A46E" stroke-width="2" fill="none"/><path id="rein1" stroke="#C9A46E" stroke-width="2" fill="none"/>` +
    `<g transform="translate(${sp[0]},${sp[1]})"><g id="sl">${use("sleigh")}${grp("arm", [SL.arm.at[0] - sp[0], SL.arm.at[1] - sp[1]], use("santa-arm"))}</g></g>${deer}</g></svg>`;
  const $ = id => document.getElementById(id);
  svgRefs = { team: $("team"), sl: $("sl"), arm: $("arm"), reins: [$("rein0"), $("rein1")], d: [0, 1].map(k => {
    const o = { body: $(`d${k}-body`), head: $(`d${k}-head`), tail: $(`d${k}-tail`) };
    for (const leg of Object.keys(G.phase)) { o[leg + "u"] = $(`d${k}-${leg}-u`); o[leg + "l"] = $(`d${k}-${leg}-l`); } return o; }) };
}
function drawSvgTeam(ms, fl) {
  const t = ms / 1000 / G.period, sg = G.sleigh, r = svgRefs;
  r.team.setAttribute("transform", `translate(${fl.x},${fl.y}) rotate(${fl.bank}) scale(${SCALE})`);
  r.sl.setAttribute("transform", `translate(0,${wave(sg.bob, t / 2)}) rotate(${wave(sg.sway, t / 2)})`);
  r.arm.setAttribute("transform", `rotate(${wave(sg.arm, t)})`);
  const bp = P["reindeer-body"].pivot, hx = SL.reins_from[0], hy = SL.reins_from[1];
  for (let k = 0; k < 2; k++) {
    const p = pose(t + k * G.second_deer_phase), d = r.d[k];
    d.body.setAttribute("transform", `translate(0,${p.bob}) rotate(${p.pitch})`);
    d.head.setAttribute("transform", `rotate(${p.head})`); d.tail.setAttribute("transform", `rotate(${p.tail})`);
    for (const leg of Object.keys(G.phase)) { d[leg + "u"].setAttribute("transform", `rotate(${p[leg][0]})`); d[leg + "l"].setAttribute("transform", `rotate(${p[leg][1]})`); }
    const rx = R.first[0] + k * R.spacing + R.rein_ring[0], ry = R.first[1] + R.rein_ring[1] + p.bob;
    r.reins[k].setAttribute("d", `M${hx},${hy} Q${(hx + rx) / 2},${Math.max(hy, ry) + 34} ${rx},${ry}`);
  }
}

// ------------------------------------------------------------- the loop and the measurements
const back = document.getElementById("back"), front = document.getElementById("front");
let W, H, bctx, fctx;
function size() {
  W = innerWidth; H = innerHeight;
  for (const c of [back, front]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  bctx = back.getContext("2d"); fctx = front.getContext("2d");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
let longFrames = 0;
try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 50) longFrames++; }).observe({ type: "long-animation-frame", buffered: false }); }
catch { try { new PerformanceObserver(l => { longFrames += l.getEntries().length; }).observe({ type: "longtask", buffered: false }); } catch {} }

async function run(mode, secs, measure = true) {
  const status = document.getElementById("status"); status.hidden = false;
  document.getElementById("svgLayer").style.display = mode === "svg" ? "" : "none";
  if (mode === "svg") buildSvg(W, H);
  const intervals = [], work = []; let frames = 0, last = 0, lastDraw = 0, t0 = 0; longFrames = 0;
  return new Promise(resolve => {
    const tick = now => {
      if (!t0) t0 = now;
      const el = (now - t0) / 1000;
      if (el > secs + WARM) {
        fctx.clearRect(0, 0, front.width, front.height); bctx.clearRect(0, 0, back.width, back.height);
        document.getElementById("svgLayer").style.display = "none";
        const fps = frames / secs;
        return resolve({ mode, secs, frames, fps: +fps.toFixed(1), intervalP50: +pct(intervals, 0.5).toFixed(1), intervalP95: +pct(intervals, 0.95).toFixed(1),
          intervalMax: +Math.max(0, ...intervals).toFixed(1), workMean: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(2),
          workP95: +pct(work, 0.95).toFixed(2), dropped: intervals.filter(i => i > FRAME_MS * 1.5).length, longFrames });
      }
      requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 1) return;          // Kinboard's 30 fps cap, as in the weather effects
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30; last = now;
      const s = performance.now();
      bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, back.width, back.height); bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, front.width, front.height); fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawSnow(bctx, flakes, dt, now, W, H);
      if (mode !== "weather") {
        const fl = flight(now - t0, W, H);
        if (mode === "sprites") drawTeam(fctx, now - t0, fl); else drawSvgTeam(now - t0, fl);
        drawSnow(fctx, frontFlakes, dt, now, W, H);
      }
      const w = performance.now() - s;
      if (el > WARM && measure) { if (lastDraw) intervals.push(now - lastDraw); work.push(w); frames++; }
      lastDraw = now;
      status.textContent = `${mode} · ${Math.max(0, Math.ceil(secs + WARM - el))} s`;
    };
    requestAnimationFrame(tick);
  });
}
function grade(r) { return r.fps >= 28.5 && r.intervalP95 <= 45 ? "ok" : r.fps >= 24 ? "warn" : "bad"; }
function device() {
  return { ua: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory, screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`, dpr: window.devicePixelRatio, note: Q.get("note") || "" };
}
async function benchmark() {
  document.getElementById("go").disabled = true; document.getElementById("panel").style.display = "none";
  const t = performance.now(); await rasterise(); const rasteriseMs = +(performance.now() - t).toFixed(0);
  const results = [];
  for (const m of MODES) { results.push(await run(m, SECS)); await sleep(1000); }
  document.getElementById("status").hidden = true;
  const out = { device: device(), rasteriseMs, results, when: new Date().toISOString() };
  window.__bench = out;
  const label = { weather: "Snow only (today)", sprites: "Snow + sleigh, cached images", svg: "Snow + sleigh, live SVG" };
  document.getElementById("results").innerHTML =
    `<table><tr><th>Scene</th><th>fps</th><th>frame p50</th><th>p95</th><th>max</th><th>script/frame</th><th>long frames</th></tr>` +
    results.map(r => `<tr><td>${esc(label[r.mode] || r.mode)}</td><td class="${grade(r)}">${r.fps}</td><td>${r.intervalP50} ms</td><td>${r.intervalP95} ms</td><td>${r.intervalMax} ms</td><td>${r.workMean} ms</td><td>${r.longFrames}</td></tr>`).join("") +
    `</table><p>Preparing the images took ${rasteriseMs} ms (once per festival). Target: 30 fps, frames every ~33 ms.</p>` +
    `<p>Please copy this and paste it into the discussion:</p><textarea readonly>${esc(JSON.stringify(out, null, 1))}</textarea>` +
    `<p><button id="copy">Copy results</button></p>`;
  document.getElementById("copy").onclick = () => navigator.clipboard?.writeText(JSON.stringify(out, null, 1));
  document.getElementById("panel").style.display = ""; document.querySelector("#panel h1").textContent = "Results"; document.getElementById("go").remove(); document.getElementById("demo").remove();
}
async function demo() { document.getElementById("panel").style.display = "none"; await rasterise(); while (true) await run("sprites", 3600, false); }

size(); makeSnow(W, H);
addEventListener("resize", () => { size(); makeSnow(W, H); });
document.getElementById("go").onclick = benchmark; document.getElementById("demo").onclick = demo;
if (Q.get("auto") === "1") benchmark();
</script></body></html>
"""
html = (HTML.replace("__PARTS__", json.dumps(parts)).replace("__META__", json.dumps(meta))
        .replace("__BG__", f"url('{bg}')" if bg else "none"))
with open(os.path.join(OUT, "scene.html"), "w") as f:
    f.write(html)
print("scene.html", round(len(html) / 1024), "KB")

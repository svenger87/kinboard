"""Generates the RFC-020 mockups. Run from the repo root: python3 docs/rfc/020/mockups.py docs/rfc/020"""
import math, random, sys, os

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

BG0, BG1 = "#0f1422", "#161d30"
CARD, CARD_STROKE, LINE = "#1b2232", "#2c3549", "#2a3347"
TEXT, MUTED, AMBER = "#e8ebf2", "#8c94a8", "#f5b84a"

REDUCED = "@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"


def svg(w, h, body, style="", title=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="{FONT}" role="img" aria-label="{title}">\n<title>{title}</title>\n'
            f"<style>{style}\n{REDUCED}</style>\n{body}\n</svg>\n")


def save(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)


def background(w, h, extra=""):
    return (f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG0}"/>'
            f'<stop offset="1" stop-color="{BG1}"/></linearGradient>'
            f'<radialGradient id="wash" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="#3a6ea5" stop-opacity="0.18"/>'
            f'<stop offset="1" stop-color="#3a6ea5" stop-opacity="0"/></radialGradient>{extra}</defs>'
            f'<rect width="{w}" height="{h}" fill="url(#bg)"/><rect width="{w}" height="{h}" fill="url(#wash)"/>')


def card(x, y, w, h, title, lines=(0.8, 0.6, 0.7, 0.45), icon="#3a6ea5"):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{CARD}" stroke="{CARD_STROKE}"/>',
           f'<rect x="{x+18}" y="{y+20}" width="26" height="26" rx="8" fill="{icon}" opacity="0.85"/>',
           f'<text x="{x+54}" y="{y+39}" font-size="17" font-weight="600" fill="{TEXT}">{title}</text>']
    ly = y + 66
    for f in lines:
        if ly + 10 > y + h - 16:
            break
        out.append(f'<rect x="{x+20}" y="{ly}" width="{(w-40)*f:.0f}" height="10" rx="5" fill="{LINE}"/>')
        ly += 24
    return "\n".join(out)


def snowcap(x, y, w, seed=1):
    """Snow resting on a card's top edge, with a few icicles. Stays above the title row."""
    rnd = random.Random(seed)
    pts = []
    n = int(w // 22)
    for i in range(n + 1):
        px = x - 3 + (w + 6) * i / n
        pts.append((px, y - 5 - rnd.uniform(0, 7)))
    d = f"M{x-3},{y+14} L{x-3},{pts[0][1]:.1f} "
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        mx = (ax + bx) / 2
        d += f"Q{mx:.1f},{min(ay, by) - 6:.1f} {bx:.1f},{by:.1f} "
    d += f"L{x+w+3},{y+14} "
    # drippy underside
    for i in range(n, -1, -1):
        px = x - 3 + (w + 6) * i / n
        d += f"L{px:.1f},{y + 6 + rnd.uniform(0, 6):.1f} "
    d += "Z"
    out = [f'<path d="{d}" fill="#f4f8ff"/>', f'<path d="{d}" fill="none" stroke="#c9d6ea" stroke-width="1" opacity="0.6"/>']
    for i in range(4):
        ix = x + 30 + rnd.uniform(0, w - 60)
        il = rnd.uniform(7, 14)
        out.append(f'<path d="M{ix-3:.1f},{y+8} L{ix+3:.1f},{y+8} L{ix:.1f},{y+8+il:.1f} Z" fill="#dce8f8" opacity="0.9"/>')
    return "\n".join(out)


def light_string(x, y, w, sag=10, n=11):
    colors = ["#ff5a5a", "#ffd24a", "#4ad66d", "#4aa8ff"]
    out = [f'<path d="M{x},{y} Q{x+w/4},{y+sag} {x+w/2},{y} Q{x+3*w/4},{y+sag} {x+w},{y}" fill="none" stroke="#3b4a3a" stroke-width="1.5"/>']
    for i in range(n):
        t = (i + 0.5) / n
        seg = 0 if t < 0.5 else 1
        lt = (t * 2) % 1
        sx = x + seg * w / 2
        bx = sx + lt * w / 2
        by = y + 2 * lt * (1 - lt) * sag * 2 * 0.5 * 2
        c = colors[i % 4]
        out.append(f'<circle cx="{bx:.1f}" cy="{by+4:.1f}" r="7" fill="{c}" opacity="0.25"/>'
                   f'<ellipse cx="{bx:.1f}" cy="{by+4:.1f}" rx="3" ry="4" fill="{c}"/>')
    return "\n".join(out)


def sleigh(scale=1.0):
    """Santa's sleigh and two reindeer flying right, ~250 x 70 at scale 1, origin top-left."""
    deer = []
    for i, cx in enumerate((150, 215)):
        lead = i == 1
        deer.append(f'''
      <g>
        <path d="M{cx-14},38 L{cx-26},50 M{cx-6},38 L{cx-16},52 M{cx+10},38 L{cx+22},48 M{cx+16},37 L{cx+30},43" stroke="#8a5a32" stroke-width="3.5" stroke-linecap="round"/>
        <ellipse cx="{cx}" cy="30" rx="24" ry="10" fill="#b07a45"/>
        <ellipse cx="{cx-2}" cy="33" rx="14" ry="5" fill="#b07a45"/>
        <path d="M{cx+14},26 Q{cx+22},18 {cx+27},11" stroke="#b07a45" stroke-width="9" stroke-linecap="round" fill="none"/>
        <ellipse cx="{cx+32}" cy="9" rx="9" ry="6" fill="#b07a45"/>
        <circle cx="{cx+33}" cy="6" r="1.6" fill="#1a1a1a"/>
        <path d="M{cx+27},4 L{cx+22},-8 M{cx+24},-3 L{cx+17},-6 M{cx+23},-6 L{cx+26},-13 M{cx+31},3 L{cx+31},-10 M{cx+31},-5 L{cx+36},-10" stroke="#e2cfa8" stroke-width="2.2" stroke-linecap="round"/>
        {f'<circle cx="{cx+41}" cy="10" r="7" fill="#ff4d4d" opacity="0.3"/><circle cx="{cx+41}" cy="10" r="3.2" fill="#ff4d4d"/>' if lead else f'<circle cx="{cx+41}" cy="10" r="2.6" fill="#3a2414"/>'}
        <path d="M{cx-20},28 Q{cx-28},22 {cx-26},31" fill="#f1e6d2"/>
      </g>''')
    return f'''<g transform="scale({scale})">
      <path d="M62,8 Q110,2 182,9 M62,10 Q140,14 247,9" stroke="#d9c3a0" stroke-width="1.2" fill="none"/>
      {"".join(deer)}
      <path d="M0,22 L72,22 Q90,22 92,42 L22,50 Q4,50 0,22 Z" fill="#e04848"/>
      <path d="M4,26 L70,26" stroke="#f0c75e" stroke-width="2"/>
      <path d="M10,60 L88,60 Q104,60 101,46" stroke="#e3b341" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M26,50 L24,60 M72,46 L74,60" stroke="#e3b341" stroke-width="2.5"/>
      <circle cx="18" cy="12" r="14" fill="#7a4b2a"/>
      <rect x="6" y="-4" width="12" height="11" rx="2" fill="#4aa8ff"/><rect x="11" y="-4" width="2" height="11" fill="#ffd24a"/>
      <rect x="20" y="-8" width="11" height="14" rx="2" fill="#4ad66d"/><rect x="20" y="-2" width="11" height="2" fill="#ff5a5a"/>
      <circle cx="54" cy="14" r="13" fill="#d23b44"/>
      <circle cx="58" cy="-1" r="7.5" fill="#f2c9a5"/>
      <path d="M51,1 Q58,14 65,1 Q62,8 58,9 Q54,8 51,1 Z" fill="#ffffff"/>
      <path d="M50,-4 Q57,-22 70,-12 L64,-4 Z" fill="#d23b44"/>
      <rect x="49" y="-6" width="17" height="4" rx="2" fill="#ffffff"/>
      <circle cx="71" cy="-12" r="3" fill="#ffffff"/>
      <path d="M62,4 L80,10" stroke="#d23b44" stroke-width="4" stroke-linecap="round"/>
    </g>'''


def sparkle_trail():
    out = []
    for i in range(9):
        out.append(f'<circle cx="{-8 - i*16}" cy="{44 + math.sin(i)*5:.1f}" r="{2.6 - i*0.24:.2f}" fill="#ffe9a8" opacity="{0.9 - i*0.09:.2f}"/>')
    return "".join(out)


def snowflakes(w, h, n, seed=3, cls=True):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        x, y, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(1.2, 3.2)
        dur = rnd.uniform(9, 18)
        delay = -rnd.uniform(0, dur)
        drift = rnd.uniform(-25, 25)
        out.append(f'<circle class="flake" cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="#ffffff" opacity="{rnd.uniform(0.45, 0.9):.2f}" '
                   f'style="--dy:{h+40}px;--dx:{drift:.0f}px;animation-duration:{dur:.1f}s;animation-delay:{delay:.1f}s"/>')
    return "\n".join(out)


FLAKE_CSS = ("@keyframes fall { from { transform: translate(0, calc(var(--dy) * -1)); } to { transform: translate(var(--dx), 0); } }"
             ".flake { animation: fall linear infinite; }")


def creature(cx, cy, s=1.0, body="#6cc49a", belly="#a8e3c4"):
    return f'''<g transform="translate({cx},{cy}) scale({s})">
      <ellipse cx="0" cy="44" rx="40" ry="6" fill="#000" opacity="0.18"/>
      <ellipse cx="-22" cy="36" rx="12" ry="8" fill="{body}"/><ellipse cx="22" cy="36" rx="12" ry="8" fill="{body}"/>
      <ellipse cx="0" cy="0" rx="46" ry="42" fill="{body}"/>
      <ellipse cx="0" cy="14" rx="28" ry="22" fill="{belly}"/>
      <ellipse cx="-15" cy="-8" rx="9" ry="10" fill="#fff"/><ellipse cx="15" cy="-8" rx="9" ry="10" fill="#fff"/>
      <circle cx="-13" cy="-6" r="5" fill="#1d2433"/><circle cx="17" cy="-6" r="5" fill="#1d2433"/>
      <circle cx="-11" cy="-8" r="1.6" fill="#fff"/><circle cx="19" cy="-8" r="1.6" fill="#fff"/>
      <ellipse cx="-27" cy="6" rx="6" ry="4" fill="#ff8fa3" opacity="0.6"/><ellipse cx="27" cy="6" rx="6" ry="4" fill="#ff8fa3" opacity="0.6"/>
      <path d="M-6,8 Q0,13 6,8" stroke="#1d2433" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>'''


def hat(kind, cx, cy, s=1.0):
    g = f'<g transform="translate({cx},{cy}) scale({s})">'
    if kind == "santa":
        g += ('<path d="M-30,-30 Q-8,-78 30,-62 Q44,-56 46,-40 L26,-36 Q22,-52 8,-54 Q-6,-50 22,-34 Z" fill="#d23b44"/>'
              '<path d="M-34,-36 Q0,-46 30,-34 L30,-26 Q0,-36 -34,-26 Z" fill="#fff"/><circle cx="47" cy="-38" r="8" fill="#fff"/>')
    elif kind == "bunny":
        g += ('<path d="M-30,-36 Q-2,-44 30,-36" stroke="#f3f3f3" stroke-width="5" fill="none"/>'
              '<ellipse cx="-14" cy="-70" rx="10" ry="30" fill="#f6f6f6" transform="rotate(-12 -14 -70)"/>'
              '<ellipse cx="-14" cy="-68" rx="5" ry="22" fill="#ffb3c4" transform="rotate(-12 -14 -68)"/>'
              '<ellipse cx="16" cy="-70" rx="10" ry="30" fill="#f6f6f6" transform="rotate(14 16 -70)"/>'
              '<ellipse cx="16" cy="-68" rx="5" ry="22" fill="#ffb3c4" transform="rotate(14 16 -68)"/>')
    elif kind == "witch":
        g += ('<ellipse cx="0" cy="-34" rx="50" ry="9" fill="#2b2140"/>'
              '<path d="M-24,-36 L4,-96 Q10,-104 18,-92 L10,-86 L24,-36 Z" fill="#3b2d5c"/>'
              '<rect x="-23" y="-46" width="46" height="8" fill="#f5b84a"/><rect x="-5" y="-47" width="10" height="10" rx="2" fill="none" stroke="#2b2140" stroke-width="2"/>')
    elif kind == "party":
        g += ('<path d="M-20,-36 L4,-92 L24,-36 Z" fill="#4aa8ff"/>'
              '<path d="M-12,-54 L14,-54 M-6,-70 L10,-70" stroke="#ffd24a" stroke-width="5"/>'
              '<circle cx="4" cy="-94" r="7" fill="#ff5a5a"/>'
              '<circle cx="-34" cy="-70" r="2.5" fill="#ffd24a"/><rect x="34" y="-82" width="5" height="5" fill="#4ad66d" transform="rotate(20 36 -80)"/><circle cx="40" cy="-58" r="2.5" fill="#ff5a5a"/>')
    elif kind == "lunar":
        g += ('<path d="M-30,-34 Q0,-70 30,-34 Z" fill="#c8323c"/><rect x="-32" y="-38" width="64" height="7" rx="3" fill="#e3b341"/>'
              '<circle cx="0" cy="-60" r="6" fill="#e3b341"/>'
              '<g transform="translate(56,-6)"><path d="M0,-34 L0,-22" stroke="#e3b341" stroke-width="2"/>'
              '<ellipse cx="0" cy="-8" rx="14" ry="13" fill="#d62f2f"/><rect x="-7" y="-23" width="14" height="4" fill="#e3b341"/>'
              '<rect x="-7" y="3" width="14" height="4" fill="#e3b341"/><path d="M0,7 L0,18" stroke="#e3b341" stroke-width="2"/></g>')
    elif kind == "diwali":
        g += ('<path d="M-38,-30 Q0,-52 38,-30" fill="none" stroke="#ff9f1c" stroke-width="7" stroke-dasharray="1 9" stroke-linecap="round"/>'
              '<g transform="translate(58,30)">' + diya(0, 0) + '</g>')
    return g + "</g>"


def diya(x, y, s=1.0, flicker=True):
    cls = ' class="flame"' if flicker else ""
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<ellipse cx="0" cy="-12" rx="9" ry="12" fill="#ffd24a" opacity="0.25"/>'
            f'<path{cls} d="M0,-22 Q6,-12 0,-4 Q-6,-12 0,-22 Z" fill="#ffb02e"/>'
            f'<path d="M-15,-4 Q0,2 15,-4 Q12,8 0,9 Q-12,8 -15,-4 Z" fill="#c8572a"/>'
            f'<path d="M-15,-4 Q0,2 15,-4" stroke="#f0c75e" stroke-width="1.5" fill="none"/></g>')


def lantern(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<path d="M0,-30 L0,-14" stroke="#e3b341" stroke-width="1.5"/>'
            f'<ellipse cx="0" cy="0" rx="17" ry="15" fill="#ff6b4a" opacity="0.25"/>'
            f'<ellipse cx="0" cy="0" rx="15" ry="13" fill="#d62f2f"/>'
            f'<path d="M-6,-12 Q-10,0 -6,12 M6,-12 Q10,0 6,12" stroke="#a81f1f" stroke-width="1.2" fill="none"/>'
            f'<rect x="-7" y="-16" width="14" height="4" rx="1" fill="#e3b341"/><rect x="-7" y="12" width="14" height="4" rx="1" fill="#e3b341"/>'
            f'<path d="M-2,16 L-3,28 M0,16 L0,30 M2,16 L3,28" stroke="#e3b341" stroke-width="1.2"/></g>')


def pumpkin(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<ellipse cx="-11" cy="0" rx="12" ry="15" fill="#e8741c"/><ellipse cx="11" cy="0" rx="12" ry="15" fill="#e8741c"/>'
            f'<ellipse cx="0" cy="0" rx="12" ry="16" fill="#f08a2a"/>'
            f'<path d="M0,-15 Q2,-24 7,-26" stroke="#4d7a2a" stroke-width="4" fill="none" stroke-linecap="round"/>'
            f'<path d="M-12,-4 L-7,-9 L-3,-4 Z M3,-4 L7,-9 L12,-4 Z" fill="#3a1a05"/>'
            f'<path d="M-11,5 Q0,13 11,5 L7,6 L4,9 L0,6 L-4,9 L-7,6 Z" fill="#3a1a05"/></g>')


def bat(x, y, s=1.0, fill="#1d1630"):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M0,0 Q-8,-8 -18,-6 Q-14,-2 -16,4 Q-10,0 -6,4 Q-3,0 0,3 '
            f'Q3,0 6,4 Q10,0 16,4 Q14,-2 18,-6 Q8,-8 0,0 Z" fill="{fill}"/><circle cx="0" cy="-1" r="3.5" fill="{fill}"/>'
            f'<circle cx="-1.2" cy="-1.5" r="0.8" fill="#f5b84a"/><circle cx="1.2" cy="-1.5" r="0.8" fill="#f5b84a"/></g>')


def bunny(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<ellipse cx="0" cy="0" rx="16" ry="12" fill="#f2efe9"/><circle cx="-15" cy="-2" r="5" fill="#ffffff"/>'
            f'<circle cx="13" cy="-10" r="9" fill="#f2efe9"/>'
            f'<ellipse cx="10" cy="-26" rx="3.5" ry="11" fill="#f2efe9" transform="rotate(-10 10 -26)"/>'
            f'<ellipse cx="17" cy="-25" rx="3.5" ry="11" fill="#f2efe9" transform="rotate(12 17 -25)"/>'
            f'<ellipse cx="17" cy="-25" rx="1.6" ry="7" fill="#ffb3c4" transform="rotate(12 17 -25)"/>'
            f'<circle cx="16" cy="-11" r="1.4" fill="#1d2433"/><circle cx="21" cy="-8" r="1.3" fill="#ff8fa3"/>'
            f'<ellipse cx="6" cy="10" rx="6" ry="3" fill="#e3ddd2"/></g>')


def egg(x, y, s=1.0, c1="#ffb3c4", c2="#a8e3c4"):
    return (f'<g transform="translate({x},{y}) scale({s})"><ellipse cx="0" cy="0" rx="12" ry="16" fill="{c1}"/>'
            f'<path d="M-11,-3 L-6,-7 L-1,-3 L4,-7 L9,-3 L11,-1" stroke="{c2}" stroke-width="3" fill="none"/>'
            f'<path d="M-11,6 Q0,10 11,6" stroke="#fff" stroke-width="2.5" fill="none" opacity="0.8"/></g>')


def burst(x, y, r, color, n=14):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        out.append(f'<path d="M{x + math.cos(a)*r*0.25:.1f},{y + math.sin(a)*r*0.25:.1f} L{x + math.cos(a)*r:.1f},{y + math.sin(a)*r:.1f}" '
                   f'stroke="{color}" stroke-width="2.4" stroke-linecap="round"/>'
                   f'<circle cx="{x + math.cos(a)*r*1.12:.1f}" cy="{y + math.sin(a)*r*1.12:.1f}" r="1.8" fill="{color}"/>')
    return f'<g>{"".join(out)}</g>'


def marker(n, x, y):
    return (f'<g><circle cx="{x}" cy="{y}" r="13" fill="{AMBER}"/>'
            f'<text x="{x}" y="{y+5}" text-anchor="middle" font-size="14" font-weight="700" fill="#1b1405">{n}</text></g>')


# ---------------------------------------------------------------- 1. Home at Christmas
def home():
    W, H = 1200, 850
    cols = [40, 325, 610, 895]
    cw = 265
    rows = [(270, 200), (495, 210)]
    titles = [["Calendar", "Weather", "Tasks", "Shopping"], ["Creatures", "Messages", "Timer", "Meals"]]
    icons = ["#3a6ea5", "#4a9bd6", "#5fae6e", "#c98a3a", "#7a5fc4", "#c45f8a", "#4aa3a3", "#c4735f"]
    body = [background(W, H)]
    body.append(f'<g>{snowflakes(W, 700, 70)}</g>')
    # hero
    body.append(f'<text x="60" y="150" font-size="96" font-weight="600" fill="{TEXT}" letter-spacing="-2">16:42</text>'
                f'<text x="64" y="192" font-size="22" fill="{MUTED}">Sunday, 29 November · 1st Advent</text>'
                f'<text x="1140" y="140" text-anchor="end" font-size="60" font-weight="600" fill="{TEXT}">−1°</text>'
                f'<text x="1140" y="174" text-anchor="end" font-size="19" fill="{MUTED}">Light snow</text>')
    # flight path hint
    body.append(f'<path d="M-40,70 Q300,10 600,30 T1240,40" fill="none" stroke="{AMBER}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 8"/>')
    # cards
    k = 0
    for ri, (ry, rh) in enumerate(rows):
        for ci, cx in enumerate(cols):
            body.append(card(cx, ry, cw, rh, titles[ri][ci], icon=icons[k]))
            k += 1
    # creature in the Creatures card, with a Santa hat
    body.append(f'<rect x="{cols[0]+16}" y="{rows[1][0]+60}" width="{cw-32}" height="{rows[1][1]-76}" rx="12" fill="{CARD}"/>')
    body.append(creature(cols[0] + cw/2, rows[1][0] + 135, 0.82))
    body.append(hat("santa", cols[0] + cw/2, rows[1][0] + 135, 0.82))
    # dressing: snow on every card, lights on the first
    k = 0
    for ry, rh in rows:
        for cx in cols:
            body.append(snowcap(cx, ry, cw, seed=k + 7))
            k += 1
    body.append(light_string(cols[0] + 14, rows[0][0] + 1, cw - 28, sag=6))
    # the sleigh
    body.append(f'<g class="sleigh" transform="translate(560,12)">{sparkle_trail()}{sleigh(0.95)}</g>')
    # markers + legend
    body.append(marker(1, 480, 30) + marker(2, cols[1] + cw - 24, rows[0][0] - 14) + marker(3, cols[0] + cw - 30, rows[1][0] + 80))
    ly = 748
    body.append(f'<rect x="0" y="{ly-24}" width="{W}" height="{H-ly+24}" fill="#0b0f19" opacity="0.85"/>')
    legend = [("1", "Visitor", "crosses the hero band, ~10 s, every 15–20 min"),
              ("2", "Dressing", "snow on the cards' top edge, above the title row"),
              ("3", "Outfit", "the creature's Santa hat")]
    lx = 40
    for n, head, rest in legend:
        body.append(marker(n, lx + 13, ly + 3) +
                    f'<text x="{lx+34}" y="{ly+9}" font-size="16" fill="{TEXT}"><tspan font-weight="700">{head}</tspan>'
                    f'<tspan fill="{MUTED}"> · {rest}</tspan></text>')
        ly += 32
    style = (FLAKE_CSS +
             "@keyframes fly { 0% { transform: translate(-330px,40px); } 22% { transform: translate(180px,14px); }"
             " 45% { transform: translate(620px,10px); } 68% { transform: translate(1220px,26px); } 69%,100% { transform: translate(1260px,26px); opacity: 0; } }"
             ".sleigh { animation: fly 16s linear infinite; animation-delay: -3.5s; }")
    save("home-christmas.svg", svg(W, H, "\n".join(body), style, "Mockup: Kinboard Home at Christmas, with the sleigh, snow on the widget cards and a creature in a Santa hat"))


# ---------------------------------------------------------------- 2. Dressing per festival
def dressings():
    W, H = 1200, 640
    cw, ch = 360, 220
    xs = [30, 420, 810]
    ys = [40, 350]
    festivals = ["Christmas", "New Year's Eve", "Lunar New Year", "Easter", "Halloween", "Diwali"]
    titles = ["Calendar", "Tasks", "Weather", "Shopping", "Messages", "Meals"]
    body = [background(W, H)]
    for i, name in enumerate(festivals):
        x, y = xs[i % 3], ys[i // 3]
        body.append(card(x, y, cw, ch, titles[i]))
        if name == "Christmas":
            body.append(snowcap(x, y, cw, seed=21) + light_string(x + 16, y + 1, cw - 32, sag=6))
        elif name == "New Year's Eve":
            rnd = random.Random(5)
            cols = ["#ffd24a", "#ff5a5a", "#4aa8ff", "#4ad66d", "#c084fc"]
            for _ in range(26):
                side = rnd.choice([0, 1])
                cx = x + (rnd.uniform(-10, 70) if side == 0 else rnd.uniform(cw - 70, cw + 10))
                cy = y + rnd.uniform(-14, 14)
                c = rnd.choice(cols)
                if rnd.random() < 0.5:
                    body.append(f'<rect x="{cx:.0f}" y="{cy:.0f}" width="6" height="3" fill="{c}" transform="rotate({rnd.uniform(0,180):.0f} {cx:.0f} {cy:.0f})"/>')
                else:
                    body.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="2.2" fill="{c}"/>')
            body.append(burst(x + cw - 34, y - 6, 22, "#ffd24a", 12))
        elif name == "Lunar New Year":
            body.append(f'<path d="M{x+cw-130},{y+2} Q{x+cw-75},{y+16} {x+cw-14},{y+2}" stroke="#e3b341" stroke-width="1.5" fill="none"/>')
            body.append(lantern(x + cw - 108, y + 36, 0.8) + lantern(x + cw - 44, y + 36, 0.8))
        elif name == "Easter":
            pastel = ["#ffb3c4", "#a8e3c4", "#ffe08a", "#b8c6ff", "#ffcfa3"]
            n = 14
            for j in range(n):
                bx = x + 14 + (cw - 28) * j / n
                bw = (cw - 28) / n
                sag = 6 * math.sin(math.pi * (j + 0.5) / n)
                body.append(f'<path d="M{bx:.1f},{y+4+sag:.1f} L{bx+bw:.1f},{y+4+sag:.1f} L{bx+bw/2:.1f},{y+17+sag:.1f} Z" fill="{pastel[j % 5]}"/>')
            body.append(f'<path d="M{x+14},{y+4} Q{x+cw/2},{y+16} {x+cw-14},{y+4}" stroke="#d9d2c3" stroke-width="1.2" fill="none"/>')
            body.append(egg(x + cw - 14, y + ch - 6, 1.0) + egg(x + cw - 40, y + ch + 2, 0.75, "#b8c6ff", "#ffe08a"))
        elif name == "Halloween":
            wx, wy = x + cw, y
            web = [f'<path d="M{wx},{wy} L{wx-46},{wy} M{wx},{wy} L{wx-40},{wy+22} M{wx},{wy} L{wx-24},{wy+40} M{wx},{wy} L{wx},{wy+46}" stroke="#aab2c5" stroke-width="1" opacity="0.7"/>']
            for r in (14, 26, 38):
                web.append(f'<path d="M{wx-r},{wy} Q{wx-r*0.85},{wy+r*0.35} {wx-r*0.87},{wy+r*0.5} Q{wx-r*0.6},{wy+r*0.7} {wx-r*0.52},{wy+r*0.87} Q{wx-r*0.25},{wy+r*0.9} {wx},{wy+r}" stroke="#aab2c5" stroke-width="1" fill="none" opacity="0.7"/>')
            body.append("".join(web))
            body.append(pumpkin(x + 34, y + ch - 2, 1.05) + bat(x + cw - 84, y + 30, 1.0, "#7d6bb5"))
        elif name == "Diwali":
            body.append(f'<path d="M{x+14},{y+3} Q{x+cw/2},{y+20} {x+cw-14},{y+3}" fill="none" stroke="#ff9f1c" stroke-width="8" stroke-dasharray="1 10" stroke-linecap="round"/>'
                        f'<path d="M{x+20},{y+5} Q{x+cw/2},{y+22} {x+cw-20},{y+5}" fill="none" stroke="#ffd24a" stroke-width="6" stroke-dasharray="1 10" stroke-dashoffset="5" stroke-linecap="round"/>')
            for j in range(5):
                body.append(diya(x + 60 + j * 60, y + ch + 2, 1.0))
        body.append(f'<text x="{x}" y="{y+ch+50}" font-size="17" font-weight="700" fill="{TEXT}">{name.replace("&", "&amp;")}</text>')
    style = "@keyframes flick { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.82); } } .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 1.4s ease-in-out infinite; }"
    save("dressing.svg", svg(W, H, "\n".join(body), style, "Mockup: still decorations on a widget card for six festivals"))


# ---------------------------------------------------------------- 3. Visitor motion paths
def frame(x, y, w, h):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{BG0}" stroke="{CARD_STROKE}"/>',
           f'<rect x="{x+16}" y="{y+18}" width="70" height="20" rx="5" fill="{LINE}"/>']
    gw = (w - 32 - 3 * 10) / 4
    for i in range(4):
        out.append(f'<rect x="{x+16+i*(gw+10):.1f}" y="{y+h*0.5:.1f}" width="{gw:.1f}" height="{h*0.42:.1f}" rx="8" fill="{CARD}" stroke="{CARD_STROKE}"/>')
    return "\n".join(out)


def visitors():
    W, H = 1200, 640
    fw, fh = 360, 210
    xs = [30, 420, 810]
    ys = [30, 340]
    body = [background(W, H)]
    path = f'stroke="{AMBER}" stroke-width="2" stroke-dasharray="6 7" fill="none"'
    items = [
        ("Sleigh · Christmas", "left → right across the hero band · 10 s"),
        ("Bunny · Easter", "hops along the bottom edge, stops, looks, goes · 12 s"),
        ("Bats · Halloween", "flutter out of a corner, zig-zag, gone · 8 s"),
        ("Fireworks · New Year's Eve", "bursts at the family's midnight · 60 s"),
        ("Lanterns · Lunar New Year", "rise from the bottom and fade out · 15 s"),
        ("Diyas · Diwali", "light one by one along the bottom, then glow · 10 s"),
    ]
    for i, (head, rest) in enumerate(items):
        x, y = xs[i % 3], ys[i // 3]
        body.append(f'<g clip-path="url(#c{i})"><clipPath id="c{i}"><rect x="{x}" y="{y}" width="{fw}" height="{fh}" rx="14"/></clipPath>')
        body.append(frame(x, y, fw, fh))
        if i == 0:
            body.append(f'<path d="M{x-10},{y+90} Q{x+fw*0.45},{y+20} {x+fw+10},{y+70}" {path}/>')
            for sx, sy, op in ((x + 14, y + 66, 0.25), (x + 132, y + 40, 0.5), (x + 250, y + 50, 1)):
                body.append(f'<g transform="translate({sx},{sy})" opacity="{op}">{sleigh(0.36)}</g>')
        elif i == 1:
            hops = " ".join(f"Q{x+30+j*60+30},{y+fh-60} {x+30+(j+1)*60},{y+fh-28}" for j in range(5))
            body.append(f'<path d="M{x+30},{y+fh-28} {hops}" {path}/>')
            body.append(bunny(x + 30 + 5 * 60, y + fh - 40, 1.0))
            body.append(f'<g opacity="0.35">{bunny(x + 30 + 2 * 60 + 30, y + fh - 72, 1.0)}</g>')
        elif i == 2:
            body.append(f'<circle cx="{x+fw-60}" cy="{y+55}" r="26" fill="#f4e7b8" opacity="0.9"/>')
            body.append(f'<path d="M{x+20},{y+30} L{x+90},{y+80} L{x+150},{y+40} L{x+220},{y+95} L{x+300},{y+50}" {path}/>')
            for bx, by, s, op in ((x + 90, y + 80, 0.9, 0.35), (x + 220, y + 95, 1.0, 0.6), (x + 300, y + 50, 1.2, 1)):
                body.append(f'<g opacity="{op}">{bat(bx, by, s, "#8a78c4" if bx < x + fw - 90 else "#1d1630")}</g>')
        elif i == 3:
            for (bx, by, r, c) in ((x + 80, y + 70, 30, "#ffd24a"), (x + 190, y + 50, 38, "#ff5a5a"), (x + 290, y + 80, 28, "#4aa8ff")):
                body.append(f'<path d="M{bx},{y+fh-10} L{bx},{by+r}" {path}/>')
                body.append(burst(bx, by, r, c))
            body.append(f'<text x="{x+fw-16}" y="{y+34}" text-anchor="end" font-size="15" font-weight="700" fill="{TEXT}">00:00</text>')
        elif i == 4:
            for lx, top in ((x + 70, 50), (x + 170, 30), (x + 270, 60)):
                body.append(f'<path d="M{lx},{y+fh-10} L{lx},{y+top}" {path}/>')
                body.append(f'<g opacity="0.35">{lantern(lx, y + fh - 40, 0.8)}</g>')
                body.append(lantern(lx, y + top + 30, 0.8))
        elif i == 5:
            body.append(f'<path d="M{x+30},{y+fh-30} L{x+fw-30},{y+fh-30}" {path}/>')
            for j in range(6):
                lit = j < 4
                body.append(f'<g opacity="{1 if lit else 0.35}">{diya(x + 45 + j * 54, y + fh - 14, 0.9, flicker=lit)}</g>')
        body.append("</g>")
        body.append(f'<text x="{x}" y="{y+fh+30}" font-size="16" font-weight="700" fill="{TEXT}">{head}</text>'
                    f'<text x="{x}" y="{y+fh+52}" font-size="14" fill="{MUTED}">{rest}</text>')
    style = ("@keyframes vs { 0% { transform: translate(-150px, 30px); } 60% { transform: translate(270px, -6px); } 61%,100% { transform: translate(400px, 10px); opacity: 0; } }"
             ".v-sleigh { animation: vs 7s linear infinite; animation-delay: -3.5s; }"
             "@keyframes pop { 0%,30% { transform: scale(0.2); opacity: 0; } 45% { opacity: 1; } 80% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.1); opacity: 0; } }"
             ".burst { animation: pop 2.4s ease-out infinite; animation-delay: -1.5s; } .burst:nth-of-type(2n) { animation-delay: -1.9s; }"
             "@keyframes flick { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.82); } } .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 1.4s ease-in-out infinite; }")
    body_s = "\n".join(body)
    save("visitors.svg", svg(W, H, body_s, style, "Mockup: motion paths of the six visitors"))


# ---------------------------------------------------------------- 4. Animation model
def model():
    W, H = 1200, 600
    body = [background(W, H)]
    body.append(f'<text x="40" y="46" font-size="20" font-weight="700" fill="{TEXT}">When the canvas runs</text>'
                f'<text x="40" y="70" font-size="14" fill="{MUTED}">One visitor at a time. Between passes the loop is stopped: no frames, no work.</text>')
    x0, x1 = 170, 1150
    minutes = 40
    def mx(m): return x0 + (x1 - x0) * m / minutes
    lanes = [("Home", [17.5, 35.0]), ("Screensaver", [3.5, 8.0, 12.5, 17.0, 21.5, 26.0, 30.5, 35.0, 39.0]), ("Dressing", None)]
    for li, (name, passes) in enumerate(lanes):
        y = 110 + li * 62
        body.append(f'<text x="40" y="{y+22}" font-size="16" font-weight="600" fill="{TEXT}">{name}</text>')
        if passes is None:
            body.append(f'<rect x="{x0}" y="{y+6}" width="{x1-x0}" height="24" rx="6" fill="#2f5d8a" opacity="0.55"/>'
                        f'<text x="{x0+12}" y="{y+23}" font-size="13" fill="{TEXT}">drawn once by CSS while the festival lasts · no frames at all</text>')
            continue
        body.append(f'<rect x="{x0}" y="{y+6}" width="{x1-x0}" height="24" rx="6" fill="{LINE}"/>')
        for p in passes:
            body.append(f'<rect x="{mx(p)-5:.1f}" y="{y}" width="10" height="36" rx="3" fill="{AMBER}"/>')
        if name == "Home":
            body.append(f'<text x="{x0+12}" y="{y+23}" font-size="13" fill="{MUTED}">idle · canvas stopped</text>'
                        f'<text x="{mx(17.5)+12:.0f}" y="{y+23}" font-size="13" fill="{TEXT}">pass · 30 fps · ~10 s</text>')
    ay = 110 + 3 * 62 - 6
    body.append(f'<path d="M{x0},{ay} L{x1},{ay}" stroke="{MUTED}" stroke-width="1"/>')
    for m in range(0, minutes + 1, 5):
        body.append(f'<path d="M{mx(m):.1f},{ay} L{mx(m):.1f},{ay+6}" stroke="{MUTED}"/>'
                    f'<text x="{mx(m):.1f}" y="{ay+22}" text-anchor="middle" font-size="12" fill="{MUTED}">{m} min</text>')
    body.append(f'<text x="{x0}" y="{ay+46}" font-size="13" fill="{MUTED}">Home: a pass every 15–20 min (random). Screensaver: every 3–5 min, which also moves pixels against burn-in.</text>')

    # state machine
    sy = 400
    body.append(f'<text x="40" y="{sy}" font-size="20" font-weight="700" fill="{TEXT}">The scheduler</text>')
    boxes = [("Waiting", "timer 15–20 min", 40), ("Flying", "rAF at 30 fps", 330), ("Gone", "canvas cleared, loop stopped", 620)]
    for name, sub, bx in boxes:
        body.append(f'<rect x="{bx}" y="{sy+20}" width="230" height="64" rx="12" fill="{CARD}" stroke="{CARD_STROKE}"/>'
                    f'<text x="{bx+18}" y="{sy+48}" font-size="17" font-weight="700" fill="{TEXT}">{name}</text>'
                    f'<text x="{bx+18}" y="{sy+70}" font-size="13" fill="{MUTED}">{sub}</text>')
    arrow = f'stroke="{AMBER}" stroke-width="2" fill="none" marker-end="url(#ah)"'
    body.insert(1, f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="{AMBER}"/></marker></defs>')
    body.append(f'<path d="M270,{sy+52} L326,{sy+52}" {arrow}/><path d="M560,{sy+52} L616,{sy+52}" {arrow}/>'
                f'<path d="M735,{sy+86} Q735,{sy+140} 450,{sy+140} Q155,{sy+140} 155,{sy+90}" {arrow}/>'
                f'<text x="450" y="{sy+132}" text-anchor="middle" font-size="13" fill="{MUTED}">next festival day? draw a new wait</text>'
                f'<text x="298" y="{sy+42}" text-anchor="middle" font-size="12" fill="{MUTED}">time</text>'
                f'<text x="588" y="{sy+42}" text-anchor="middle" font-size="12" fill="{MUTED}">exits</text>')
    body.append(f'<text x="40" y="{sy+180}" font-size="13" fill="{MUTED}">Page hidden → the loop pauses and resumes where it was (as weather effects do). '
                f'A device set to Reduced or Off never leaves Waiting.</text>')

    # matrix
    mx0, my0 = 900, 380
    cols = ["On", "Reduced", "Off"]
    rows = ["Visitor", "Dressing", "Outfit"]
    grid = [["✓", "–", "–"], ["✓", "✓", "–"], ["✓", "still", "–"]]
    body.append(f'<text x="{mx0}" y="{my0+20}" font-size="20" font-weight="700" fill="{TEXT}">Animations switch</text>')
    for ci, c in enumerate(cols):
        body.append(f'<text x="{mx0+110+ci*78}" y="{my0+52}" text-anchor="middle" font-size="13" font-weight="600" fill="{MUTED}">{c}</text>')
    for ri, r in enumerate(rows):
        yy = my0 + 64 + ri * 40
        body.append(f'<rect x="{mx0}" y="{yy}" width="300" height="34" rx="8" fill="{CARD}" stroke="{CARD_STROKE}"/>'
                    f'<text x="{mx0+12}" y="{yy+22}" font-size="14" fill="{TEXT}">{r}</text>')
        for ci, v in enumerate(grid[ri]):
            col = "#4ad66d" if v == "✓" else (AMBER if v == "still" else MUTED)
            body.append(f'<text x="{mx0+110+ci*78}" y="{yy+23}" text-anchor="middle" font-size="15" font-weight="700" fill="{col}">{v}</text>')
    save("animation-model.svg", svg(W, H, "\n".join(body), "", "Diagram: when festival animations run, the scheduler, and what each Animations setting allows"))


# ---------------------------------------------------------------- 5. Screensaver
def screensaver():
    W, H = 1200, 675
    defs = ('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a33"/><stop offset="0.6" stop-color="#2a3d6b"/>'
            '<stop offset="1" stop-color="#4b5f8f"/></linearGradient>'
            '<radialGradient id="moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="#fff6d8"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient>')
    body = [f'<defs>{defs}</defs><rect width="{W}" height="{H}" fill="url(#sky)"/>']
    rnd = random.Random(11)
    for _ in range(60):
        body.append(f'<circle cx="{rnd.uniform(0,W):.0f}" cy="{rnd.uniform(0,300):.0f}" r="{rnd.uniform(0.6,1.6):.1f}" fill="#fff" opacity="{rnd.uniform(0.3,0.9):.2f}"/>')
    body.append('<circle cx="860" cy="170" r="110" fill="url(#moon)"/><circle cx="860" cy="170" r="62" fill="#fff8e1"/>')
    body.append('<path d="M0,430 Q200,360 420,420 T860,400 T1200,390 L1200,675 L0,675 Z" fill="#c9d6ea"/>'
                '<path d="M0,500 Q300,440 600,490 T1200,470 L1200,675 L0,675 Z" fill="#e4ecf7"/>')
    for tx, ts in ((120, 1.0), (180, 0.8), (980, 1.1), (1060, 0.85), (1120, 0.7)):
        body.append(f'<g transform="translate({tx},{470 - ts*10}) scale({ts})"><path d="M0,-90 L30,-30 L18,-30 L40,10 L-40,10 L-18,-30 L-30,-30 Z" fill="#1f3a34"/>'
                    f'<path d="M0,-90 L14,-62 L-14,-62 Z M-22,-34 L0,-46 L22,-34 Z" fill="#f4f8ff" opacity="0.9"/><rect x="-5" y="10" width="10" height="14" fill="#3a2a1d"/></g>')
    body.append('<g transform="translate(600,452)"><rect x="-50" y="-40" width="100" height="62" fill="#5a3b2c"/><path d="M-62,-38 L0,-84 L62,-38 Z" fill="#7d2f2f"/>'
                '<path d="M-64,-40 L0,-88 L64,-40" stroke="#f4f8ff" stroke-width="7" fill="none"/>'
                '<rect x="-30" y="-24" width="22" height="20" fill="#ffcf6b"/><rect x="10" y="-24" width="22" height="20" fill="#ffcf6b"/>'
                '<rect x="-8" y="-4" width="16" height="26" fill="#3a2418"/></g>')
    body.append(f'<g>{snowflakes(W, H, 80, seed=9)}</g>')
    body.append(f'<g class="sleigh" transform="translate(760,120)">{sparkle_trail()}{sleigh(0.9)}</g>')
    body.append(f'<rect width="{W}" height="{H}" fill="url(#shade)"/>')
    body.append('<text x="56" y="588" font-size="118" font-weight="300" fill="#fff" letter-spacing="-3" stroke="#0b1020" stroke-opacity="0.35" stroke-width="6" paint-order="stroke">16:42</text>'
                '<text x="62" y="630" font-size="24" fill="#ffffff" stroke="#0b1020" stroke-opacity="0.35" stroke-width="4" paint-order="stroke">Sunday, 29 November · −1° light snow</text>')
    body.append(f'<rect x="20" y="20" width="292" height="34" rx="17" fill="#000" opacity="0.35"/>'
                f'<text x="38" y="43" font-size="15" fill="#fff">Screensaver · a pass every 3–5 min</text>')
    style = (FLAKE_CSS +
             "@keyframes fly { 0% { transform: translate(-300px,260px); } 30% { transform: translate(300px,170px); }"
             " 55% { transform: translate(760px,120px); } 80% { transform: translate(1260px,60px); } 81%,100% { transform: translate(1300px,60px); opacity: 0; } }"
             ".sleigh { animation: fly 14s linear infinite; animation-delay: -4.5s; }")
    save("screensaver-christmas.svg", svg(W, H, "\n".join(body), style, "Mockup: the screensaver at Christmas, the sleigh crossing in front of the moon over a photo"))


# ---------------------------------------------------------------- 6. Creature outfits
def outfits():
    W, H = 1200, 330
    body = [background(W, H)]
    kinds = [("santa", "Christmas"), ("party", "New Year's Eve"), ("lunar", "Lunar New Year"), ("bunny", "Easter"), ("witch", "Halloween"), ("diwali", "Diwali")]
    palette = [("#6cc49a", "#a8e3c4"), ("#7aa7e8", "#bcd3f5"), ("#e89a6c", "#f5c9a8"), ("#b08be0", "#d7c3f2"), ("#8fc45f", "#c6e3a5"), ("#e6c25a", "#f4e0a3")]
    for i, (k, label) in enumerate(kinds):
        cx = 110 + i * 196
        b, bl = palette[i]
        body.append(creature(cx, 180, 1.0, b, bl) + hat(k, cx, 180, 1.0))
        body.append(f'<text x="{cx}" y="{300}" text-anchor="middle" font-size="16" font-weight="700" fill="{TEXT}">{label}</text>')
    style = "@keyframes flick { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.82); } } .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 1.4s ease-in-out infinite; }"
    save("creature-outfits.svg", svg(W, H, "\n".join(body), style, "Mockup: a creature's outfit for six festivals"))


home(); dressings(); visitors(); model(); screensaver(); outfits()
print("ok", sorted(os.listdir(OUT)))

"""Builds the RFC-020 mockups on screenshots of the real app.

    node docs/rfc/020/capture.cjs <captures>      # needs a running local stack, see that file
    python3 docs/rfc/020/mockups.py <captures> docs/rfc/020

The captures are not committed; the SVGs embed what they use.
"""
import math, random, sys, os, re

CAP, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FONT = "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

BG0, BG1 = "#211912", "#1b140e"
CARD, CARD_STROKE, LINE = "#2d241a", "#463a2c", "#3a2f23"
TEXT, MUTED, AMBER = "#f2ebe0", "#a89a88", "#f5b84a"
ACCENT = "#4fbf93"  # December's month colour, hsl(158 48% 52%)

REDUCED = "@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"


def svg(w, h, body, style="", title=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="{FONT}" role="img" aria-label="{title}">\n<title>{title}</title>\n'
            f"<style>{style}\n{REDUCED}</style>\n{body}\n</svg>\n")


def save(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)


def background(w, h, extra="", top="#3a6ea5", bottom=None, strength=0.18, gid=""):
    """The page with the colour wash (#422): a glow from the top and, when given, a second colour from the bottom."""
    out = (f'<defs><linearGradient id="bg{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG0}"/>'
           f'<stop offset="1" stop-color="{BG1}"/></linearGradient>'
           f'<radialGradient id="wash{gid}" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="{top}" stop-opacity="{strength}"/>'
           f'<stop offset="1" stop-color="{top}" stop-opacity="0"/></radialGradient>'
           f'<linearGradient id="washb{gid}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="{bottom or top}" stop-opacity="{strength*0.8:.2f}"/>'
           f'<stop offset="0.45" stop-color="{bottom or top}" stop-opacity="0"/></linearGradient>{extra}</defs>'
           f'<rect width="{w}" height="{h}" fill="url(#bg{gid})"/><rect width="{w}" height="{h}" fill="url(#wash{gid})"/>')
    if bottom:
        out += f'<rect width="{w}" height="{h}" fill="url(#washb{gid})"/>'
    return out


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


import base64, json, subprocess

GEO = json.load(open(os.path.join(CAP, "geo.json")))
CARDS = {c["title"]: c for c in GEO["cards"]}
SW, SH = 1920, 1080  # the captures' viewport: a 1080p wall display

FESTIVALS = [("christmas", "Christmas", "#d9363e", "#2f8f5b"), ("newyear", "New Year's Eve", "#e3b341", "#3b4bb8"),
             ("lunar", "Lunar New Year", "#e0262f", "#e3b341"), ("easter", "Easter", "#7cc46a", "#f2d45c"),
             ("halloween", "Halloween", "#f08a2a", "#7a3fb0"), ("diwali", "Diwali", "#ff9f1c", "#d0307c")]


def jpeg(name, width=None, crop=None, quality=80, extra=()):
    """A capture as an embedded JPEG data URI, optionally cropped (w, h, x, y) and resized."""
    args = ["convert", os.path.join(CAP, name)]
    if crop:
        args += ["-crop", "{}x{}+{}+{}".format(*crop), "+repage"]
    if width:
        args += ["-resize", f"{width}x"]
    args += list(extra) + ["-strip", "-quality", str(quality), "jpg:-"]
    data = subprocess.run(args, check=True, capture_output=True).stdout
    return "data:image/jpeg;base64," + base64.b64encode(data).decode()


def image(uri, x, y, w, h, extra=""):
    return f'<image href="{uri}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="none" {extra}/>'


def legend_band(items, y, w, size=26, step=46):
    out = [f'<rect x="0" y="{y}" width="{w}" height="{len(items)*step+40}" fill="#140f0a"/>']
    ly = y + 44
    for n, head, rest in items:
        out.append(big_marker(n, 60, ly - 8) +
                   f'<text x="92" y="{ly}" font-size="{size}" fill="{TEXT}"><tspan font-weight="700">{head}</tspan>'
                   f'<tspan fill="{MUTED}"> · {rest}</tspan></text>')
        ly += step
    return "\n".join(out)


ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "art")


def art_team(width, animated=True, pose=False, defs=True):
    """The sleigh team from art/ (art.py), `width` wide, top-left at the current origin: galloping, or one posed moment.
    `defs=False` leaves out the parts, for a second team in a document that has them already."""
    with open(os.path.join(ART, "team-pose.svg" if pose else "team-only.svg")) as f:
        s_ = f.read()
    vb = re.search(r'viewBox="([^"]+)"', s_).group(1)
    w, h = map(float, vb.split()[2:])
    inner = s_.split(">", 1)[1].rsplit("</svg>", 1)[0]
    inner = re.sub(r"<title>.*?</title>", "", inner, flags=re.S)
    inner = re.sub(r"@media \(prefers-reduced-motion[^}]*\}\s*\}", "", inner)  # the mockup keeps its own
    if not defs:
        inner = re.sub(r"<defs><symbol.*</symbol></defs>", "", inner, flags=re.S)
    return f'<svg width="{width:.0f}" height="{width * h / w:.0f}" viewBox="{vb}" overflow="visible">{inner}</svg>'


def big_marker(n, x, y):
    return (f'<g><circle cx="{x}" cy="{y}" r="20" fill="{AMBER}"/>'
            f'<text x="{x}" y="{y+7}" text-anchor="middle" font-size="21" font-weight="700" fill="#1b1405">{n}</text></g>')


def presents_and_stars(x, y, s=1.0):
    stars = "".join(f'<path d="M{sx},{sy-9} L{sx+3},{sy-3} L{sx+9},{sy} L{sx+3},{sy+3} L{sx},{sy+9} L{sx-3},{sy+3} L{sx-9},{sy} L{sx-3},{sy-3} Z" fill="#ffe9a8" opacity="{o}"/>'
                    for sx, sy, o in ((-50, -40, 0.9), (60, -60, 0.8), (-80, 30, 0.7), (90, 20, 0.85), (10, -90, 0.6), (-20, 60, 0.75)))
    gift = lambda gx, gy, c, r: (f'<g transform="translate({gx},{gy}) rotate({r})"><rect x="-16" y="-14" width="32" height="28" rx="4" fill="{c}"/>'
                                 f'<rect x="-3" y="-14" width="6" height="28" fill="#ffd24a"/><rect x="-16" y="-3" width="32" height="6" fill="#ffd24a"/>'
                                 f'<path d="M0,-14 Q-12,-27 -15,-17 Q-10,-13 0,-14 Q12,-27 15,-17 Q10,-13 0,-14" fill="#ffd24a"/></g>')
    return f'<g transform="translate({x},{y}) scale({s})">{stars}{gift(-10, 0, "#4aa8ff", -12)}{gift(34, 18, "#e04848", 10)}</g>'


def card_snow(names, seed=0):
    out = []
    for i, n in enumerate(names):
        c = CARDS[n]
        out.append(snowcap(c["x"], c["y"], c["w"], seed=seed + i * 7))
    return "\n".join(out)


# ---------------------------------------------------------------- 1. Home at Christmas
def home():
    W, H = SW, SH + 5 * 46 + 40
    ev = CARDS["Events"]
    body = [image(jpeg("home-christmas.png", quality=78), 0, 0, SW, SH)]
    body.append(f'<g>{snowflakes(SW, SH - 80, 90)}</g>')
    body.append(card_snow([c["title"] for c in GEO["cards"]]))
    body.append(light_string(ev["x"] + 16, ev["y"] + 1, ev["w"] - 32, sag=7, n=13))
    # the sleigh flies over the widgets; a tap drops presents and stars
    body.append(f'<path d="M-60,760 Q500,560 1000,600 T2000,560" fill="none" stroke="{AMBER}" stroke-opacity="0.55" stroke-width="3" stroke-dasharray="10 12"/>')
    body.append(f'<g class="sleigh" transform="translate(980,540)"><g transform="translate(0,40) scale(2.2)">{sparkle_trail()}</g>{art_team(620)}</g>')
    body.append(presents_and_stars(1400, 790, 1.0))
    cr = CARDS["Creatures"]
    body.append(big_marker(1, 880, 548) + big_marker(2, ev["x"] + ev["w"] - 30, ev["y"] - 16) + big_marker(3, cr["x"] + 40, cr["y"] + 170) +
                big_marker(4, 1500, 740) + big_marker(5, 1700, 60))
    body.append(legend_band([("1", "Visitor", "the sleigh flies over the widgets, ~10 s, every 2 min"),
                             ("2", "Dressing", "snow on each card's top edge, lights on one, above the title row"),
                             ("3", "Outfit", "a Santa hat in the creatures' head slot (RFC-017's shop slots)"),
                             ("4", "Tap", "tapping the sleigh drops presents and stars; the creatures cheer"),
                             ("5", "Colour wash", "Christmas red from the top, pine green from the bottom")], SH, SW))
    style = (FLAKE_CSS +
             "@keyframes fly { 0% { transform: translate(-520px,700px); opacity: 1; } 22% { transform: translate(300px,600px); }"
             " 45% { transform: translate(1000px,540px); } 68% { transform: translate(2000px,520px); opacity: 1; } 69%,100% { transform: translate(2060px,520px); opacity: 0; } }"
             ".sleigh { animation: fly 14s linear infinite; animation-delay: -2.4s; }")
    save("home-christmas.svg", svg(W, H, "\n".join(body), style,
         "Mockup on a screenshot of Kinboard's Home: the sleigh flies over the widgets, snow on the cards, the creatures in Santa hats, presents and stars from a tap, and a red and green colour wash"))


# ---------------------------------------------------------------- 2. Screensaver
def screensaver():
    W, H = SW, SH
    body = [image(jpeg("screensaver.png", quality=78), 0, 0, SW, SH)]
    body.append(f'<g>{snowflakes(SW, SH, 110, seed=9)}</g>')
    body.append(f'<g class="sleigh" transform="translate(900,330)"><g transform="translate(0,40) scale(2.4)">{sparkle_trail()}</g>{art_team(700)}</g>')
    body.append(f'<rect x="32" y="24" width="452" height="50" rx="25" fill="#000" opacity="0.4"/>'
                f'<text x="58" y="58" font-size="24" fill="#fff">Screensaver · a pass every 2 min</text>')
    style = (FLAKE_CSS +
             "@keyframes fly { 0% { transform: translate(-560px,520px); opacity: 1; } 30% { transform: translate(400px,400px); }"
             " 55% { transform: translate(1100px,320px); } 80% { transform: translate(2000px,220px); opacity: 1; } 81%,100% { transform: translate(2060px,220px); opacity: 0; } }"
             ".sleigh { animation: fly 14s linear infinite; animation-delay: -2s; }")
    save("screensaver-christmas.svg", svg(W, H, "\n".join(body), style,
         "Mockup on a screenshot of Kinboard's screensaver: the sleigh crosses the middle of the screen while snow falls"))


# ---------------------------------------------------------------- 3. Colour wash per festival
def washes():
    W, H = 1200, 640
    fw, fh = 360, 203
    xs, ys = [30, 420, 810], [30, 330]
    body = [f'<rect width="{W}" height="{H}" fill="{BG1}"/>']
    for i, (key, name, top, bottom) in enumerate(FESTIVALS):
        x, y = xs[i % 3], ys[i // 3]
        body.append(f'<clipPath id="w{i}"><rect x="{x}" y="{y}" width="{fw}" height="{fh}" rx="12"/></clipPath>'
                    f'<g clip-path="url(#w{i})">{image(jpeg(f"home-{key}.png", width=720, quality=74), x, y, fw, fh)}</g>'
                    f'<rect x="{x}" y="{y}" width="{fw}" height="{fh}" rx="12" fill="none" stroke="{CARD_STROKE}"/>'
                    f'<circle cx="{x+8}" cy="{y+fh+28}" r="8" fill="{top}"/><circle cx="{x+27}" cy="{y+fh+28}" r="8" fill="{bottom}"/>'
                    f'<text x="{x+44}" y="{y+fh+34}" font-size="17" font-weight="700" fill="{TEXT}">{name}</text>'
                    f'<text x="{x+44}" y="{y+fh+56}" font-size="13" fill="{MUTED}">wash and creature hat</text>')
    save("colour-wash.svg", svg(W, H, "\n".join(body), "", "Screenshots of Kinboard's Home with the colour wash and the creatures' hat for six festivals"))


# ---------------------------------------------------------------- 4. Dressing on a real card
def dressings():
    ev = CARDS["Events"]
    pad = 26
    crop = (ev["w"] + 2 * pad, ev["h"] + 2 * pad, ev["x"] - pad, ev["y"] - pad)
    uri = jpeg("home-december.png", crop=crop, quality=82)
    cw, ch = crop[0], crop[1]
    s = 0.86
    W, H = 1200, 2 * int(ch * s) + 150
    xs = [12, 412, 812]
    ys = [10, int(ch * s) + 80]
    body = [f'<rect width="{W}" height="{H}" fill="{BG1}"/>']
    for i, (key, name, _, _) in enumerate(FESTIVALS):
        X, Y = xs[i % 3], ys[i // 3]
        x, y, w, h = pad, pad, ev["w"], ev["h"]  # the card inside the crop
        g = [image(uri, 0, 0, cw, ch)]
        if key == "christmas":
            g.append(snowcap(x, y, w, seed=21) + light_string(x + 16, y + 1, w - 32, sag=7))
        elif key == "newyear":
            rnd = random.Random(5)
            cols = ["#ffd24a", "#ff5a5a", "#4aa8ff", "#4ad66d", "#c084fc"]
            for _ in range(30):
                side = rnd.choice([0, 1])
                cx = x + (rnd.uniform(-10, 80) if side == 0 else rnd.uniform(w - 80, w + 10))
                cy = y + rnd.uniform(-16, 14)
                c = rnd.choice(cols)
                g.append(f'<rect x="{cx:.0f}" y="{cy:.0f}" width="7" height="3.5" fill="{c}" transform="rotate({rnd.uniform(0,180):.0f} {cx:.0f} {cy:.0f})"/>'
                         if rnd.random() < 0.5 else f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="2.6" fill="{c}"/>')
            g.append(burst(x + w - 30, y - 4, 24, "#ffd24a", 12))
        elif key == "lunar":
            g.append(f'<path d="M{x+w-150},{y+2} Q{x+w-90},{y+16} {x+w-60},{y+2}" stroke="#e3b341" stroke-width="1.5" fill="none"/>')
            g.append(lantern(x + w - 128, y + 30, 0.75) + lantern(x + w - 76, y + 30, 0.75))
        elif key == "easter":
            pastel = ["#ffb3c4", "#a8e3c4", "#ffe08a", "#b8c6ff", "#ffcfa3"]
            n = 14
            for j in range(n):
                bx = x + 16 + (w - 32) * j / n
                bw = (w - 32) / n
                sag = 6 * math.sin(math.pi * (j + 0.5) / n)
                g.append(f'<path d="M{bx:.1f},{y+3+sag:.1f} L{bx+bw:.1f},{y+3+sag:.1f} L{bx+bw/2:.1f},{y+15+sag:.1f} Z" fill="{pastel[j % 5]}"/>')
            g.append(egg(x + w - 14, y + h - 4, 1.0) + egg(x + w - 40, y + h + 4, 0.75, "#b8c6ff", "#ffe08a"))
        elif key == "halloween":
            wx, wy = x + w, y
            for r in (16, 30, 44):
                g.append(f'<path d="M{wx-r},{wy} Q{wx-r*0.85},{wy+r*0.35} {wx-r*0.87},{wy+r*0.5} Q{wx-r*0.6},{wy+r*0.7} {wx-r*0.52},{wy+r*0.87} Q{wx-r*0.25},{wy+r*0.9} {wx},{wy+r}" stroke="#c9bfae" stroke-width="1" fill="none" opacity="0.7"/>')
            g.append(f'<path d="M{wx},{wy} L{wx-52},{wy} M{wx},{wy} L{wx-46},{wy+25} M{wx},{wy} L{wx-27},{wy+46} M{wx},{wy} L{wx},{wy+52}" stroke="#c9bfae" stroke-width="1" opacity="0.7"/>')
            g.append(pumpkin(x + 34, y + h - 2, 1.1))
        elif key == "diwali":
            g.append(f'<path d="M{x+16},{y+2} Q{x+w/2},{y+20} {x+w-16},{y+2}" fill="none" stroke="#ff9f1c" stroke-width="8" stroke-dasharray="1 10" stroke-linecap="round"/>'
                     f'<path d="M{x+22},{y+4} Q{x+w/2},{y+22} {x+w-22},{y+4}" fill="none" stroke="#ffd24a" stroke-width="6" stroke-dasharray="1 10" stroke-dashoffset="5" stroke-linecap="round"/>')
            for j in range(5):
                g.append(diya(x + 56 + j * 60, y + h + 2, 1.0))
        body.append(f'<g transform="translate({X},{Y}) scale({s})">{"".join(g)}</g>'
                    f'<text x="{X + pad*s:.0f}" y="{Y + ch*s + 26:.0f}" font-size="17" font-weight="700" fill="{TEXT}">{name}</text>')
    style = "@keyframes flick { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.82); } } .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 1.4s ease-in-out infinite; }"
    save("dressing.svg", svg(W, H, "\n".join(body), style, "Kinboard's Events card, from a screenshot, dressed for six festivals"))


# ---------------------------------------------------------------- 5. Visitor paths on Home
def visitors():
    W, H = 1200, 640
    fw, fh = 360, 203
    xs, ys = [30, 420, 810], [30, 340]
    sx, sy = fw / SW, fh / SH
    bg = jpeg("home-december.png", width=720, quality=70, extra=("-modulate", "70"))
    path = f'stroke="{AMBER}" stroke-width="2.2" stroke-dasharray="6 6" fill="none"'
    items = [("Sleigh · Christmas", "over the widgets, left → right · 10 s · tap it"),
             ("Bunny · Easter", "hops along the widgets, stops, looks, goes · 12 s"),
             ("Bats · Halloween", "flutter out of a corner, zig-zag, gone · 8 s"),
             ("Fireworks · New Year's Eve", "burst over the clock at the family's midnight · 60 s"),
             ("Lanterns · Lunar New Year", "rise through the widgets and fade out · 15 s"),
             ("Diyas · Diwali", "light one by one along the cards' edge · 10 s")]
    row1 = GEO["cards"][0]["y"] * sy  # the widgets' first row, in frame units
    body = [f'<rect width="{W}" height="{H}" fill="{BG1}"/>']
    for i, (head, rest) in enumerate(items):
        x, y = xs[i % 3], ys[i // 3]
        body.append(f'<clipPath id="v{i}"><rect x="{x}" y="{y}" width="{fw}" height="{fh}" rx="12"/></clipPath><g clip-path="url(#v{i})">')
        body.append(image(bg, x, y, fw, fh))
        if i == 0:
            body.append(f'<path d="M{x-10},{y+row1+60} Q{x+fw*0.45},{y+row1+5} {x+fw+10},{y+row1+20}" {path}/>')
            for n_, (px, py, op) in enumerate(((x + 10, y + row1 + 26, 0.3), (x + 130, y + row1 + 2, 0.55), (x + 250, y + row1 + 4, 1))):
                body.append(f'<g transform="translate({px},{py - 14})" opacity="{op}">{art_team(118, pose=True, defs=n_ == 0)}</g>')
        elif i == 1:
            base = y + row1 + 10
            hops = " ".join(f"Q{x+30+j*60+30},{base-40} {x+30+(j+1)*60},{base}" for j in range(5))
            body.append(f'<path d="M{x+30},{base} {hops}" {path}/>')
            body.append(f'<g opacity="0.4">{bunny(x + 150, base - 30, 0.9)}</g>' + bunny(x + 330, base - 10, 0.9))
        elif i == 2:
            body.append(f'<path d="M{x+fw-10},{y+12} L{x+fw-90},{y+70} L{x+fw-150},{y+40} L{x+fw-230},{y+110} L{x+20},{y+60}" {path}/>')
            for bx, by, s_, op in ((x + fw - 90, y + 70, 0.9, 0.4), (x + fw - 230, y + 110, 1.0, 0.65), (x + 30, y + 60, 1.2, 1)):
                body.append(f'<g opacity="{op}">{bat(bx, by, s_, "#b9a6f0")}</g>')
        elif i == 3:
            for bx, by, r, c in ((x + 110, y + 40, 26, "#ffd24a"), (x + 185, y + 28, 32, "#ff5a5a"), (x + 260, y + 45, 24, "#4aa8ff")):
                body.append(f'<path d="M{bx},{y+fh-8} L{bx},{by+r}" {path}/>' + burst(bx, by, r, c))
        elif i == 4:
            for lx, top in ((x + 70, 40), (x + 180, 22), (x + 290, 50)):
                body.append(f'<path d="M{lx},{y+fh-6} L{lx},{y+top}" {path}/>')
                body.append(f'<g opacity="0.4">{lantern(lx, y + fh - 36, 0.75)}</g>' + lantern(lx, y + top + 26, 0.75))
        elif i == 5:
            ly = y + row1 + 2
            body.append(f'<path d="M{x+16},{ly} L{x+fw-16},{ly}" {path}/>')
            for j in range(6):
                lit = j < 4
                body.append(f'<g opacity="{1 if lit else 0.35}">{diya(x + 34 + j * 58, ly, 0.85, flicker=lit)}</g>')
        body.append("</g>")
        body.append(f'<text x="{x}" y="{y+fh+30}" font-size="16" font-weight="700" fill="{TEXT}">{head}</text>'
                    f'<text x="{x}" y="{y+fh+52}" font-size="14" fill="{MUTED}">{rest}</text>')
    style = "@keyframes flick { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.82); } } .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: flick 1.4s ease-in-out infinite; }"
    save("visitors.svg", svg(W, H, "\n".join(body), style, "The six visitors' paths, drawn over a screenshot of Kinboard's Home"))


# ---------------------------------------------------------------- 4. Animation model
def model():
    W, H = 1200, 650
    body = [background(W, H)]
    body.append(f'<text x="40" y="46" font-size="20" font-weight="700" fill="{TEXT}">When the canvas runs</text>'
                f'<text x="40" y="70" font-size="14" fill="{MUTED}">One loop for weather and festival, one visitor at a time. Between passes the festival adds no frames.</text>')
    x0, x1 = 210, 1150
    minutes = 12
    def mx(m): return x0 + (x1 - x0) * m / minutes
    lanes = [("Home", [2, 4, 6, 8, 10, 12]), ("Screensaver", [2, 4, 6, 8, 10, 12]), ("Dressing", None), ("Colour wash", None)]
    for li, (name, passes) in enumerate(lanes):
        y = 100 + li * 52
        body.append(f'<text x="40" y="{y+22}" font-size="16" font-weight="600" fill="{TEXT}">{name}</text>')
        if passes is None:
            fill, note = (("#2f5d8a", "drawn once by CSS while the festival lasts · no frames at all") if name == "Dressing"
                          else ("#8a2f3a", "festival colours instead of the month's · CSS variables · no frames"))
            body.append(f'<rect x="{x0}" y="{y+6}" width="{x1-x0}" height="24" rx="6" fill="{fill}" opacity="0.6"/>'
                        f'<text x="{x0+12}" y="{y+23}" font-size="13" fill="{TEXT}">{note}</text>')
            continue
        body.append(f'<rect x="{x0}" y="{y+6}" width="{x1-x0}" height="24" rx="6" fill="{LINE}"/>')
        for p in passes:
            body.append(f'<rect x="{mx(p)-5:.1f}" y="{y}" width="10" height="36" rx="3" fill="{AMBER}"/>')
        if name == "Home":
            body.append(f'<text x="{x0+12}" y="{y+23}" font-size="13" fill="{MUTED}">idle · canvas stopped</text>'
                        f'<text x="{mx(4)+12:.0f}" y="{y+23}" font-size="13" fill="{TEXT}">pass · 30 fps · ~10 s</text>')
    ay = 100 + 4 * 52 - 4
    body.append(f'<path d="M{x0},{ay} L{x1},{ay}" stroke="{MUTED}" stroke-width="1"/>')
    for m in range(0, minutes + 1, 2):
        body.append(f'<path d="M{mx(m):.1f},{ay} L{mx(m):.1f},{ay+6}" stroke="{MUTED}"/>'
                    f'<text x="{mx(m):.1f}" y="{ay+22}" text-anchor="middle" font-size="12" fill="{MUTED}">{m} min</text>')
    body.append(f'<text x="{x0}" y="{ay+46}" font-size="13" fill="{MUTED}">A pass every 2 min on Home and the screensaver: the loop runs ~8% of the time. On the screensaver it also moves pixels against burn-in.</text>')

    # state machine
    sy = 410
    body.append(f'<text x="40" y="{sy}" font-size="20" font-weight="700" fill="{TEXT}">The scheduler</text>')
    boxes = [("Waiting", "timer 2 min", 40), ("Flying", "30 fps · only the sprite takes taps", 330), ("Gone", "canvas cleared, loop stopped", 620)]
    for name, sub, bx in boxes:
        body.append(f'<rect x="{bx}" y="{sy+20}" width="230" height="64" rx="12" fill="{CARD}" stroke="{CARD_STROKE}"/>'
                    f'<text x="{bx+18}" y="{sy+48}" font-size="17" font-weight="700" fill="{TEXT}">{name}</text>'
                    f'<text x="{bx+18}" y="{sy+70}" font-size="13" fill="{MUTED}">{sub}</text>')
    arrow = f'stroke="{AMBER}" stroke-width="2" fill="none" marker-end="url(#ah)"'
    body.insert(1, f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="{AMBER}"/></marker></defs>')
    body.append(f'<path d="M270,{sy+52} L326,{sy+52}" {arrow}/><path d="M560,{sy+52} L616,{sy+52}" {arrow}/>'
                f'<path d="M735,{sy+86} Q735,{sy+140} 450,{sy+140} Q155,{sy+140} 155,{sy+90}" {arrow}/>'
                f'<text x="178" y="{sy+108}" font-size="13" fill="{MUTED}">draw a new wait</text>'
                f'<text x="298" y="{sy+42}" text-anchor="middle" font-size="12" fill="{MUTED}">time</text>'
                f'<text x="588" y="{sy+42}" text-anchor="middle" font-size="12" fill="{MUTED}">exits</text>')
    body.append(f'<rect x="330" y="{sy+150}" width="270" height="44" rx="12" fill="{CARD}" stroke="{AMBER}"/>'
                f'<text x="348" y="{sy+177}" font-size="14" fill="{TEXT}"><tspan font-weight="700">Tapped</tspan><tspan fill="{MUTED}"> · presents, stars → Gone</tspan></text>'
                f'<path d="M445,{sy+86} L445,{sy+146}" {arrow}/><text x="453" y="{sy+120}" font-size="12" fill="{MUTED}">tap</text>')
    body.append(f'<text x="40" y="{sy+222}" font-size="13" fill="{MUTED}">Page hidden → the loop pauses and resumes where it was (as weather effects do). '
                f'A device set to Reduced or Off never leaves Waiting.</text>')

    # matrix
    mx0, my0 = 900, 390
    cols = ["On", "Reduced", "Off"]
    rows = ["Visitor", "Dressing", "Outfit", "Colour wash"]
    grid = [["✓", "–", "–"], ["✓", "✓", "–"], ["✓", "still", "–"], ["✓", "✓", "✓"]]
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
    save("animation-model.svg", svg(W, H, "\n".join(body), "", "Diagram: a pass every 2 minutes, the scheduler with the tap, and what each Animations setting allows"))



# ---------------------------------------------------------------- 6. Creature outfits, Kinboard's own creatures
CREATURE_CSS = """
.creature-ground { fill: rgba(242,235,224,0.1); }
.creature-part { transform-box: fill-box; }
.creature-animated .creature-breathe { transform-origin: 50% 100%; animation: creature-breathe 3.2s ease-in-out infinite; }
@keyframes creature-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.025, 0.985); } }
.creature-animated .creature-blink { transform-origin: 50% 50%; animation: creature-blink 4.6s infinite; }
@keyframes creature-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5% { transform: scaleY(0.08); } }
.creature-animated .creature-flap { transform-origin: 95% 85%; animation: creature-flap 2.4s ease-in-out infinite; }
@keyframes creature-flap { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-9deg); } }
.creature-animated .creature-tail-sway { transform-origin: 95% 70%; animation: creature-sway 3.6s ease-in-out infinite; }
@keyframes creature-sway { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(6deg); } }
"""


def outfits():
    W, H = 1200, 280
    body = [f'<rect width="{W}" height="{H}" fill="{BG1}"/>']
    for i, (key, name, _, _) in enumerate(FESTIVALS):
        markup = json.load(open(os.path.join(CAP, f"creature-svg-{key}.json")))
        cx = 30 + i * 195
        for j, m in enumerate(markup[:2]):
            m = re.sub(r'^<svg ', f'<svg x="{cx + j*86:.0f}" y="90" ', m)
            m = re.sub(r' width="\d+" height="\d+"', ' width="112" height="112"', m, count=1)
            m = re.sub(r' aria-label="[^"]*"', '', m, count=1)
            body.append(f'<g class="creature-animated">{m}</g>')
        body.append(f'<text x="{cx + 98}" y="{240}" text-anchor="middle" font-size="17" font-weight="700" fill="{TEXT}">{name}</text>')
    body.append(f'<text x="30" y="44" font-size="15" fill="{MUTED}">Kinboard\'s own Drake and Unicorn, with a festival item in the head slot where the cap from the shop was</text>')
    save("creature-outfits.svg", svg(W, H, "\n".join(body), CREATURE_CSS, "Kinboard's creatures wearing a festival item in the head slot, for six festivals"))


home(); screensaver(); washes(); dressings(); visitors(); model(); outfits()
print("ok")

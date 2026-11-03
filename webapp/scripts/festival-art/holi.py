"""Holi's art (RFC-020 §3.3): clouds of coloured powder bursting over the
widgets, and colour splashes at the cards' corners.

    python3 webapp/scripts/festival-art/holi.py

A powder cloud is a few soft, overlapping billows -- each a radial
gradient, its light side towards the top left -- blurred at the edge, with
grains of powder scattered through and around it. Translucent through and
through: the most opaque core lets the card underneath show, and the
engine fades it as it spreads, so nothing is hidden for long. The glow is
drawn into the art; the canvas only scales and fades the bitmap.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, rad, blur

art = Art("holi")

# (light, colour, deep): gulal's bright colours.
POWDER = {
    "pink": ("#FFB3D1", "#FF3D8B", "#C2185B"),
    "yellow": ("#FFF0A6", "#FFC93C", "#E09400"),
    "green": ("#B8F5CF", "#34C771", "#16884A"),
    "blue": ("#B3D4FF", "#3D8BFF", "#1F5BC2"),
    "orange": ("#FFD2A8", "#FF8A2B", "#D2560A"),
    "violet": ("#DCC2FF", "#9B5BFF", "#6A2FD0"),
}


def billows(key, colour, rnd, cx, cy, spread, n, size, alpha):
    light, mid, deep = POWDER[colour]
    defs = (rad(f"{key}b", [(0, light, alpha), (0.35, mid, alpha * 0.85), (0.75, mid, alpha * 0.35), (1, deep, 0)], fx=0.38, fy=0.36)
            + blur(f"{key}f", size * 0.08))
    out = []
    for _ in range(n):
        a, d = rnd.uniform(0, 2 * math.pi), spread * math.sqrt(rnd.uniform(0, 1))
        r = size * rnd.uniform(0.55, 1)
        out.append(f'<circle cx="{cx + math.cos(a) * d:.1f}" cy="{cy + math.sin(a) * d * 0.8:.1f}" r="{r:.1f}" fill="url(#{key}b)"/>')
    return defs, f'<g filter="url(#{key}f)">{"".join(out)}</g>'


def grains(rnd, colour, cx, cy, spread, n, rmax):
    light, mid, deep = POWDER[colour]
    out = []
    for _ in range(n):
        a, d = rnd.uniform(0, 2 * math.pi), spread * rnd.uniform(0.3, 1) ** 0.7
        r = rnd.uniform(0.6, rmax)
        out.append(f'<circle cx="{cx + math.cos(a) * d:.1f}" cy="{cy + math.sin(a) * d:.1f}" r="{r:.1f}" fill="{rnd.choice((light, mid, deep))}" opacity="{rnd.uniform(0.35, 0.8):.2f}"/>')
    return "".join(out)


def cloud(colour, seed):
    """A powder cloud, 240 x 240, pivot at its middle: billows, a brighter core, grains round it."""
    rnd = random.Random(seed)
    d1, b1 = billows("o", colour, rnd, 120, 120, 62, 7, 52, 0.55)
    d2, b2 = billows("i", colour, rnd, 112, 112, 30, 4, 36, 0.7)
    body = b1 + b2 + grains(rnd, colour, 120, 120, 112, 70, 2.4)
    art.part(f"cloud-{colour}", 240, 240, (120, 120), body, d1 + d2)


def puff(colour, seed):
    """A small puff, 80 x 80: a single billow and grains, among the clouds."""
    rnd = random.Random(seed)
    d, b = billows("p", colour, rnd, 40, 40, 10, 3, 20, 0.7)
    art.part(f"puff-{colour}", 80, 80, (40, 40), b + grains(rnd, colour, 40, 40, 36, 22, 1.6), d)


def splat(rnd, cx, cy, r, fill):
    """A splat: a round blot with blunt fingers flung out, its edge a smooth closed curve."""
    n = rnd.randint(9, 12)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.15, 0.15)
        k = rnd.uniform(1.25, 1.7) if rnd.random() < 0.45 else rnd.uniform(0.82, 1.0)
        pts.append((cx + math.cos(a) * r * k, cy + math.sin(a) * r * k * 0.85))
    # A closed curve through the midpoints, the points as controls: soft, never spiky.
    mids = [((pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2) for i in range(n)]
    d = f"M{mids[-1][0]:.1f},{mids[-1][1]:.1f} " + " ".join(f"Q{pts[i][0]:.1f},{pts[i][1]:.1f} {mids[i][0]:.1f},{mids[i][1]:.1f}" for i in range(n)) + " Z"
    return f'<path d="{d}" fill="{fill}"/>'


def splash(name, colours, seed):
    """
    A corner splash, 64 x 16, drawn for the top-left corner of a card at
    (16, 16): dabs of powder splatted just outside the corner and specks flung
    along the top edge, all in the 16px gap above the card and beside it.
    Powdery: a soft edge, a lighter middle, no gloss.
    """
    rnd = random.Random(seed)
    W, H, CX, CY = 64, 16, 16, 16
    defs = [blur("soft", 0.45)]
    for i, c in enumerate(colours):
        light, mid, deep = POWDER[c]
        defs.append(rad(f"s{i}", [(0, light, 0.95), (0.55, mid, 0.92), (1, deep, 0.85)], fx=0.38, fy=0.34))
    out = ['<g filter="url(#soft)">']
    # Three dabs round the corner, overlapping, each its own colour.
    for i, (dx, dy, r) in enumerate(((-5, -6, 4.6), (4, -8, 3.6), (-9, -1, 3.0))):
        out.append(splat(rnd, CX + dx, CY + dy, r, f"url(#s{i % len(colours)})"))
    out.append("</g>")
    # Specks flung away along the top edge and down the left one, smaller with distance.
    for n in range(30):
        along = rnd.random() < 0.72
        t = rnd.random() ** 1.2
        if along:
            x, y = CX + 6 + t * (W - CX - 10), rnd.uniform(2.5, CY - 2.5 - t * 4)
        else:
            x, y = rnd.uniform(2.5, CX - 4), rnd.uniform(6, CY - 2.5)
        r = max(0.5, 1.9 * (1 - t) * rnd.uniform(0.45, 1))
        c = POWDER[colours[rnd.randrange(len(colours))]][1]
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{c}" opacity="{rnd.uniform(0.6, 0.95):.2f}"/>')
    art.still(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
              f'<defs>{"".join(defs)}</defs>\n' + "\n".join(out) + "\n</svg>\n")


for i, c in enumerate(POWDER):
    cloud(c, 60 + i)
    puff(c, 80 + i)
splash("splash-warm", ("pink", "yellow", "orange"), 7)
splash("splash-cool", ("green", "blue", "violet"), 8)
art.finish()

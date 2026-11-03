"""Día de Muertos's art (RFC-020 §3.3): marigold petals drifting down, and
papel picado, cut tissue-paper flags, strung along the cards' top edges.

    python3 webapp/scripts/festival-art/dia-de-muertos.py

Festive and colourful: marigolds and paper cut into flowers, birds' wings
of diamonds and scallops; no skulls, no altars, nothing devotional (§7).
The marigolds are _marigold.py's, shared with Diwali's garlands. The crown
is drawn in the kit.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art
from _marigold import marigold, petal, MARIGOLD, YELLOW

art = Art("dia-de-muertos")

# ---------------------------------------------------------------- the petals that drift
PETALS = [("petal-orange", "#FFC46B", "#F2801E", "#B5450A"), ("petal-gold", "#FFF0A0", "#FFB52E", "#D9700A"), ("petal-deep", "#FF9A4A", "#D9590F", "#8E2E05")]
for name, a, b, c in PETALS:
    d, body = petal(name, a, b, c)
    art.part(name, 32, 28, (16, 14), body, d)
for name, colours in (("marigold-orange", MARIGOLD), ("marigold-yellow", YELLOW)):
    d, body = marigold(name, 22, 22, 20, seed=len(name), colours=colours)
    art.part(name, 44, 44, (22, 22), body, d)


# ---------------------------------------------------------------- papel picado
# Tissue colours: magenta, orange, turquoise, yellow, violet, lime; light and shade for each.
PAPER = [("#FF7AC8", "#E0338F"), ("#FFB15A", "#F27321"), ("#6FE0D8", "#1FA8A8"), ("#FFE36B", "#F2B81E"), ("#C99BFF", "#8A4FE0"), ("#B8EB6A", "#6BB52E")]


def cutouts(x, w, h, rnd, kind):
    """What's cut out of one flag (black in its mask): a flower or a star in the middle, diamonds and dots round it, a scalloped hem."""
    cx, cy = x + w / 2, 4 + h * 0.46
    out = []
    if kind == 0:  # a flower of six petals round a dot
        for i in range(6):
            a = i * 60
            out.append(f'<ellipse cx="{cx:.1f}" cy="{cy - 5:.1f}" rx="2.4" ry="4.6" transform="rotate({a} {cx:.1f} {cy:.1f})"/>')
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="1.6" fill="white"/>')
    elif kind == 1:  # a star of eight points
        pts = " ".join(f"{cx + math.cos(i * math.pi / 8 - math.pi / 2) * (9 if i % 2 == 0 else 3.6):.1f},{cy + math.sin(i * math.pi / 8 - math.pi / 2) * (9 if i % 2 == 0 else 3.6):.1f}" for i in range(16))
        out.append(f'<polygon points="{pts}"/>')
    else:  # a heart of two scallops
        out.append(f'<path d="M{cx:.1f},{cy + 7:.1f} C{cx - 12:.1f},{cy - 1:.1f} {cx - 6:.1f},{cy - 10:.1f} {cx:.1f},{cy - 4:.1f} C{cx + 6:.1f},{cy - 10:.1f} {cx + 12:.1f},{cy - 1:.1f} {cx:.1f},{cy + 7:.1f} Z"/>')
    # Diamonds in the four corners, dots in a row under the middle.
    for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        px, py = cx + dx * (w / 2 - 7), cy + dy * 9.5
        out.append(f'<path d="M{px:.1f},{py - 3:.1f} L{px + 2.2:.1f},{py:.1f} L{px:.1f},{py + 3:.1f} L{px - 2.2:.1f},{py:.1f} Z"/>')
    for i in range(-2, 3):
        out.append(f'<circle cx="{cx + i * 6:.1f}" cy="{4 + h - 7:.1f}" r="1.2"/>')
    return "".join(out)


def papel_picado():
    """240 x 40 units, 120 x 20 px, repeated along a card's top edge: a string near the top, four flags hanging from it."""
    rnd = random.Random(5)
    W, H = 240, 40
    defs, body = [], []
    fw, fh = 52, 32
    for i in range(4):
        x = 4 + i * 60
        light, shade = PAPER[(i * 2 + 1) % len(PAPER)] if i % 2 else PAPER[(i * 2) % len(PAPER)]
        uid = f"f{i}"
        # The hem: scallops along the bottom.
        hem = " ".join(f"Q{x + fw - (k + 0.5) * fw / 6:.1f},{4 + fh + 3:.1f} {x + fw - (k + 1) * fw / 6:.1f},{4 + fh:.1f}" for k in range(6))
        shape = f"M{x},4 L{x + fw},4 L{x + fw},{4 + fh} {hem} Z"
        defs.append(f'<linearGradient id="{uid}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{light}"/><stop offset="1" stop-color="{shade}"/></linearGradient>'
                    f'<mask id="{uid}m"><path d="{shape}" fill="white"/><g fill="black">{cutouts(x, fw, fh, rnd, i % 3)}</g></mask>')
        # The paper, gently rippled: lighter folds across it.
        body.append(f'<g mask="url(#{uid}m)"><path d="{shape}" fill="url(#{uid}g)" opacity="0.95"/>'
                    f'<path d="M{x + 10},4 L{x + 14},{4 + fh} M{x + 34},4 L{x + 30},{4 + fh}" stroke="#FFFFFF" stroke-width="4" opacity="0.18"/>'
                    f'<path d="M{x + 22},4 L{x + 24},{4 + fh}" stroke="{shade}" stroke-width="3" opacity="0.15"/></g>')
        # The fold over the string.
        body.append(f'<rect x="{x}" y="2.5" width="{fw}" height="3.5" rx="1" fill="{shade}"/>')
    body.insert(0, f'<path d="M0,4 L{W},4" stroke="#8A6236" stroke-width="1.6"/>')
    art.still("papel-picado", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 2}" height="{H // 2}">\n'
                               f'<defs>{"".join(defs)}</defs>\n' + "\n".join(body) + "\n</svg>\n"))


papel_picado()
art.finish()

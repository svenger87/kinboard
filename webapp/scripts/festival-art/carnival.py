"""Carnival's art (RFC-020 §3.3): streamers and confetti bursting from the
corners, wrapped sweets for a tap (the Kamelle thrown from the floats), and
the paper streamers on the cards.

    python3 webapp/scripts/festival-art/carnival.py

A flying streamer is a strip of paper curling as it unrolls: a trochoid
drawn in short pieces, each lit by which face of the paper it shows -- the
front where the curl comes towards the light, the shaded back where it
loops away -- so the coil reads round without an outline. The cards'
streamer is two crepe-paper ribbons, purple and green, twisted round each
other along the top edge, its gold end curling down the card's side.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("carnival")

# (front, back, highlight) for each paper.
PAPER = {
    "purple": ("#9B6BE8", "#5B3A9E", "#D9C4FF"),
    "green": ("#3FC27A", "#1F7A48", "#B8F0CF"),
    "gold": ("#FFC94A", "#C98A1A", "#FFF0B8"),
    "pink": ("#FF7FA8", "#C2416E", "#FFD0E0"),
}


def curl_pieces(x0, y0, length, loops, radius, width, paper, t_squash=0.55, taper=True, lean=0.0):
    """A curling paper strip: short round-capped pieces along a trochoid, front or back face by the direction."""
    front, back, hi = PAPER[paper]
    n = int(loops * 36)
    w = 2 * math.pi * loops
    a = length / w
    pts = []
    for i in range(n + 1):
        t = i / n * w
        r = radius * (0.65 + 0.35 * math.sin(t * 0.5 + 0.6))
        x = x0 + a * t + r * math.cos(t + math.pi)
        y = y0 + r * math.sin(t + math.pi) * t_squash + lean * a * t
        pts.append((x, y))
    out_back, out_front, out_hi = [], [], []
    for i in range(n):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        k = 1 - 0.45 * (i / n) if taper else 1
        seg = f'<path d="M{xa:.1f},{ya:.1f} L{xb:.1f},{yb:.1f}" stroke-width="{width * k:.2f}"/>'
        (out_front if xb - xa >= 0 else out_back).append(seg)
        if xb - xa >= 0 and yb - ya < 0:
            out_hi.append(f'<path d="M{xa:.1f},{ya - width * k * 0.22:.1f} L{xb:.1f},{yb - width * k * 0.22:.1f}" stroke-width="{width * k * 0.28:.2f}"/>')
    return (f'<g stroke="{back}" stroke-linecap="round" fill="none">{"".join(out_back)}</g>'
            f'<g stroke="{front}" stroke-linecap="round" fill="none">{"".join(out_front)}</g>'
            f'<g stroke="{hi}" stroke-linecap="round" fill="none" opacity="0.7">{"".join(out_hi)}</g>')


def streamer(paper, seed):
    """A flying streamer, 160 x 70, pivot at its middle: three or four loops of paper unrolling."""
    rnd = random.Random(seed)
    loops = rnd.uniform(2.6, 3.2)
    body = curl_pieces(26, 36, 110, loops, rnd.uniform(15, 17), 6.5, paper, t_squash=0.9, lean=rnd.uniform(-0.05, 0.05))
    art.part(f"streamer-{paper}", 160, 70, (80, 35), body)


def confetti(name, paper, kind):
    """A piece of confetti, 24 x 24: a square of paper or a round one, lit from the top left."""
    front, back, hi = PAPER[paper]
    defs = lin("c", [(0, hi, None), (0.45, front, None), (1, back, None)], 0, 0, 1, 1)
    if kind == "square":
        body = ('<rect x="5" y="6" width="14" height="12" rx="1.6" fill="url(#c)" transform="rotate(12 12 12)"/>'
                f'<rect x="6" y="7" width="12" height="3" rx="1.2" fill="#FFFFFF" opacity="0.4" transform="rotate(12 12 12)"/>')
    elif kind == "round":
        body = '<circle cx="12" cy="12" r="7.5" fill="url(#c)"/><ellipse cx="9.5" cy="9" rx="2.6" ry="1.6" fill="#FFFFFF" opacity="0.55" transform="rotate(-30 9.5 9)"/>'
    else:
        # A short twist of paper: a strip folded once.
        body = (f'<path d="M4,15 C8,6 12,6 13,12 C14,18 18,18 21,9" stroke="{back}" stroke-width="5" fill="none" stroke-linecap="round"/>'
                f'<path d="M4,15 C8,6 12,6 13,12" stroke="url(#c)" stroke-width="5" fill="none" stroke-linecap="round"/>'
                f'<path d="M6,11 C8,8 10,7 11,8" stroke="#FFFFFF" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.6"/>')
    art.part(name, 24, 24, (12, 12), body, defs)


def sweet():
    """A wrapped sweet for a tap, 60 x 60 (drops are drawn square): a striped round sweet, its twisted ends."""
    defs = (rad("sw", [(0, "#FFFFFF", None), (0.3, "#FFD3E2", None), (1, "#E0557A", None)], cx=0.4, cy=0.38, r=0.7, fx=0.35, fy=0.32)
            + lin("tw", [(0, "#FFF0B8", None), (1, "#E3A82B", None)], 0, 0, 0, 1))
    body = [
        '<path d="M16,30 L4,20 C3,26 3,34 4,40 Z" fill="url(#tw)"/>',
        '<path d="M44,30 L56,20 C57,26 57,34 56,40 Z" fill="url(#tw)"/>',
        '<path d="M6,24 L13,29 M6,36 L13,31 M54,24 L47,29 M54,36 L47,31" stroke="#C98A1A" stroke-width="1" opacity="0.6"/>',
        '<circle cx="30" cy="30" r="15" fill="url(#sw)"/>',
        '<path d="M19,22 C24,28 26,36 24,43 M28,16 C33,24 35,34 33,45 M37,17 C41,24 43,32 41,41" stroke="#FFFFFF" stroke-width="2.6" fill="none" opacity="0.55" stroke-linecap="round"/>',
        '<ellipse cx="24" cy="23" rx="4.5" ry="2.6" fill="#FFFFFF" opacity="0.7" transform="rotate(-35 24 23)"/>',
    ]
    art.part("sweet", 60, 60, (30, 30), "\n".join(body), defs)


def drape():
    """
    The cards' streamer: a 120 x 18 tile, repeated along a card's top edge.
    Two crepe ribbons twisted round each other about y = 9: each one's width
    swells and narrows as it turns, and where it turns its back it's darker.
    Seamless: both twists repeat every 60.
    """
    out = []
    for name, phase in (("purple", 0.0), ("green", math.pi)):
        front, back, hi = PAPER[name]
        n = 120
        for i in range(n):
            x = i
            t = 2 * math.pi * x / 60 + phase
            yc = 9 + 3.6 * math.sin(t)
            wdt = 1.6 + 4.2 * abs(math.cos(t * 0.5 + phase / 2))
            colour = front if math.cos(t) > 0 else back
            out.append((math.cos(t), f'<rect x="{x - 0.05:.2f}" y="{yc - wdt / 2:.2f}" width="1.1" height="{wdt:.2f}" fill="{colour}"/>'))
            # Crepe's fine pleats, catching the light on the near side.
            if i % 3 == 0 and math.cos(t) > 0:
                out.append((math.cos(t) + 0.01, f'<rect x="{x:.2f}" y="{yc - wdt / 2:.2f}" width="0.5" height="{wdt * 0.5:.2f}" fill="{hi}" opacity="0.55"/>'))
    # The ribbon in front where it comes towards the viewer: draw back faces first.
    out.sort(key=lambda p: p[0])
    art.still("streamer-drape", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 18" width="120" height="18">\n'
              + "".join(s for _, s in out) + "\n</svg>\n")


def side_curl():
    """
    A 14 x 40 curl dangling down a card's side from its top corner, in the
    gap beside it (the gap below a card is too short at 320px): the end of
    the cards' streamer, gold, a pink twist round it and a confetti dot.
    """
    gold = curl_pieces(0, 0, 34, 2.4, 4.6, 3, "gold", t_squash=1.0)
    pink = curl_pieces(0, 0, 22, 1.7, 3.4, 2.4, "pink", t_squash=1.0)
    art.still("streamer-curl", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 40" width="14" height="40">\n'
              f'<g transform="translate(8 5.5) rotate(90)">{gold}</g>'
              f'<g transform="translate(5 9) rotate(90)">{pink}</g>'
              '<circle cx="10.5" cy="37" r="1.8" fill="#9B6BE8"/><circle cx="10" cy="36.4" r="0.6" fill="#FFFFFF" opacity="0.6"/>'
              "\n</svg>\n")

for i, p in enumerate(PAPER):
    streamer(p, 40 + i)
confetti("confetti-purple", "purple", "square")
confetti("confetti-green", "green", "round")
confetti("confetti-gold", "gold", "twist")
confetti("confetti-pink", "pink", "square")
confetti("confetti-gold-round", "gold", "round")
sweet()
drape()
side_curl()
art.finish()

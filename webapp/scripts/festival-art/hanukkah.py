"""Hanukkah's art (RFC-020 §3.3): dreidels spinning along the bottom of the
screen, the chocolate coins (gelt) a tap drops, and a row of eight candles
along the cards' top edge, one more lit each night.

    python3 webapp/scripts/festival-art/hanukkah.py

A dreidel spins as a rig rather than as one flat sprite squashed side to
side (`walk`'s `turn`), which would read as a card flipping, not a top
spinning. Its square body is drawn once and stretched to its silhouette at
each angle (one side face-on, the corner at 45°: |cos| + |sin| as wide);
its four faces are parts of their own that slide round it, each as wide as
it faces us and gone when it turns away; a fixed shade over them keeps the
light on the left. The keyframes that do this are computed here, into the
rig (one turn a cycle), so the drawing and its motion live together.

The letters on the faces are the game's (nun, gimel, hei, shin), drawn as
shapes rather than text so no font is needed. The candles are a row of
eight lights, not a menorah (§7: lights, not ritual objects).
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("hanukkah")

S = 56          # the body's side: a face's width face-on
BODY_TOP, BODY_BOT = 40, 104   # the square body, in the dreidel's drawing
TIP = (40, 148)  # the point it spins on: the pivot
W, H = 80, 152

# Each dreidel: body colours (light, mid, dark), the faces' panel and letter colours.
DREIDELS = {
    "blue": {"body": ("#9CC8FF", "#2F6FD6", "#173C82"), "panel": "#2A62C4", "letter": "#F2F6FF", "edge": "#CFE0FF"},
    "silver": {"body": ("#FFFFFF", "#C8D2E0", "#7A8698"), "panel": "#D6DEEA", "letter": "#2456B8", "edge": "#FFFFFF"},
}


def body(name, light, mid, dark):
    """The dreidel without its faces: the knob and stem, the square body, the point."""
    cx = W / 2
    defs = (lin("side", [(0, light, None), (0.35, mid, None), (1, dark, None)], 0, 0, 1, 0) +
            lin("top", [(0, "#FFFFFF", None), (1, light, None)]) +
            lin("pointG", [(0, light, None), (0.4, mid, None), (1, dark, None)], 0, 0, 1, 0.3) +
            rad("knob", [(0, "#FFFFFF", None), (0.5, light, None), (1, mid, None)], fx=0.35, fy=0.3))
    h = S / 2
    b = [
        # The stem and its knob.
        f'<path d="M{cx - 5},{BODY_TOP - 2} L{cx - 4},{12} Q{cx},{8} {cx + 4},{12} L{cx + 5},{BODY_TOP - 2} Z" fill="url(#side)"/>',
        f'<ellipse cx="{cx}" cy="10" rx="7.5" ry="6.5" fill="url(#knob)"/>',
        f'<ellipse cx="{cx - 2.5}" cy="7.5" rx="2.5" ry="1.6" fill="#FFFFFF" opacity="0.85"/>',
        # The top of the body, seen from a little above.
        f'<path d="M{cx - h},{BODY_TOP + 2} Q{cx - h},{BODY_TOP - 5} {cx},{BODY_TOP - 6} Q{cx + h},{BODY_TOP - 5} {cx + h},{BODY_TOP + 2} Z" fill="url(#top)"/>',
        f'<ellipse cx="{cx}" cy="{BODY_TOP - 1}" rx="6.5" ry="2.4" fill="{dark}" opacity="0.35"/>',
        # The body, rounded at its corners; the point below it.
        f'<path d="M{cx - h},{BODY_TOP + 1} L{cx + h},{BODY_TOP + 1} L{cx + h},{BODY_BOT - 4} Q{cx + h},{BODY_BOT} {cx + h - 4},{BODY_BOT + 2} '
        f'L{TIP[0] + 2},{TIP[1] - 3} Q{TIP[0]},{TIP[1] + 1} {TIP[0] - 2},{TIP[1] - 3} L{cx - h + 4},{BODY_BOT + 2} Q{cx - h},{BODY_BOT} {cx - h},{BODY_BOT - 4} Z" fill="url(#pointG)"/>',
        f'<path d="M{cx - h},{BODY_TOP + 1} L{cx + h},{BODY_TOP + 1} L{cx + h},{BODY_BOT - 3} L{cx - h},{BODY_BOT - 3} Z" fill="url(#side)"/>',
        # The light along the point's left and the body's top edge.
        f'<path d="M{cx - h + 5},{BODY_BOT + 4} L{TIP[0] - 3},{TIP[1] - 8}" stroke="#FFFFFF" stroke-width="2" opacity="0.4" stroke-linecap="round"/>',
        f'<path d="M{cx - h + 2},{BODY_TOP + 2.5} L{cx + h - 2},{BODY_TOP + 2.5}" stroke="#FFFFFF" stroke-width="1.4" opacity="0.6"/>',
    ]
    art.part(name, W, H, TIP, "\n".join(b), defs, "the dreidel without its faces; pivot at its point, which it spins on")


# The game's four letters as filled shapes in a 30 x 34 box, drawn with a
# broad nib: thick horizontals at the top, a heavy stroke down the right.
LETTERS = {
    "nun": "M9,4 L19,4 Q23,4 23,8 L23,30 L7,30 L7,26 L18,26 L18,9 L9,9 Z",
    "gimel": "M9,4 L18,4 Q22,4 22,8 L22,19 L26,30 L21,30 L18,22 L12,30 L7,30 L16,18 L16,9 L9,9 Z",
    "hei": "M5,4 L23,4 Q27,4 27,8 L27,30 L22,30 L22,9 L5,9 Z M6,14 L11,14 L11,30 L6,30 Z",
    "shin": "M4,4 L9,4 L11,24 L14,24 L13,4 L18,4 L19,24 L22,24 L22,4 L27,4 L27,26 Q27,30 23,30 L8,30 Q4,30 4,26 Z",
}


def face(name, letter, panel, ink, edge):
    """One face: a painted panel with its letter, 56 x 60, centred on its pivot."""
    defs = lin("panel", [(0, edge, 0.55), (0.12, panel, None), (1, panel, None)], 0, 0, 1, 1)
    b = [
        f'<rect x="3" y="3" width="50" height="54" rx="5" fill="url(#panel)" opacity="0.9"/>',
        f'<rect x="3.5" y="3.5" width="49" height="53" rx="5" fill="none" stroke="{edge}" stroke-width="1.6" opacity="0.7"/>',
        f'<g transform="translate(12.5 13)"><path d="{LETTERS[letter]}" fill="#000000" opacity="0.18" transform="translate(1 1.2)"/>'
        f'<path d="{LETTERS[letter]}" fill="{ink}"/></g>',
    ]
    art.part(name, 56, 60, (28, 30), "\n".join(b), defs, "a face of the dreidel; slides round the body as it spins")


def shade():
    """Over the faces, fixed: the light on the left, shadow on the right, whatever faces us."""
    defs = lin("shade", [(0, "#FFFFFF", 0.28), (0.3, "#FFFFFF", 0), (0.62, "#000000", 0), (1, "#000000", 0.38)], 0, 0, 1, 0)
    art.part("dreidel-shade", S, BODY_BOT - BODY_TOP - 3, (S / 2, BODY_BOT - BODY_TOP - 3), f'<rect width="{S}" height="{BODY_BOT - BODY_TOP - 3}" fill="url(#shade)"/>', defs,
             "the light across the body; pivot at its bottom middle")


def gelt(name, foil):
    """A chocolate coin in gold or silver foil, 44 x 44: what a tap drops."""
    light, mid, dark = foil
    defs = (rad("foil", [(0, light, None), (0.55, mid, None), (1, dark, None)], fx=0.32, fy=0.28) +
            lin("rim", [(0, light, None), (1, dark, None)], 0, 0, 1, 1))
    b = [
        '<circle cx="22" cy="22" r="19" fill="url(#rim)"/>',
        '<circle cx="22" cy="22" r="15.5" fill="url(#foil)"/>',
        # The crinkle of the foil, and a pressed ring of beads.
        "".join(f'<circle cx="{22 + math.cos(a) * 17.2:.1f}" cy="{22 + math.sin(a) * 17.2:.1f}" r="0.9" fill="{light}" opacity="0.8"/>' for a in [i * math.pi / 12 for i in range(24)]),
        f'<circle cx="22" cy="22" r="11" fill="none" stroke="{dark}" stroke-width="1.2" opacity="0.5"/>',
        f'<circle cx="22" cy="22" r="11" fill="none" stroke="{light}" stroke-width="0.8" opacity="0.7" transform="translate(-0.7 -0.7)"/>',
        # A little dreidel pressed in the middle.
        f'<path d="M22,13 L22,16 M17.5,16 L26.5,16 L26.5,23 L22,29 L17.5,23 Z" stroke="{dark}" stroke-width="1.3" fill="none" stroke-linejoin="round" opacity="0.6"/>',
        '<ellipse cx="15" cy="13" rx="6" ry="3" fill="#FFFFFF" opacity="0.6" transform="rotate(-35 15 13)"/>',
    ]
    art.part(name, 44, 44, (22, 22), "\n".join(b), defs, "a tap drops these")


def lights(lit):
    """Eight candles in silver cups on a card's top edge, 120 x 39, the edge at y 38; the `lit` rightmost alight."""
    rnd = random.Random(8)
    defs = (lin("wax0", [(0, "#FFFFFF", None), (1, "#C9D8F2", None)], 0, 0, 1, 0) +
            lin("wax1", [(0, "#8FB8FF", None), (1, "#2456B8", None)], 0, 0, 1, 0) +
            lin("cup", [(0, "#FFFFFF", None), (0.5, "#C8D2E0", None), (1, "#7A8698", None)], 0, 0, 1, 0) +
            rad("halo", [(0, "#FFE9A8", 0.75), (0.4, "#FFC860", 0.28), (1, "#FFC860", 0)]) +
            rad("flame", [(0, "#FFFFFF", None), (0.35, "#FFF0A8", None), (0.75, "#FFB02E", None), (1, "#FF7A1A", None)], cy=0.65, fy=0.75) +
            blur("soft", 1.2))
    ground = 38
    b = [f'<ellipse cx="60" cy="{ground + 0.8}" rx="54" ry="1.8" fill="#0A1430" opacity="0.25" filter="url(#soft)"/>']
    for i in range(8):
        x = 11 + i * 14
        on = i >= 8 - lit
        h = 15 + rnd.uniform(-0.6, 0.6)
        top = ground - 4 - h
        wax = f"wax{i % 2}"
        if on:
            b.append(f'<circle cx="{x}" cy="{top - 6}" r="10" fill="url(#halo)"/>')
        # The candle, a twist of colour round it, a drip of wax.
        b.append(f'<rect x="{x - 2.6}" y="{top:.1f}" width="5.2" height="{h + 1:.1f}" rx="1.2" fill="url(#{wax})"/>')
        stripe = "#FFFFFF" if i % 2 else "#4A86E8"
        for k in range(4):
            y = top + 2.5 + k * 3.6
            b.append(f'<path d="M{x - 2.6},{y + 1.6:.1f} L{x + 2.6},{y:.1f}" stroke="{stripe}" stroke-width="1" opacity="0.65"/>')
        b.append(f'<path d="M{x - 2.6},{top + 0.8:.1f} q0,3 1.2,3.4 q0.6,-1.6 0.4,-3.2 Z" fill="#FFFFFF" opacity="0.55"/>')
        b.append(f'<rect x="{x - 2}" y="{top + 1:.1f}" width="1.2" height="{h - 2:.1f}" rx="0.6" fill="#FFFFFF" opacity="0.4"/>')
        # The cup it stands in.
        b.append(f'<path d="M{x - 4.6},{ground - 5} L{x + 4.6},{ground - 5} L{x + 3.2},{ground} L{x - 3.2},{ground} Z" fill="url(#cup)"/>')
        b.append(f'<ellipse cx="{x}" cy="{ground - 5}" rx="4.6" ry="1.1" fill="#FFFFFF" opacity="0.8"/>')
        # The wick, and its flame if lit.
        b.append(f'<path d="M{x},{top:.1f} l0.3,-2.2" stroke="#3A2A1E" stroke-width="0.8" stroke-linecap="round"/>')
        if on:
            fy = top - 2.4
            b.append(f'<path d="M{x},{fy - 8.5:.1f} C{x + 2.8},{fy - 4:.1f} {x + 2.6},{fy + 0.6:.1f} {x},{fy + 0.8:.1f} C{x - 2.6},{fy + 0.6:.1f} {x - 2.8},{fy - 4:.1f} {x},{fy - 8.5:.1f} Z" fill="url(#flame)"/>')
            b.append(f'<ellipse cx="{x}" cy="{fy - 1.2:.1f}" rx="0.9" ry="1.3" fill="#7FB0FF" opacity="0.7"/>')
    art.still(f"lights-{lit}", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 39" width="120" height="39">\n<defs>{defs}</defs>\n' + "\n".join(b) + "\n</svg>\n")


for colour, d in DREIDELS.items():
    body(f"dreidel-{colour}", *d["body"])
    for letter in LETTERS:
        face(f"face-{colour}-{letter}", letter, d["panel"], d["letter"], d["edge"])
shade()
gelt("gelt-gold", ("#FFF4B8", "#F2C23A", "#A8741A"))
gelt("gelt-silver", ("#FFFFFF", "#CBD4E0", "#7E8A9C"))
for n in range(1, 9):
    lights(n)


# The spin, one turn a cycle: a face at angle a (0: facing us) sits sin(a)
# half a side across and is cos(a) of a side wide; turned away, it's gone
# (held at the edge, zero wide). The body is |cos| + |sin| as wide as a side.
N = 32
def keys(f):
    return [[round(i / N, 4), round(f(2 * math.pi * i / N), 4)] for i in range(N)]

art.finish(rig={
    "spin": {
        "side": S,
        "face_at": [0, -(TIP[1] - (BODY_TOP + BODY_BOT - 3) / 2)],
        "face_x": keys(lambda a: S / 2 * math.sin(a) if math.cos(a) > 0 else S / 2 * math.copysign(1, math.sin(a))),
        "face_w": keys(lambda a: max(0.0, math.cos(a))),
        "body_w": keys(lambda a: abs(math.cos(a)) + abs(math.sin(a))),
        "shade_at": [0, -(TIP[1] - (BODY_BOT - 3))],
    },
    "walk": {"period": 0.42, "bob": 1.5, "wobble": 5.0, "wobble_ms": 1400},
})

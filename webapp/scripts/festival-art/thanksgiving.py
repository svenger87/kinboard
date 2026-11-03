"""Thanksgiving's art (RFC-020 §3.3): leaves at the cards' corners, and a
pumpkin pie among leaves on the Tasks card's corner.

    python3 webapp/scripts/festival-art/thanksgiving.py

The leaves blowing across are Sukkot's parts (the kit borrows that folder,
`art: "sukkot"`); the leaves here are the same drawing, _leaves.py's, laid
out for the dressing. The leaf crown is drawn in the kit, as the shop's
items are.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur
from _leaves import leaf

art = Art("thanksgiving")


def svg(name, W, H, defs, body, scale=2):
    """A still drawn at `scale` units to the CSS pixel, for detail on a wall."""
    art.still(name, (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // scale}" height="{H // scale}">\n'
                     f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


def leaves_corner():
    """88 x 60 units (44 x 30 px), the card's corner at (28, 32): leaves fanned over it, mostly outside the card."""
    defs, body = "", []
    for i, (kind, colour, x, y, turn, size) in enumerate((("oak", "brown", 22, 30, -60, 40), ("maple", "red", 30, 22, -20, 38),
                                                          ("elm", "gold", 58, 18, 75, 30), ("maple", "orange", 14, 46, -110, 26))):
        d, b = leaf(kind, colour, f"c{i}", x, y, size, turn=turn, seed=20 + i)
        defs += d
        body.append(b)
    # An acorn among them.
    defs += rad("acorn", [(0, "#E9B77A", None), (0.6, "#B5702E", None), (1, "#6B3B1A", None)], fx=0.3, fy=0.3)
    defs += rad("cup", [(0, "#A8825A", None), (1, "#5E4024", None)], fx=0.3, fy=0.3)
    body.append('<g transform="translate(46 40) rotate(-25)"><ellipse cx="0" cy="4" rx="6" ry="7.5" fill="url(#acorn)"/>'
                '<path d="M-7,1 C-7,-6 7,-6 7,1 Z" fill="url(#cup)"/><path d="M0,-4.5 l1,-3" stroke="#5E4024" stroke-width="1.6" stroke-linecap="round"/>'
                '<ellipse cx="-2.2" cy="4" rx="1.6" ry="2.6" fill="#FFFFFF" opacity="0.4"/></g>')
    svg("leaves-corner", 88, 60, defs, body)


def pie():
    """112 x 80 units (56 x 40 px): a pumpkin pie in its dish, cream on top, leaves at its foot. Its base at the bottom edge."""
    rnd = random.Random(7)
    defs = (lin("dish", [(0, "#F4EBDD", None), (0.6, "#D9CDB8", None), (1, "#A89880", None)]) +
            lin("crust", [(0, "#F2C886", None), (1, "#C98F55", None)]) +
            rad("fill", [(0, "#F7A04A", None), (0.6, "#D9701E", None), (1, "#A8501A", None)], cx=0.42, cy=0.4, fx=0.35, fy=0.3) +
            rad("cream", [(0, "#FFFFFF", None), (0.7, "#FFF6E6", None), (1, "#EADBC2", None)], fx=0.35, fy=0.3) +
            blur("soft", 2.5))
    cx = 56
    body = [
        f'<ellipse cx="{cx}" cy="74" rx="44" ry="5" fill="#2A1A0E" opacity="0.3" filter="url(#soft)"/>',
        # the dish's side, then the crust's rim round the filling
        f'<path d="M14,50 L20,68 C30,76 82,76 92,68 L98,50 Z" fill="url(#dish)"/>',
        f'<path d="M22,58 C40,64 72,64 90,58" stroke="#B9AE9A" stroke-width="1.4" fill="none" opacity="0.6"/>',
        f'<ellipse cx="{cx}" cy="48" rx="44" ry="15" fill="url(#crust)"/>',
    ]
    # The crimped edge: little rounded scallops round the rim.
    for i in range(22):
        a = 2 * math.pi * i / 22
        x, y = cx + math.cos(a) * 41, 48 + math.sin(a) * 13.5
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.2" fill="{"#F2C886" if math.sin(a) < 0.2 else "#D9A35F"}"/>')
    body += [
        f'<ellipse cx="{cx}" cy="48" rx="36" ry="10.5" fill="url(#fill)"/>',
        "".join(f'<circle cx="{cx + rnd.uniform(-28, 28):.1f}" cy="{48 + rnd.uniform(-6, 6):.1f}" r="{rnd.uniform(0.5, 1):.1f}" fill="#8E3F12" opacity="0.4"/>' for _ in range(18)),
        f'<ellipse cx="{cx - 12}" cy="44" rx="12" ry="3" fill="#FFFFFF" opacity="0.25"/>',
        # a dollop of cream
        f'<path d="M{cx - 11},46 C{cx - 13},38 {cx - 4},38 {cx - 4},34 C{cx - 3},29 {cx + 4},30 {cx + 3},35 C{cx + 10},35 {cx + 13},41 {cx + 10},46 C{cx + 4},50 {cx - 6},50 {cx - 11},46 Z" fill="url(#cream)"/>',
        f'<ellipse cx="{cx - 4}" cy="38" rx="3" ry="1.8" fill="#FFFFFF"/>',
        f'<path d="M{cx - 2},31 q3,-1 4,-4" stroke="#FFF6E6" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
    ]
    defs2 = ""
    for i, (kind, colour, x, y, turn, size) in enumerate((("maple", "red", 12, 66, -30, 30), ("oak", "orange", 100, 64, 60, 30), ("maple", "gold", 90, 72, 10, 22))):
        d, b = leaf(kind, colour, f"p{i}", x, y, size, turn=turn, seed=30 + i)
        defs2 += d
        body.append(b)
    svg("pie", 112, 80, defs + defs2, body)


leaves_corner()
pie()
art.finish()

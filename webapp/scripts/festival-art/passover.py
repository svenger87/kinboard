"""Passover's art (RFC-020 §3.3): a sprig of spring blossom laid on a card's
top corner -- almond blossom, white blushing pink, with wine-red buds and a
few young leaves on a slender branch, and a petal coming loose.

    python3 webapp/scripts/festival-art/passover.py

No visitor and no outfit: the blossom is the whole of it, so it carries the
detail. Drawn for a card's top-right corner; CSS mirrors it for the left.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("passover")

WINE, WINE_DARK, WINE_LIGHT = "#9E2346", "#6B1230", "#D9577A"


def blossom(cx, cy, r, turn, rnd):
    """Five round petals, white blushing pink toward the heart, a wine-red eye and a ring of stamens."""
    out = []
    for k in range(5):
        a = math.radians(turn + k * 72)
        px, py = cx + math.cos(a) * r * 0.52, cy + math.sin(a) * r * 0.52
        rot = math.degrees(a) + 90
        wob = rnd.uniform(0.9, 1.06)
        out.append(f'<ellipse cx="{px:.2f}" cy="{py:.2f}" rx="{r * 0.46 * wob:.2f}" ry="{r * 0.56 * wob:.2f}" fill="url(#petal)" transform="rotate({rot:.1f} {px:.2f} {py:.2f})"/>')
        # Its fine vein.
        out.append(f'<path d="M{cx + math.cos(a) * r * 0.2:.2f},{cy + math.sin(a) * r * 0.2:.2f} L{cx + math.cos(a) * r * 0.78:.2f},{cy + math.sin(a) * r * 0.78:.2f}" '
                   f'stroke="#E8A6B9" stroke-width="{r * 0.05:.2f}" opacity="0.6" stroke-linecap="round"/>')
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r * 0.3:.2f}" fill="url(#eye)"/>')
    for k in range(9):
        a = math.radians(k * 40 + turn)
        sx, sy = cx + math.cos(a) * r * 0.36, cy + math.sin(a) * r * 0.36
        out.append(f'<path d="M{cx:.2f},{cy:.2f} L{sx:.2f},{sy:.2f}" stroke="{WINE_LIGHT}" stroke-width="{r * 0.04:.2f}" opacity="0.8"/>'
                   f'<circle cx="{sx:.2f}" cy="{sy:.2f}" r="{r * 0.07:.2f}" fill="#FFD86B"/>')
    # The light on the upper-left petal.
    out.append(f'<ellipse cx="{cx - r * 0.45:.2f}" cy="{cy - r * 0.5:.2f}" rx="{r * 0.22:.2f}" ry="{r * 0.12:.2f}" fill="#FFFFFF" opacity="0.8" transform="rotate(-40 {cx - r * 0.45:.2f} {cy - r * 0.5:.2f})"/>')
    return "".join(out)


def bud(x, y, r, turn):
    """A closed bud, wine red, in its green cup."""
    return (f'<g transform="translate({x:.2f} {y:.2f}) rotate({turn:.1f})">'
            f'<path d="M0,{r * 0.6:.2f} C{-r * 0.9:.2f},{r * 0.2:.2f} {-r * 0.7:.2f},{-r:.2f} 0,{-r * 1.2:.2f} C{r * 0.7:.2f},{-r:.2f} {r * 0.9:.2f},{r * 0.2:.2f} 0,{r * 0.6:.2f} Z" fill="url(#bud)"/>'
            f'<path d="M{-r * 0.55:.2f},{r * 0.15:.2f} Q0,{r * 1.1:.2f} {r * 0.55:.2f},{r * 0.15:.2f} Q0,{r * 0.5:.2f} {-r * 0.55:.2f},{r * 0.15:.2f} Z" fill="#5E9E4A"/>'
            f'<ellipse cx="{-r * 0.25:.2f}" cy="{-r * 0.55:.2f}" rx="{r * 0.18:.2f}" ry="{r * 0.32:.2f}" fill="#FFFFFF" opacity="0.5"/>'
            "</g>")


def leaf(x, y, l, turn):
    return (f'<g transform="translate({x:.2f} {y:.2f}) rotate({turn:.1f})">'
            f'<path d="M0,0 C{l * 0.3:.2f},{-l * 0.28:.2f} {l * 0.75:.2f},{-l * 0.22:.2f} {l:.2f},0 C{l * 0.75:.2f},{l * 0.2:.2f} {l * 0.3:.2f},{l * 0.24:.2f} 0,0 Z" fill="url(#leaf)"/>'
            f'<path d="M{l * 0.08:.2f},0 L{l * 0.85:.2f},0" stroke="#2F6B2A" stroke-width="0.5" opacity="0.5"/>'
            "</g>")


def blossom_corner():
    """76 x 28: a branch lying along a card's top edge from its top-right corner, the blossoms above it.

    The kit hangs it wholly outside the card, in the grid's gap, ending at
    the card's edge (a card's content can start at its very first pixel),
    so the whole drawing may be seen; CSS draws it at 54 x 20 px, resting on the edge.
    """
    rnd = random.Random(53)
    W, H = 76, 28
    defs = (rad("petal", [(0, "#FFC9D8", None), (0.45, "#FFF1F5", None), (1, "#FFFFFF", None)], cx=0.5, cy=0.9, r=0.95) +
            rad("eye", [(0, WINE_LIGHT, None), (1, WINE_DARK, None)], fx=0.4, fy=0.35) +
            rad("bud", [(0, WINE_LIGHT, None), (0.55, WINE, None), (1, WINE_DARK, None)], cx=0.35, cy=0.3, r=0.85) +
            lin("leaf", [(0, "#A8E07A", None), (1, "#4E9A3E", None)]) +
            lin("bark", [(0, "#8A6146", None), (1, "#4E3222", None)]) +
            '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>')
    body = [
        # The shadow it casts on the card's edge.
        '<path d="M8,25 Q36,22 70,26" stroke="#2A1020" stroke-width="3" fill="none" opacity="0.14" filter="url(#soft)"/>',
        # The branch: from beyond the corner, along the top edge, a twig rising.
        '<path d="M75,26 C62,24 46,21 30,20 C20,19.5 12,17 4,12" stroke="url(#bark)" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
        '<path d="M46,21 C44,16 45,11 49,7" stroke="url(#bark)" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
        '<path d="M22,19 C19,15 18,11 20,7" stroke="url(#bark)" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
        '<path d="M66,25 C62,22.5 50,20.5 38,20" stroke="#C49A78" stroke-width="0.8" fill="none" opacity="0.6" stroke-linecap="round"/>',
        leaf(55, 22.5, 9, 160), leaf(33, 19.5, 8, -150), leaf(12, 16, 7, 195),
        bud(6, 10, 3.0, -50), bud(49, 6, 2.7, 15), bud(20, 6.2, 2.4, -10),
    ]
    # The blossoms: the biggest on the corner, the rest along the branch.
    for (x, y, r, t) in ((61, 15, 9.0, -8), (37, 12.5, 8.0, 20), (27, 15.5, 5.6, 5), (70, 21, 5.2, 30)):
        body.append(blossom(x, y, r, t, rnd))
    # A petal coming loose, drifting off the corner.
    body.append('<ellipse cx="73" cy="5" rx="2.4" ry="3.2" fill="url(#petal)" transform="rotate(35 73 5)"/>')
    art.still("blossom-corner", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
                                 f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


blossom_corner()
art.finish()

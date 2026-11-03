"""New Year's Eve's art (RFC-020 §3.3): confetti at the cards' corners.

    python3 webapp/scripts/festival-art/new-years-eve.py

The fireworks over the clock need no art here: their sparks, trails and
crackles are drawn once per colour by the engine (lib/festivals/visitors/sprites.ts),
in the colours and kinds of shell the kit names. The party hat is drawn in the kit itself, as the shop's items are.

One corner, drawn for the top-left, as a strip along the card's top edge:
thick at the corner and thinning along the edge, mostly in the gap above
the card and beside it, at most 5px over its edge, so its box stays clear of
the card's 16px padding. CSS mirrors it for the other corners.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("new-years-eve")

# The kit's colours: gold, rose, mint, sky and violet, each with its shade.
COLOURS = [("#FFE27A", "#E0A419"), ("#FF9AB0", "#E0557A"), ("#9FEBC6", "#3FB58A"), ("#A6D8FF", "#4A9BE8"), ("#D7BDFF", "#9466E0")]


def confetti_corner():
    """64 x 20, the corner at (16, 14): pieces scattered along the edge from it, lit from the top left."""
    rnd = random.Random(31)
    W, H, CX, CY = 64, 20, 16, 14
    defs = "".join(lin(f"c{i}", [(0, a, None), (1, b, None)], 0, 0, 1, 1) for i, (a, b) in enumerate(COLOURS))
    defs += rad("spark", [(0, "#FFFFFF", 0.95), (0.4, "#FFE27A", 0.7), (1, "#FFE27A", 0)])
    pieces = []
    # Scattered round the corner, outside the card: some in the corner itself,
    # the rest trailing off along its top edge (above it) and down its left
    # edge (beside it), thinning with distance. At most 6px over either edge.
    spots = []
    for n in range(80):
        t = rnd.random() ** 1.5
        if n % 4 == 0:  # beside the corner, outside the card
            x, y = rnd.uniform(4, CX - 2), rnd.uniform(4, H - 4)
        else:  # along the top edge, thinning away from the corner
            x, y = 4 + t * (W - 8), rnd.uniform(3.5, CY + 2 - t * 4)
        if any(math.hypot(x - sx, y - sy) < 3.6 for sx, sy in spots):
            continue
        spots.append((x, y))
        c = rnd.randrange(len(COLOURS))
        turn = rnd.uniform(0, 180)
        kind = rnd.random()
        if kind < 0.5:
            # A paper square, turned, its top edge catching the light.
            w, h = rnd.uniform(3.2, 5.2), rnd.uniform(2.2, 3.4)
            pieces.append(f'<g transform="translate({x:.1f} {y:.1f}) rotate({turn:.0f})"><rect x="{-w/2:.1f}" y="{-h/2:.1f}" width="{w:.1f}" height="{h:.1f}" rx="0.8" fill="url(#c{c})"/>'
                          f'<rect x="{-w/2:.1f}" y="{-h/2:.1f}" width="{w:.1f}" height="{h*0.35:.1f}" rx="0.6" fill="#FFFFFF" opacity="0.35"/></g>')
        elif kind < 0.82:
            # A dot.
            r = rnd.uniform(1.2, 2)
            pieces.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="url(#c{c})"/><circle cx="{x - r*0.35:.1f}" cy="{y - r*0.35:.1f}" r="{r*0.35:.1f}" fill="#FFFFFF" opacity="0.55"/>')
        else:
            # A curl of streamer.
            s_ = rnd.uniform(3.5, 5)
            pieces.append(f'<path d="M{x - s_/2:.1f},{y:.1f} c{s_*0.3:.1f},{-s_*0.5:.1f} {s_*0.7:.1f},{-s_*0.2:.1f} {s_*0.5:.1f},{s_*0.3:.1f} c{-s_*0.15:.1f},{s_*0.3:.1f} {s_*0.3:.1f},{s_*0.5:.1f} {s_*0.6:.1f},{s_*0.2:.1f}" '
                          f'stroke="{COLOURS[c][1]}" stroke-width="1.4" fill="none" stroke-linecap="round" transform="rotate({turn:.0f} {x:.1f} {y:.1f})"/>')
    # A sparkle where the corner is.
    pieces.append(f'<circle cx="{CX}" cy="{CY}" r="5" fill="url(#spark)"/>')
    pieces.append(f'<path d="M{CX},{CY-4} L{CX+0.8},{CY-0.8} L{CX+4},{CY} L{CX+0.8},{CY+0.8} L{CX},{CY+4} L{CX-0.8},{CY+0.8} L{CX-4},{CY} L{CX-0.8},{CY-0.8} Z" fill="#FFFFFF" opacity="0.9"/>')
    art.still("confetti-corner", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
                                  f"<defs>{defs}</defs>\n" + "\n".join(pieces) + "\n</svg>\n"))


confetti_corner()
art.finish()

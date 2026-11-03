"""King's Day's art (RFC-020 §3.3): orange balloons in three shades rising
on curling strings, the tompouce (the orange-iced pastry of the day) that a
tap drops, and the orange bunting along the cards' top edges.

    python3 webapp/scripts/festival-art/kings-day.py

The crown is drawn in the kit, as the shop's items are.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("kings-day")

# Light, base, shade: three oranges.
BALLOONS = {
    "balloon": ("#FFC27A", "#FF8A1F", "#C9560A"),
    "balloon-light": ("#FFE2B0", "#FFB347", "#D97A14"),
    "balloon-deep": ("#FF9F6B", "#F2600F", "#A83A06"),
}


# The balloons are drawn in 60 x 136 units and stored 1.5 times that, so they
# are as crisp as they are big on a wall (56px across on a 1080p screen).
BIG = 1.5


def balloon(name, seed):
    """A glossy balloon, its knot, and a curling ribbon string. Pivot at the knot, so it sways from there."""
    rnd = random.Random(seed)
    hi, base, low = BALLOONS[name]
    W, H = 60, 136
    defs = (rad("b", [(0, hi, None), (0.45, base, None), (1, low, None)], cx=0.36, cy=0.3, r=0.8) +
            rad("gl", [(0, "#FFFFFF", 0.9), (1, "#FFFFFF", 0)]) +
            '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.5"/></filter>')
    # The string curls as it hangs: a few loose S-bends down from the knot.
    k = rnd.uniform(0.8, 1.2)
    string = f"M30,68 C{30 + 9 * k:.1f},78 {30 - 9 * k:.1f},88 30,98 C{30 + 8 * k:.1f},108 {30 - 7 * k:.1f},118 {30 + 2 * k:.1f},132"
    body = [
        f'<path d="{string}" stroke="{low}" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
        f'<path d="{string}" stroke="#FFFFFF" stroke-width="0.6" fill="none" opacity="0.5" transform="translate(-0.6 -0.4)"/>',
        # The balloon: rounder at the top, pinched to the knot.
        '<path d="M30,62 C14,60 4,46 5,30 C6,14 17,4 30,4 C43,4 54,14 55,30 C56,46 46,60 30,62 Z" fill="url(#b)"/>',
        # The knot.
        f'<path d="M30,61 L26,68 L34,68 Z" fill="{low}"/><ellipse cx="30" cy="68" rx="4.2" ry="1.8" fill="{base}"/>',
        # The gloss: a soft window of light at the upper left, a sharp glint in it, a rim light on the right.
        '<ellipse cx="20" cy="20" rx="9" ry="13" fill="url(#gl)" transform="rotate(28 20 20)"/>',
        '<ellipse cx="17.5" cy="15.5" rx="2.6" ry="4.6" fill="#FFFFFF" opacity="0.95" transform="rotate(30 17.5 15.5)"/>',
        f'<path d="M50,24 C53,34 50,46 42,54" stroke="{hi}" stroke-width="2" fill="none" opacity="0.6" stroke-linecap="round" filter="url(#soft)"/>',
        # The crease where it gathers to the knot.
        f'<path d="M26,58 C28,60 32,60 34,58" stroke="{low}" stroke-width="1.2" fill="none" opacity="0.6"/>',
    ]
    art.part(name, round(W * BIG), round(H * BIG), (30 * BIG, 66 * BIG), f'<g transform="scale({BIG})">' + "\n".join(body) + "</g>", defs,
             "pivot at the knot: it sways from there as it rises")


def tompouce():
    """40 x 40: a tompouce seen from above and the side: two layers of puff pastry, yellow custard, orange icing on top."""
    defs = (lin("ice", [(0, "#FFB766", None), (1, "#F27A12", None)]) +
            lin("pastry", [(0, "#F6D79A", None), (1, "#C9934A", None)]) +
            lin("cream", [(0, "#FFF2A8", None), (1, "#F5D45A", None)]))
    body = ('<g transform="rotate(-8 20 20)">'
            '<path d="M4,26 L30,30 L36,24 L36,28 L30,34 L4,30 Z" fill="url(#pastry)"/>'
            '<path d="M4,18 L30,22 L30,30 L4,26 Z" fill="url(#cream)"/>'
            '<path d="M30,22 L36,16 L36,24 L30,30 Z" fill="#E8C24A"/>'
            '<path d="M4,15 L30,19 L36,13 L10,9 Z" fill="url(#ice)"/>'
            '<path d="M4,15 L30,19 L30,22 L4,18 Z" fill="url(#pastry)"/>'
            '<path d="M30,19 L36,13 L36,16 L30,22 Z" fill="#B88440"/>'
            '<path d="M8,12.5 L24,15" stroke="#FFFFFF" stroke-width="1.4" opacity="0.6" stroke-linecap="round"/>'
            '<path d="M6,22 Q10,24 14,22 Q18,24 22,22 Q26,24 29,23" stroke="#FFFFFF" stroke-width="0.8" fill="none" opacity="0.6"/>'
            "</g>")
    art.part("tompouce", 40, 40, (20, 20), body, defs, "dropped by a tap: the orange tompouce of King's Day")


PENNANTS = [("#FFB347", "#F2780F"), ("#FFFFFF", "#E6DCD0"), ("#FF8A1F", "#C9560A"), ("#FFD08A", "#F29A2E")]


def bunting():
    """A 96 x 18 tile of orange bunting, repeated along a card's top edge.

    The kit hangs it wholly outside the card, in the grid's gap, ending at
    the card's edge (a card's content can start at its very first pixel),
    so the whole drawing may be seen; CSS draws it at 85 x 16 px, above the edge.
    """
    W, H = 96, 18
    defs = "".join(lin(f"p{i}", [(0, a, None), (1, b, None)], 0, 0, 0.7, 1) for i, (a, b) in enumerate(PENNANTS))
    sag = lambda x: 2.2 + 4.2 * math.sin(math.pi * x / W)
    out = [f'<path d="M0,{sag(0):.2f} Q{W / 2},{sag(W / 2) * 2 - 2.2:.2f} {W},{sag(W):.2f}" stroke="#7A5A3A" stroke-width="1.1" fill="none"/>']
    for i in range(4):
        x0 = 5 + i * 22.5
        x1 = x0 + 18
        y0, y1 = sag(x0), sag(x1)
        tip = ((x0 + x1) / 2 + 0.6, max(y0, y1) + 11.3)
        out.append(f'<path d="M{x0:.2f},{y0:.2f} L{x1:.2f},{y1:.2f} L{tip[0]:.2f},{tip[1]:.2f} Z" fill="url(#p{i})"/>')
        # The hem along the top, a stitched line, the light on the left edge.
        out.append(f'<path d="M{x0 + 0.5:.2f},{y0 + 1:.2f} L{x1 - 0.5:.2f},{y1 + 1:.2f}" stroke="{PENNANTS[i][1]}" stroke-width="1.4" opacity="0.8" stroke-linecap="round"/>')
        out.append(f'<path d="M{x0 + 3:.2f},{y0 + 2.6:.2f} L{tip[0] - 0.4:.2f},{tip[1] - 3.2:.2f} L{x1 - 3:.2f},{y1 + 2.6:.2f}" stroke="#FFFFFF" stroke-width="0.6" '
                   f'stroke-dasharray="1.2 1.2" fill="none" opacity="{0.35 if i == 1 else 0.6}"/>')
        out.append(f'<path d="M{x0 + 1.5:.2f},{y0 + 1:.2f} L{tip[0] - 1:.2f},{tip[1] - 2.5:.2f}" stroke="#FFFFFF" stroke-width="1" opacity="0.5" stroke-linecap="round"/>')
    out.append(f'<circle cx="0.8" cy="{sag(0):.2f}" r="1.3" fill="#2F6BC4"/><circle cx="{W - 0.8}" cy="{sag(W):.2f}" r="1.3" fill="#2F6BC4"/>')
    art.still("bunting", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="none">\n'
                          f"<defs>{defs}</defs>\n" + "\n".join(out) + "\n</svg>\n"))


for i, name in enumerate(BALLOONS):
    balloon(name, 71 + i)
tompouce()
bunting()
art.finish()

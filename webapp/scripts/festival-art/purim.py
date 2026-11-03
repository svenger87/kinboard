"""Purim's art (RFC-020 §3.3): noisemakers and masks tumbling across, a
hamantasch for a tap, and masks hanging from the cards: a garland of
them along each card's top edge.

    python3 webapp/scripts/festival-art/purim.py

The noisemaker is the wooden ratchet children whirl: a turned handle, a
cogwheel, and a painted box that swings round it. The masks are carnival
domino masks with gold trim, one with a feather. All lit from the top
left, no outlines.
"""
import sys, os, math
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("purim")

# (light, mid, deep) paints.
PAINT = {
    "purple": ("#C7A6FF", "#8A5BDB", "#56349E"),
    "gold": ("#FFF0B0", "#F2C14A", "#B8821C"),
    "rose": ("#FFC2D4", "#F0668F", "#B23A62"),
    "teal": ("#BDF2EA", "#2FB5A3", "#1D7569"),
}
WOOD = ("#F2CF9A", "#C98E4E", "#8A5A2B")


def grad(key, p, x2=1, y2=1):
    a, b, c = p
    return lin(key, [(0, a, None), (0.45, b, None), (1, c, None)], 0, 0, x2, y2)


def noisemaker(name, box, trim):
    """A ratchet, 90 x 90, pivot at the cog: the handle down, the box out to the right."""
    defs = grad("bx", PAINT[box]) + grad("tr", PAINT[trim], 0, 1) + grad("wd", WOOD, 1, 0.3) + rad("cg", [(0, "#FFF6D6", None), (1, "#B8821C", None)], fx=0.35, fy=0.35)
    teeth = "".join(f'<rect x="-2" y="-14" width="4" height="5" rx="1" fill="url(#cg)" transform="translate(40 40) rotate({a})"/>' for a in range(0, 360, 36))
    body = [
        # The handle, turned wood, with a knob.
        '<path d="M35,46 L45,46 L46,80 C46,85 34,85 34,80 Z" fill="url(#wd)"/>',
        '<ellipse cx="40" cy="83" rx="7.5" ry="4.5" fill="url(#wd)"/>',
        '<path d="M37,50 L38,78" stroke="#FFF1D6" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>',
        '<rect x="33" y="58" width="14" height="3" rx="1.5" fill="url(#tr)"/>',
        teeth,
        '<circle cx="40" cy="40" r="10" fill="url(#cg)"/>',
        # The box that swings round, painted, with a gold rim and a star of dots.
        '<rect x="44" y="24" width="40" height="26" rx="6" fill="url(#bx)"/>',
        '<rect x="44" y="24" width="40" height="5" rx="2.5" fill="url(#tr)"/>',
        '<rect x="44" y="45" width="40" height="5" rx="2.5" fill="url(#tr)" opacity="0.9"/>',
        "".join(f'<circle cx="{64 + math.cos(a) * 6:.1f}" cy="{37 + math.sin(a) * 6:.1f}" r="1.6" fill="#FFF6D6"/>' for a in [i * math.pi / 3 for i in range(6)]),
        '<circle cx="64" cy="37" r="2.4" fill="#FFF6D6"/>',
        '<rect x="48" y="30" width="12" height="3" rx="1.5" fill="#FFFFFF" opacity="0.45"/>',
        '<circle cx="40" cy="40" r="3" fill="#8A5A2B"/>',
        '<circle cx="37" cy="37" r="2.6" fill="#FFFFFF" opacity="0.5"/>',
    ]
    art.part(name, 90, 90, (40, 40), "\n".join(body), defs)


# A domino mask, 100 x 56: the brow sweeping up to points at the temples, the eye holes almond-shaped.
MASK = ("M8,14 C20,6 36,10 50,18 C64,10 80,6 92,14 C96,26 92,40 80,46 C68,50 58,44 50,36 "
        "C42,44 32,50 20,46 C8,40 4,26 8,14 Z")
HOLES = ("M22,28 C26,20 36,20 40,27 C36,33 26,34 22,28 Z "
         "M60,27 C64,20 74,20 78,28 C74,34 64,33 60,27 Z")


def mask_body(key, paint, feather=False):
    a, b, c = PAINT[paint]
    defs = (rad(f"{key}m", [(0, a, None), (0.5, b, None), (1, c, None)], cx=0.35, cy=0.3, r=0.8, fx=0.3, fy=0.25)
            + grad(f"{key}g", PAINT["gold"], 0, 1)
            + lin(f"{key}f", [(0, "#FFE3EC", None), (1, "#E0557A", None)], 0, 0, 1, 1))
    out = []
    if feather:
        out.append(f'<path d="M86,16 C92,2 100,-4 106,-6 C102,4 98,12 90,20 Z" fill="url(#{key}f)" transform="translate(-8 6)"/>')
        out.append('<path d="M80,20 C86,10 92,4 97,1" stroke="#FFFFFF" stroke-width="1" fill="none" opacity="0.6"/>')
    out += [
        f'<path d="{MASK} {HOLES}" fill="url(#{key}m)" fill-rule="evenodd"/>',
        # Gold trim round each eye hole, and dots along the brow.
        f'<path d="{HOLES}" fill="none" stroke="url(#{key}g)" stroke-width="2.2"/>',
        "".join(f'<circle cx="{x}" cy="{y}" r="1.5" fill="#FFE27A"/>' for x, y in ((14, 16), (24, 12), (36, 14), (64, 14), (76, 12), (86, 16))),
        '<circle cx="50" cy="24" r="2.6" fill="#FFE27A"/>',
        # Light from the top left.
        '<path d="M12,18 C20,11 32,12 42,17" stroke="#FFFFFF" stroke-width="2.6" fill="none" stroke-linecap="round" opacity="0.5"/>',
    ]
    return defs, "\n".join(out)


def mask(name, paint, feather=False):
    defs, body = mask_body("k", paint, feather)
    art.part(name, 100, 56, (50, 28), body, defs)


def hamantasch():
    """A three-cornered cookie with its filling, 60 x 60 (drops are drawn square)."""
    defs = (rad("dg", [(0, "#FFE7B0", None), (0.6, "#E9B566", None), (1, "#B97B32", None)], cx=0.4, cy=0.35, r=0.7)
            + rad("fl", [(0, "#B06AD8", None), (1, "#5A2A7A", None)], fx=0.35, fy=0.35))
    body = [
        '<path d="M30,6 C34,6 52,40 52,46 C52,50 10,50 8,46 C7,40 26,6 30,6 Z" fill="url(#dg)"/>',
        '<path d="M30,22 C34,26 38,34 38,38 C34,40 26,40 22,38 C22,34 26,26 30,22 Z" fill="url(#fl)"/>',
        '<path d="M30,10 C26,18 20,30 14,42" stroke="#FFF3D0" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.7"/>',
        '<ellipse cx="28" cy="29" rx="2" ry="1.4" fill="#FFFFFF" opacity="0.5"/>',
    ]
    art.part("hamantasch", 60, 60, (30, 30), "\n".join(body), defs)


def masks_garland():
    """
    A 96 x 16 still: three small masks on a ribbon, hung along a card's top
    edge in the 16px gap above it (y = 16 is the edge). Purple, gold, rose.
    """
    defs, out = [], ['<path d="M1,2 Q24,7 48,3 Q72,7 95,2" fill="none" stroke="#F0668F" stroke-width="1"/>']
    for i, (x, paint, turn) in enumerate(((10, "purple", -6), (38, "gold", 4), (66, "rose", -3))):
        d, m = mask_body(f"m{i}", paint, feather=(paint == "purple"))
        defs.append(d)
        out.append(f'<path d="M{x + 10},4 L{x + 10},6" stroke="#F0668F" stroke-width="0.8"/>')
        out.append(f'<g transform="translate({x} 5) scale(0.2) rotate({turn} 50 28)">{m}</g>')
    art.still("masks-garland", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 16" width="96" height="16">\n'
              f'<defs>{"".join(defs)}</defs>\n' + "\n".join(out) + "\n</svg>\n")

noisemaker("noisemaker-purple", "purple", "gold")
noisemaker("noisemaker-teal", "teal", "rose")
mask("mask-purple", "purple", feather=True)
mask("mask-gold", "gold")
mask("mask-rose", "rose")
hamantasch()
masks_garland()
art.finish()

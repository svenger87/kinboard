"""Yalda's art (RFC-020 §3.3): the longest night's fruit -- pomegranates, one
broken open on its ruby seeds, and a slice of watermelon -- resting on a
corner of the cards.

    python3 webapp/scripts/festival-art/yalda.py

No visitor (§3.3): the night is for sitting together, so the fruit is a
still, placed by CSS. Two arrangements, so neighbouring cards differ: the
full one (a slice, a whole pomegranate, an open half and loose seeds) and a
small one (a slice and an open half). Each stands on a ground line a few
units above its bottom edge, where the card's top edge is, with soft contact
shadows; light from the top left; no outlines.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("yalda")

DEFS = (
    # Pomegranate skin: a warm crimson, lit from the top left, a deep wine underneath.
    rad("pomSkin", [(0, "#FF8A8A", None), (0.28, "#E0394A", None), (0.7, "#A8172C", None), (1, "#6A0C1C", None)], cx=0.42, cy=0.4, r=0.62, fx=0.3, fy=0.26)
    + lin("pomCrown", [(0, "#D9475A", None), (1, "#7A1424", None)])
    + rad("pomBlush", [(0, "#FFC07A", 0.55), (1, "#FFC07A", 0)])
    # The open face: the pale pith between the seed chambers.
    + rad("pith", [(0, "#FFF1DC", None), (0.7, "#F6D9B8", None), (1, "#E7B892", None)], fx=0.35, fy=0.3)
    + rad("aril", [(0, "#FFD0D6", None), (0.25, "#FF4D6A", None), (0.75, "#C0122E", None), (1, "#7E0A1E", None)], fx=0.32, fy=0.28)
    # Watermelon: flesh, the white of the rind, the green rind and its stripes.
    + lin("flesh", [(0, "#FF7A86", None), (0.6, "#F0384E", None), (1, "#D9243C", None)], 0, 0, 0.3, 1)
    + lin("whiteRind", [(0, "#F8FFE8", None), (1, "#CFEAB0", None)])
    + lin("rind", [(0, "#6CC46A", None), (0.5, "#2F8C45", None), (1, "#1D5E2E", None)])
    + rad("seed", [(0, "#6B5A50", None), (0.6, "#2A1E1A", None), (1, "#120C0A", None)], fx=0.35, fy=0.3)
    + blur("soft", 1.6)
)


def shadow(cx, ground, rx):
    return f'<ellipse cx="{cx:.1f}" cy="{ground + 0.6:.1f}" rx="{rx:.1f}" ry="{max(1.6, rx * 0.16):.1f}" fill="#1A0710" opacity="0.32" filter="url(#soft)"/>'


def aril(x, y, r, rot=0):
    """One seed: a faceted ruby bead, a white glint on its top left."""
    return (f'<g transform="rotate({rot:.0f} {x:.1f} {y:.1f})"><ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r:.2f}" ry="{r * 1.18:.2f}" fill="url(#aril)"/>'
            f'<ellipse cx="{x - r * 0.35:.1f}" cy="{y - r * 0.45:.1f}" rx="{r * 0.32:.2f}" ry="{r * 0.22:.2f}" fill="#FFFFFF" opacity="0.85"/></g>')


def pomegranate(cx, ground, r, rnd):
    """A whole pomegranate standing on the ground line, its crown on top."""
    cy = ground - r * 0.92
    out = [shadow(cx + r * 0.15, ground, r * 1.05)]
    # A slightly six-sided round, as the fruit is.
    pts = []
    for i in range(36):
        a = i / 36 * 2 * math.pi
        k = 1 + 0.018 * math.cos(6 * a + 0.4)
        pts.append((cx + math.cos(a) * r * k, cy + math.sin(a) * r * 0.96 * k))
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"
    out.append(f'<path d="{d}" fill="url(#pomSkin)"/>')
    # A blush of gold on the lit side, and freckles.
    out.append(f'<ellipse cx="{cx - r * 0.35:.1f}" cy="{cy - r * 0.1:.1f}" rx="{r * 0.5:.1f}" ry="{r * 0.6:.1f}" fill="url(#pomBlush)"/>')
    for _ in range(14):
        a, rr = rnd.uniform(0, 2 * math.pi), r * math.sqrt(rnd.uniform(0.05, 0.8))
        out.append(f'<circle cx="{cx + math.cos(a) * rr:.1f}" cy="{cy + math.sin(a) * rr:.1f}" r="{rnd.uniform(0.25, 0.5):.2f}" fill="#FFD9A8" opacity="{rnd.uniform(0.3, 0.6):.2f}"/>')
    # The crown: a short neck and five sepals, the far ones darker.
    top = cy - r * 0.94
    out.append(f'<path d="M{cx - r * 0.2:.1f},{top + 1.2:.1f} L{cx - r * 0.17:.1f},{top - r * 0.22:.1f} L{cx + r * 0.17:.1f},{top - r * 0.22:.1f} L{cx + r * 0.2:.1f},{top + 1.2:.1f} Z" fill="url(#pomCrown)"/>')
    for i, (dx, h, shade) in enumerate(((-0.3, 0.3, "#8E1A2A"), (0.3, 0.3, "#8E1A2A"), (-0.17, 0.4, "#C83548"), (0.17, 0.4, "#C83548"), (0, 0.44, "#E04A5C"))):
        x0 = cx + dx * r * 0.6
        out.append(f'<path d="M{x0 - r * 0.07:.1f},{top - r * 0.18:.1f} L{x0 + dx * r * 0.5:.1f},{top - r * (0.18 + h):.1f} L{x0 + r * 0.07:.1f},{top - r * 0.18:.1f} Z" fill="{shade}"/>')
    # The shine: a soft window of light, top left.
    out.append(f'<ellipse cx="{cx - r * 0.42:.1f}" cy="{cy - r * 0.45:.1f}" rx="{r * 0.26:.1f}" ry="{r * 0.15:.1f}" fill="#FFFFFF" opacity="0.6" transform="rotate(-35 {cx - r * 0.42:.1f} {cy - r * 0.45:.1f})"/>')
    out.append(f'<circle cx="{cx - r * 0.2:.1f}" cy="{cy - r * 0.62:.1f}" r="{r * 0.07:.2f}" fill="#FFFFFF" opacity="0.8"/>')
    return "".join(out)


def pomegranate_half(cx, ground, r, rnd):
    """A half lying open, its cut face to us: skin behind, pale pith, the chambers full of seeds."""
    cy = ground - r * 0.62
    out = [shadow(cx + r * 0.1, ground, r * 1.15)]
    # The skin's back, seen as a rim behind and below the face.
    out.append(f'<ellipse cx="{cx + r * 0.06:.1f}" cy="{cy + r * 0.12:.1f}" rx="{r * 1.02:.1f}" ry="{r * 0.66:.1f}" fill="url(#pomSkin)"/>')
    out.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{r * 0.92:.1f}" ry="{r * 0.56:.1f}" fill="url(#pith)"/>')
    # The seeds, packed in five chambers between the pith's walls.
    seeds = []
    for c in range(5):
        a0 = c / 5 * 2 * math.pi + 0.3
        for _ in range(9):
            a = a0 + rnd.uniform(0.12, 2 * math.pi / 5 - 0.12)
            rr = math.sqrt(rnd.uniform(0.08, 0.78))
            seeds.append((cx + math.cos(a) * rr * r * 0.82, cy + math.sin(a) * rr * r * 0.48, rnd.uniform(0, 360)))
    seeds.sort(key=lambda s: s[1])  # back to front
    for x, y, rot in seeds:
        out.append(aril(x, y, r * 0.11, rot))
    # The lip of the skin, catching the light along its top.
    out.append(f'<path d="M{cx - r * 0.92:.1f},{cy:.1f} A{r * 0.92:.1f},{r * 0.56:.1f} 0 0 1 {cx + r * 0.92:.1f},{cy:.1f}" fill="none" stroke="#FFB0B8" stroke-width="{r * 0.06:.2f}" opacity="0.55"/>')
    return "".join(out)


def watermelon_slice(x0, ground, w, rnd):
    """A slice of watermelon standing on its rind: a sector of the round fruit,
    its point up, its rind's arc on the ground."""
    half = math.radians(36)  # half the slice's angle
    R = w / 2 / math.sin(half)
    cx, top = x0 + w / 2, ground - R
    out = [shadow(cx + w * 0.04, ground, w * 0.5)]

    def sector(r, fill, extra=""):
        a0, a1 = math.pi / 2 + half, math.pi / 2 - half
        return (f'<path d="M{cx:.1f},{top + (R - r) * 0.0:.1f} L{cx + math.cos(a0) * r:.1f},{top + math.sin(a0) * r:.1f} '
                f'A{r:.1f},{r:.1f} 0 0 0 {cx + math.cos(a1) * r:.1f},{top + math.sin(a1) * r:.1f} Z" fill="{fill}"{extra}/>')
    out.append(sector(R, "url(#rind)"))
    # The rind's dark stripes, running round it.
    for i in range(7):
        a = math.pi / 2 + half - (i + 0.5) / 7 * 2 * half
        x1, y1 = cx + math.cos(a) * R * 0.93, top + math.sin(a) * R * 0.93
        x2, y2 = cx + math.cos(a + 0.05) * R * 0.995, top + math.sin(a + 0.05) * R * 0.995
        out.append(f'<path d="M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}" stroke="#174A24" stroke-width="{w * 0.05:.1f}" opacity="0.5" stroke-linecap="round"/>')
    out.append(sector(R * 0.92, "url(#whiteRind)"))
    out.append(sector(R * 0.85, "url(#flesh)"))
    # The flesh's grain, pale streaks from the point.
    for i in range(5):
        a = math.pi / 2 + (i - 2) / 2.5 * half * 0.75
        out.append(f'<path d="M{cx:.1f},{top + R * 0.12:.1f} L{cx + math.cos(a) * R * 0.78:.1f},{top + math.sin(a) * R * 0.78:.1f}" stroke="#FFC2C8" stroke-width="0.6" opacity="0.45"/>')
    # Seeds, teardrops pointing at the point, each with a glint.
    for _ in range(8):
        a = math.pi / 2 + rnd.uniform(-0.75, 0.75) * half
        rr = R * rnd.uniform(0.38, 0.7)
        sx, sy = cx + math.cos(a) * rr, top + math.sin(a) * rr
        ang = math.degrees(a) - 90
        out.append(f'<g transform="rotate({ang:.0f} {sx:.1f} {sy:.1f})"><path d="M{sx:.1f},{sy - 1.9:.1f} C{sx + 1.3:.1f},{sy - 0.5:.1f} {sx + 1.1:.1f},{sy + 1.5:.1f} {sx:.1f},{sy + 1.6:.1f} C{sx - 1.1:.1f},{sy + 1.5:.1f} {sx - 1.3:.1f},{sy - 0.5:.1f} {sx:.1f},{sy - 1.9:.1f} Z" fill="url(#seed)"/>'
                   f'<circle cx="{sx - 0.4:.1f}" cy="{sy - 0.5:.1f}" r="0.35" fill="#FFFFFF" opacity="0.7"/></g>')
    # Juice glinting along the left cut edge, where the light falls.
    a = math.pi / 2 + half
    out.append(f'<path d="M{cx - 0.6:.1f},{top + 3:.1f} L{cx + math.cos(a) * R * 0.8:.1f},{top + math.sin(a) * R * 0.8 - 0.6:.1f}" stroke="#FFFFFF" stroke-width="1.2" opacity="0.55" stroke-linecap="round"/>')
    return "".join(out)


def still(name, W, H, body):
    art.still(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n<defs>{DEFS}</defs>\n{body}\n</svg>\n')


# The full arrangement, 120 x 42, on a ground line at y = 40 (the card's
# top edge is the drawing's bottom, so nothing of it reaches into the card): the slice at
# the back left, the whole pomegranate, the open half in front, loose seeds.
rnd = random.Random(20)
GROUND = 40
still("fruit", 120, 42, "\n".join([
    watermelon_slice(4, GROUND, 40, rnd),
    pomegranate(66, GROUND, 15, rnd),
    pomegranate_half(98, GROUND + 1, 14, rnd),
    aril(46, GROUND - 0.5, 1.7, 20), aril(50.5, GROUND + 0.2, 1.5, -30), aril(80, GROUND + 0.6, 1.6, 10), aril(84, GROUND - 0.2, 1.4, 40),
]))

# The small one, 76 x 42: a slice and an open half.
rnd = random.Random(21)
still("fruit-small", 76, 42, "\n".join([
    watermelon_slice(4, GROUND, 34, rnd),
    pomegranate_half(56, GROUND + 1, 14, rnd),
    aril(39, GROUND, 1.6, 15), aril(42.5, GROUND + 0.4, 1.4, -20),
]))

art.finish()

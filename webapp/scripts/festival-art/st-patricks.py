"""St Patrick's Day's art (RFC-020 §3.3): the rainbow that arcs over the
widgets, with a cloud at its left foot and a pot of gold at its right; the
sparkle that rides its leading edge; the coins and shamrocks a tap drops;
and the shamrock sprigs at the cards' corners.

    python3 webapp/scripts/festival-art/st-patricks.py

The bow is one part, drawn as the whole upper half of a circle with its
pivot at the circle's centre (the bottom middle of the drawing): the `arc`
archetype scales it to the bow's width on the screen and reveals it from
the left foot, clockwise, as a wedge from that centre, so nothing may hang
below the centre's line (the wedge never reaches there).
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("st-patricks")

# Shamrock greens, lit from the top left, and the gold of the coins.
LEAF, LEAF_LIGHT, LEAF_DARK = "#3FBF6A", "#8FE3A4", "#1F7F45"
GOLD_LIGHT, GOLD, GOLD_DARK = "#FFF0A8", "#F2C23A", "#A8741A"


def annulus(cx, cy, r_out, r_in):
    """The upper half of a ring, from the left foot over the top to the right."""
    return (f"M{cx - r_out:.1f},{cy:.1f} A{r_out:.1f},{r_out:.1f} 0 0 1 {cx + r_out:.1f},{cy:.1f} "
            f"L{cx + r_in:.1f},{cy:.1f} A{r_in:.1f},{r_in:.1f} 0 0 0 {cx - r_in:.1f},{cy:.1f} Z")


def half_circle(cx, cy, r):
    return f"M{cx - r:.1f},{cy:.1f} A{r:.1f},{r:.1f} 0 0 1 {cx + r:.1f},{cy:.1f}"


def cloud(cx, base, w, uid, rnd):
    """A soft heap of round puffs resting just above `base` (nothing below it: the reveal's wedge never reaches there), lit from the top left."""
    puffs = []
    n = 6
    for i in range(n):
        u = i / (n - 1)
        x = cx - w / 2 + w * (0.12 + 0.76 * u)
        r = w * (0.11 + 0.08 * math.sin(math.pi * u)) * rnd.uniform(0.92, 1.06)
        # Its bottom a few units above the line, the middle ones riding higher.
        y = base - r - 3 - w * 0.03 * math.sin(math.pi * u)
        puffs.append((x, y, r))
    # The big puffs on top.
    puffs.append((cx - w * 0.1, base - w * 0.31, w * 0.19))
    puffs.append((cx + w * 0.12, base - w * 0.27, w * 0.16))
    defs = rad(f"{uid}Puff", [(0, "#FFFFFF", None), (0.6, "#F7FAFF", None), (1, "#D9E4F2", None)], cx=0.38, cy=0.32, r=0.75)
    body = []
    for x, y, r in sorted(puffs, key=lambda p: p[1], reverse=True):
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="url(#{uid}Puff)"/>')
    # A cool shade along the underside, between the puffs.
    body.append(f'<path d="M{cx - w * 0.36:.1f},{base - w * 0.07:.1f} Q{cx:.1f},{base - w * 0.01:.1f} {cx + w * 0.36:.1f},{base - w * 0.07:.1f}" stroke="#B9C9E0" stroke-width="{w * 0.05:.1f}" fill="none" stroke-linecap="round" opacity="0.55" filter="url(#soft)"/>')
    # Highlights on the upper-left of the top puffs.
    for x, y, r in puffs[-2:] + puffs[1:3]:
        body.append(f'<ellipse cx="{x - r * 0.3:.1f}" cy="{y - r * 0.38:.1f}" rx="{r * 0.42:.1f}" ry="{r * 0.24:.1f}" fill="#FFFFFF" opacity="0.8" transform="rotate(-25 {x - r * 0.3:.1f} {y - r * 0.38:.1f})"/>')
    return defs, "".join(body)


def coin_disc(cx, cy, r, uid, tilt=0.0):
    """A gold coin seen from the front, a little turned (`tilt` squashes it), with a raised rim and an embossed shamrock."""
    ry = r * (1 - tilt)
    leaf = "".join(
        f'<circle cx="{cx + math.cos(a) * r * 0.2:.2f}" cy="{cy - r * 0.05 + math.sin(a) * ry * 0.2:.2f}" r="{r * 0.17:.2f}" fill="{GOLD_DARK}" opacity="0.55"/>'
        for a in (-math.pi / 2, -math.pi / 2 + 2.1, -math.pi / 2 - 2.1))
    return (f'<ellipse cx="{cx}" cy="{cy + r * 0.08:.2f}" rx="{r}" ry="{ry}" fill="{GOLD_DARK}"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{r}" ry="{ry}" fill="url(#{uid})"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 0.78:.2f}" ry="{ry * 0.78:.2f}" fill="none" stroke="{GOLD_DARK}" stroke-width="{r * 0.07:.2f}" opacity="0.45"/>'
            + leaf +
            f'<path d="M{cx:.2f},{cy + ry * 0.05:.2f} L{cx + r * 0.08:.2f},{cy + ry * 0.45:.2f}" stroke="{GOLD_DARK}" stroke-width="{r * 0.07:.2f}" stroke-linecap="round" opacity="0.55"/>'
            f'<ellipse cx="{cx - r * 0.38:.2f}" cy="{cy - ry * 0.42:.2f}" rx="{r * 0.3:.2f}" ry="{ry * 0.16:.2f}" fill="#FFFFFF" opacity="0.7" transform="rotate(-30 {cx - r * 0.38:.2f} {cy - ry * 0.42:.2f})"/>')


def shamrock(cx, cy, r, turn, uid, stem=True):
    """Three heart-shaped leaves round a centre, `r` to their tips, a curling stem; lit from the top left."""
    out = []
    if stem:
        a = math.radians(turn + 90)
        ex, ey = cx + math.cos(a) * r * 1.5, cy + math.sin(a) * r * 1.5
        out.append(f'<path d="M{cx:.2f},{cy:.2f} Q{cx + math.cos(a - 0.5) * r:.2f},{cy + math.sin(a - 0.5) * r:.2f} {ex:.2f},{ey:.2f}" '
                   f'stroke="{LEAF_DARK}" stroke-width="{r * 0.16:.2f}" fill="none" stroke-linecap="round"/>')
    for k in range(3):
        a = turn - 90 + k * 120
        # A heart: two lobes meeting at the centre, the cleft at the tip.
        heart = (f"M0,0 C{-r * 0.62:.2f},{-r * 0.12:.2f} {-r * 0.78:.2f},{-r * 0.86:.2f} {-r * 0.3:.2f},{-r * 0.98:.2f} "
                 f"C{-r * 0.12:.2f},{-r * 1.02:.2f} {-r * 0.02:.2f},{-r * 0.9:.2f} 0,{-r * 0.78:.2f} "
                 f"C{r * 0.02:.2f},{-r * 0.9:.2f} {r * 0.12:.2f},{-r * 1.02:.2f} {r * 0.3:.2f},{-r * 0.98:.2f} "
                 f"C{r * 0.78:.2f},{-r * 0.86:.2f} {r * 0.62:.2f},{-r * 0.12:.2f} 0,0 Z")
        out.append(f'<g transform="translate({cx:.2f} {cy:.2f}) rotate({a + 90:.1f})">'
                   f'<path d="{heart}" fill="url(#{uid})"/>'
                   f'<path d="M0,{-r * 0.12:.2f} L0,{-r * 0.7:.2f}" stroke="{LEAF_DARK}" stroke-width="{r * 0.05:.2f}" opacity="0.35" stroke-linecap="round"/>'
                   "</g>")
    # The light catches the upper-left leaf.
    out.append(f'<ellipse cx="{cx - r * 0.42:.2f}" cy="{cy - r * 0.45:.2f}" rx="{r * 0.2:.2f}" ry="{r * 0.11:.2f}" fill="#FFFFFF" opacity="0.5" transform="rotate(-35 {cx - r * 0.42:.2f} {cy - r * 0.45:.2f})"/>')
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r * 0.09:.2f}" fill="{LEAF_DARK}" opacity="0.6"/>')
    return "".join(out)


def leaf_gradient(uid):
    return rad(uid, [(0, LEAF_LIGHT, None), (0.55, LEAF, None), (1, LEAF_DARK, None)], cx=0.35, cy=0.3, r=0.8)


# ---------------------------------------------------------------- the visitor: the rainbow
W, H = 1800, 880
CX, CY = W / 2, H          # the pivot: the circle's centre, on the feet's line
R_OUT, R_IN = 830, 662     # the sparkles ride 0.85-0.97 of the half-width (765-873): over the outer bands
BANDS = [("#FF6B6B", "#E04848"), ("#FFA94D", "#E8822A"), ("#FFE066", "#E8C23A"),
         ("#5FD38A", "#2FA65E"), ("#5AB0FF", "#2F7FD9"), ("#A98BFF", "#7A5BE0")]


def rainbow():
    rnd = random.Random(17)
    step = (R_OUT - R_IN) / len(BANDS)
    defs = [blur("soft", 6), blur("haze", 18), blur("seam", 2.2)]
    for i, (c1, c2) in enumerate(BANDS):
        # Each band a little lighter on its outer edge, deeper on its inner: rounded, like a ribbon.
        r_o = R_OUT - i * step
        r_i = r_o - step
        o = r_i / r_o
        defs.append(f'<radialGradient id="b{i}" cx="{CX}" cy="{CY}" r="{r_o:.1f}" gradientUnits="userSpaceOnUse">'
                    f'<stop offset="{o:.4f}" stop-color="{c2}"/><stop offset="{(o + 1) / 2:.4f}" stop-color="{c1}"/>'
                    f'<stop offset="1" stop-color="{c1}"/></radialGradient>')
    # Light from the top left: stronger on the left limb and the top, fading to the right.
    defs.append(lin("sun", [(0, "#FFFFFF", 0.55), (0.45, "#FFFFFF", 0.22), (1, "#FFFFFF", 0)], 0, 0, 1, 0.4))
    defs.append(lin("shade", [(0, "#2A1E5C", 0), (0.6, "#2A1E5C", 0.12), (1, "#2A1E5C", 0.28)], 0, 0, 1, 0))
    defs.append(rad("gold", [(0, GOLD_LIGHT, None), (0.5, GOLD, None), (1, GOLD_DARK, None)], cx=0.35, cy=0.3, r=0.75))
    defs.append(rad("pot", [(0, "#5A5F6E", None), (0.45, "#2B2E38", None), (1, "#121318", None)], cx=0.35, cy=0.3, r=0.8))
    defs.append(lin("potRim", [(0, "#6B7080", None), (1, "#24262E", None)]))
    defs.append(rad("glint", [(0, "#FFFFFF", 0.95), (0.35, GOLD_LIGHT, 0.6), (1, GOLD_LIGHT, 0)]))

    # The bow fades out into the clouds at its feet, rather than meeting the line.
    defs.append(f'<linearGradient id="feetFade" gradientUnits="userSpaceOnUse" x1="0" y1="{CY - 90}" x2="0" y2="{CY - 14}">'
                '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#000000"/></linearGradient>'
                f'<mask id="feet" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="url(#feetFade)"/></mask>')
    body = [
        '<g mask="url(#feet)">',
        # A soft glow behind the bow, drawn in.
        f'<path d="{annulus(CX, CY, R_OUT + 22, R_IN - 22)}" fill="#FFFFFF" opacity="0.22" filter="url(#haze)"/>',
    ]
    for i in range(len(BANDS)):
        r_o = R_OUT - i * step
        # A hair wider than its step, so the seams between bands never show the sky.
        body.append(f'<path d="{annulus(CX, CY, r_o + 0.6, r_o - step - 0.6)}" fill="url(#b{i})"/>')
    # Soft seams between the bands, as watercolour.
    for i in range(1, len(BANDS)):
        r = R_OUT - i * step
        body.append(f'<path d="{half_circle(CX, CY, r)}" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.18" filter="url(#seam)"/>')
    body += [
        # Shade on the right limb (away from the light), the sun's sheen on the left and the top.
        f'<path d="{annulus(CX, CY, R_OUT, R_IN)}" fill="url(#shade)"/>',
        f'<path d="{annulus(CX, CY, R_OUT, R_IN)}" fill="url(#sun)"/>',
        # A highlight along the outer edge, strongest at the upper left.
        f'<path d="M{CX - R_OUT + 14:.1f},{CY - 40:.1f} A{R_OUT - 14},{R_OUT - 14} 0 0 1 {CX + 120:.1f},{CY - R_OUT + 22:.1f}" '
        'stroke="#FFFFFF" stroke-width="9" fill="none" opacity="0.35" stroke-linecap="round" filter="url(#seam)"/>',
        f'<path d="M{CX - R_OUT + 30:.1f},{CY - 160:.1f} A{R_OUT - 22},{R_OUT - 22} 0 0 1 {CX - 260:.1f},{CY - R_OUT + 70:.1f}" '
        'stroke="#FFFFFF" stroke-width="5" fill="none" opacity="0.5" stroke-linecap="round"/>',
        # A darker line under the inner (violet) edge: the bow has thickness.
        f'<path d="{half_circle(CX, CY, R_IN + 3)}" stroke="#4B2E9E" stroke-width="5" fill="none" opacity="0.25" filter="url(#seam)"/>',
    ]
    # A few glints in the bands.
    for _ in range(9):
        a = math.pi + rnd.uniform(0.12, 0.88) * math.pi
        r = rnd.uniform(R_IN + 20, R_OUT - 20)
        x, y = CX + math.cos(a) * r, CY + math.sin(a) * r
        s = rnd.uniform(9, 16)
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{s * 1.6:.1f}" fill="url(#glint)" opacity="0.7"/>'
                    f'<path d="M{x:.1f},{y - s:.1f} L{x + s * 0.18:.1f},{y - s * 0.18:.1f} L{x + s:.1f},{y:.1f} L{x + s * 0.18:.1f},{y + s * 0.18:.1f} '
                    f'L{x:.1f},{y + s:.1f} L{x - s * 0.18:.1f},{y + s * 0.18:.1f} L{x - s:.1f},{y:.1f} L{x - s * 0.18:.1f},{y - s * 0.18:.1f} Z" fill="#FFFFFF" opacity="0.85"/>')

    body.append("</g>")

    # The left foot in a cloud.
    foot = (R_OUT + R_IN) / 2
    d, b = cloud(CX - foot, CY, 300, "cl", rnd)
    defs.append(d)
    body.append(b)

    # The right foot: a pot of gold, a cloud behind it.
    px = CX + foot
    d, b = cloud(px + 30, CY, 330, "cr", rnd)
    defs.append(d)
    body.append(b)
    top = CY - 120
    body += [
        f'<ellipse cx="{px:.1f}" cy="{CY - 12:.1f}" rx="86" ry="7" fill="#1B1D24" opacity="0.3" filter="url(#soft)"/>',
        # Its three feet, the round belly, the rim.
        f'<path d="M{px - 58:.1f},{CY - 30:.1f} l-8,26 l18,0 Z M{px + 58:.1f},{CY - 30:.1f} l8,26 l-18,0 Z" fill="#1B1D24"/>',
        f'<path d="M{px - 86:.1f},{top + 18:.1f} C{px - 100:.1f},{CY - 40:.1f} {px - 60:.1f},{CY - 14:.1f} {px:.1f},{CY - 14:.1f} '
        f'C{px + 60:.1f},{CY - 14:.1f} {px + 100:.1f},{CY - 40:.1f} {px + 86:.1f},{top + 18:.1f} Z" fill="url(#pot)"/>',
    ]
    # The heap of coins in the pot.
    heap = []
    for _ in range(26):
        x = px + rnd.uniform(-74, 74)
        y = top + 8 - (1 - ((x - px) / 80) ** 2) * rnd.uniform(16, 40)
        heap.append((y, x))
    for y, x in sorted(heap):
        heap_r = rnd.uniform(13, 17)
        body.append(coin_disc(round(x, 1), round(y, 1), round(heap_r, 1), "gold", tilt=rnd.uniform(0.35, 0.6)))
    body += [
        f'<rect x="{px - 96:.1f}" y="{top + 6:.1f}" width="192" height="22" rx="11" fill="url(#potRim)"/>',
        f'<path d="M{px - 84:.1f},{top + 12:.1f} L{px + 40:.1f},{top + 12:.1f}" stroke="#FFFFFF" stroke-width="3" opacity="0.3" stroke-linecap="round"/>',
        f'<ellipse cx="{px - 46:.1f}" cy="{CY - 70:.1f}" rx="22" ry="12" fill="#FFFFFF" opacity="0.16" transform="rotate(-30 {px - 46:.1f} {CY - 70:.1f})"/>',
        # The pot's glow, where the bow comes down into it.
        f'<circle cx="{px:.1f}" cy="{top - 10:.1f}" r="70" fill="url(#glint)" opacity="0.55"/>',
    ]
    art.part("rainbow", W, H, (CX, CY), "\n".join(body), "".join(defs),
             "the whole bow; pivot at the circle's centre on the feet's line. Nothing below it: the reveal's wedge never reaches there")


def sparkle():
    """A four-pointed glint in the bow's colours, its glow drawn in."""
    S = 48
    defs = rad("g", [(0, "#FFFFFF", 0.95), (0.3, "#FFF3B0", 0.6), (1, "#FFF3B0", 0)])
    c = S / 2
    star = (f"M{c},{c - 20} C{c + 2},{c - 5} {c + 5},{c - 2} {c + 20},{c} C{c + 5},{c + 2} {c + 2},{c + 5} {c},{c + 20} "
            f"C{c - 2},{c + 5} {c - 5},{c + 2} {c - 20},{c} C{c - 5},{c - 2} {c - 2},{c - 5} {c},{c - 20} Z")
    body = (f'<circle cx="{c}" cy="{c}" r="{c}" fill="url(#g)"/>'
            f'<path d="{star}" fill="#FFFFFF"/>'
            f'<path d="{star}" fill="#FFE27A" opacity="0.35" transform="rotate(45 {c} {c}) scale(0.6) translate({c * 0.666:.1f} {c * 0.666:.1f})"/>')
    art.part("sparkle", S, S, (c, c), body, defs, "rides the leading edge as the bow is drawn")


def coin():
    """A gold coin, turned a little: dropped by a tap."""
    S = 40
    defs = rad("gold", [(0, GOLD_LIGHT, None), (0.5, GOLD, None), (1, GOLD_DARK, None)], cx=0.35, cy=0.3, r=0.75)
    art.part("coin", S, S, (S / 2, S / 2), coin_disc(20, 19, 16, "gold", tilt=0.12), defs, "dropped by a tap")


def shamrock_drop():
    S = 40
    art.part("shamrock", S, S, (S / 2, S / 2), shamrock(20, 18, 15, -10, "lf"), leaf_gradient("lf"), "dropped by a tap")


# ---------------------------------------------------------------- the dressing: shamrocks at the corners
def shamrocks_top():
    """56 x 26: a big shamrock at the card's top-left corner, two smaller along the top edge.

    The kit hangs it wholly outside the card, in the grid's gap, ending at
    the card's edge (a card's content can start at its very first pixel),
    so the whole drawing may be seen; CSS draws it at 44 x 20 px, above the corner.
    """
    Wc, Hc = 56, 26
    body = [
        '<ellipse cx="22" cy="23.5" rx="18" ry="2" fill="#0F3B22" opacity="0.18"/>',
        shamrock(44, 16.5, 6.5, 18, "lf"),
        shamrock(31, 14, 7.5, -12, "lf"),
        shamrock(13, 12, 10.5, -4, "lf", stem=False),
        f'<path d="M14,15 Q17,22 25,24.5" stroke="{LEAF_DARK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    ]
    art.still("shamrocks-top", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wc} {Hc}" width="{Wc}" height="{Hc}">\n'
                                f"<defs>{leaf_gradient('lf')}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


def shamrocks_bottom():
    """56 x 26: a sprig standing upright in the gap under a card's bottom-right corner.

    The kit hangs it wholly outside the card, in the grid's gap, ending at
    the card's edge (a card's content can start at its very first pixel),
    so the whole drawing may be seen; CSS draws it at 44 x 20 px, below the corner.
    """
    Wc, Hc = 56, 26
    body = [
        '<ellipse cx="30" cy="23" rx="20" ry="2" fill="#0F3B22" opacity="0.18"/>',
        f'<path d="M20,22 Q22,16 18,10 M32,22 Q34,14 31,8 M43,22 Q42,17 45,12" stroke="{LEAF_DARK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
        shamrock(18, 9.5, 6.5, -14, "lf", stem=False),
        shamrock(45, 11, 7.5, 12, "lf", stem=False),
        shamrock(31, 8, 8.2, 0, "lf", stem=False),
        # A coin fallen in the clover.
        coin_disc(8, 20, 4.6, "gold", tilt=0.45),
    ]
    defs = leaf_gradient("lf") + rad("gold", [(0, GOLD_LIGHT, None), (0.5, GOLD, None), (1, GOLD_DARK, None)], cx=0.35, cy=0.3, r=0.75)
    art.still("shamrocks-bottom", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wc} {Hc}" width="{Wc}" height="{Hc}">\n'
                                   f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


rainbow(); sparkle(); coin(); shamrock_drop()
shamrocks_top(); shamrocks_bottom()
art.finish()

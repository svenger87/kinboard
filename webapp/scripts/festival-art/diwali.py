"""Diwali's art (RFC-020 §3.3): diyas, little clay lamps, alight on the cards'
top edges, and marigold garlands swagged under them.

    python3 webapp/scripts/festival-art/diwali.py

The sky lanterns that rise are Mid-Autumn's parts (the kit borrows that
folder, `art: "mid-autumn"`); the marigolds are _marigold.py's, shared with
Día de Muertos. Lights, flowers and colour: festive, never devotional (§7).
The marigold garland the creatures wear is drawn in the kit.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur
from _marigold import marigold, MARIGOLD, YELLOW

art = Art("diwali")


def diya(uid, cx, base, w):
    """A clay lamp `w` wide standing at (cx, base): a terracotta bowl with painted dots and a spout, its flame and glow drawn in."""
    h = w * 0.36
    defs = (lin(f"{uid}c", [(0, "#E8925A", None), (0.5, "#C2552A", None), (1, "#7A2E12", None)]) +
            rad(f"{uid}o", [(0, "#FFE9A8", None), (1, "#E0A030", None)]) +
            rad(f"{uid}g", [(0, "#FFD27A", 0.6), (0.4, "#FF9A1F", 0.18), (1, "#FF9A1F", 0)]) +
            rad(f"{uid}f", [(0, "#FFFFFF", None), (0.35, "#FFF0A0", None), (0.75, "#FFB02E", None), (1, "#FF6A1F", None)], cx=0.5, cy=0.7, fx=0.5, fy=0.8))
    x0, x1 = cx - w / 2, cx + w / 2
    top = base - h
    fx, fy = cx + w * 0.34, top + h * 0.1  # the wick, at the spout
    out = [
        f'<circle cx="{fx:.1f}" cy="{fy - h * 0.6:.1f}" r="{w * 0.4:.1f}" fill="url(#{uid}g)"/>',
        # the bowl, rising to a pinched spout on the right
        f'<path d="M{x0:.1f},{top:.1f} C{x0 + w * 0.05:.1f},{base:.1f} {x1 - w * 0.2:.1f},{base + h * 0.05:.1f} {x1 - w * 0.12:.1f},{top + h * 0.35:.1f} '
        f'L{x1:.1f},{top - h * 0.1:.1f} L{x1 - w * 0.2:.1f},{top + h * 0.05:.1f} Z" fill="url(#{uid}c)"/>',
        f'<ellipse cx="{cx - w * 0.06:.1f}" cy="{top + h * 0.04:.1f}" rx="{w * 0.44:.1f}" ry="{h * 0.2:.1f}" fill="url(#{uid}o)"/>',
        f'<ellipse cx="{cx - w * 0.06:.1f}" cy="{top - h * 0.02:.1f}" rx="{w * 0.44:.1f}" ry="{h * 0.12:.1f}" fill="none" stroke="#E8925A" stroke-width="{w * 0.03:.1f}"/>',
    ]
    # painted dots and a band
    for i in range(5):
        x = x0 + w * (0.18 + i * 0.13)
        out.append(f'<circle cx="{x:.1f}" cy="{top + h * 0.5:.1f}" r="{w * 0.028:.1f}" fill="{"#FFD24A" if i % 2 else "#FFFFFF"}" opacity="0.9"/>')
    out.append(f'<path d="M{x0 + w * 0.1:.1f},{top + h * 0.3:.1f} Q{cx:.1f},{top + h * 0.42:.1f} {x1 - w * 0.2:.1f},{top + h * 0.3:.1f}" stroke="#FFD24A" stroke-width="{w * 0.02:.1f}" fill="none" opacity="0.7"/>')
    out.append(f'<ellipse cx="{x0 + w * 0.22:.1f}" cy="{top + h * 0.45:.1f}" rx="{w * 0.08:.1f}" ry="{h * 0.14:.1f}" fill="#FFFFFF" opacity="0.25"/>')
    # the flame
    fh = w * 0.42
    out.append(f'<path d="M{fx:.1f},{fy - fh:.1f} C{fx + w * 0.1:.1f},{fy - fh * 0.5:.1f} {fx + w * 0.1:.1f},{fy:.1f} {fx:.1f},{fy:.1f} '
               f'C{fx - w * 0.1:.1f},{fy:.1f} {fx - w * 0.1:.1f},{fy - fh * 0.5:.1f} {fx:.1f},{fy - fh:.1f} Z" fill="url(#{uid}f)"/>')
    out.append(f'<ellipse cx="{fx:.1f}" cy="{fy - fh * 0.25:.1f}" rx="{w * 0.025:.1f}" ry="{fh * 0.18:.1f}" fill="#FFFFFF" opacity="0.9"/>')
    return defs, "".join(out)


def diyas():
    """140 x 44 units (70 x 22 px): three lamps standing on a card's top edge, at y = 40."""
    defs, body = "", ['<defs><filter id="ds" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>']
    for i, (cx, w) in enumerate(((26, 40), (70, 46), (114, 40))):
        body.append(f'<ellipse cx="{cx - 2}" cy="38" rx="{w * 0.36}" ry="2" fill="#2A120A" opacity="0.35" filter="url(#ds)"/>')
        d, b = diya(f"d{i}", cx, 40, w)
        defs += d
        body.append(b)
    art.still("diyas", ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 44" width="70" height="22">\n'
                        f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


def garland():
    """240 x 48 units (120 x 24 px), hung from a card's bottom edge at y = 3: two swags of marigolds, a strand hanging where they meet and at each end."""
    W, H = 240, 48
    defs, body = "", []
    rnd = random.Random(9)

    def swag(x0, x1, sag, t):
        return ((1 - t) * x0 + t * x1, 4 + 4 * sag * t * (1 - t))

    heads = []
    for x0, x1 in ((6, 120), (120, 234)):
        for k in range(9):
            t = (k + 0.5) / 9
            heads.append(swag(x0, x1, 26, t))
    strands = [(6, 4), (120, 4), (234, 4)]
    # Green leaves along the string, under the flowers.
    for i, (x, y) in enumerate(heads[::2]):
        a = rnd.uniform(-40, 40)
        body.append(f'<ellipse cx="{x + 3:.1f}" cy="{y + 5:.1f}" rx="5" ry="2" fill="#3FA877" transform="rotate({a + 30:.0f} {x + 3:.1f} {y + 5:.1f})"/>')
    for i, (x, y) in enumerate(heads):
        d, b = marigold(f"h{i}", round(x, 1), round(y, 1), 6.4, seed=i, colours=MARIGOLD if i % 2 else YELLOW)
        defs += d
        body.append(b)
    # Hanging strands: three flowers down, a little tassel of leaves.
    for j, (x, y) in enumerate(strands):
        for k in range(3):
            d, b = marigold(f"s{j}{k}", x, y + 11 + k * 10, 5.4 - k * 0.4, seed=50 + j * 3 + k, colours=YELLOW if (j + k) % 2 else MARIGOLD)
            defs += d
            body.append(b)
        # A pair of leaves under the last flower.
        body.append(f'<ellipse cx="{x - 2.4}" cy="{y + 40.5}" rx="1.8" ry="4" fill="#3FA877" transform="rotate(20 {x - 2.4} {y + 40.5})"/>'
                    f'<ellipse cx="{x + 2.4}" cy="{y + 40.5}" rx="1.8" ry="4" fill="#2E8A5E" transform="rotate(-20 {x + 2.4} {y + 40.5})"/>')
    art.still("marigold-garland", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 2}" height="{H // 2}">\n'
                                   f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


diyas()
garland()
art.finish()

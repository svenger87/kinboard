"""Three Kings' art (RFC-020 §3.3): three crowns parading along the bottom of
the screen, each carried on a velvet cushion with tassels; the sweets a tap
throws, as the cabalgata's floats throw them to the children; and the ring
cake, the roscón, in a corner of the cards.

    python3 webapp/scripts/festival-art/three-kings.py

Festive, not devotional (§7): crowns, velvet, gold and gems, cake and sweets;
no figures, no star, no cross on a crown. Light from the top left, no
outlines, glows and glints drawn in.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("three-kings")

GOLD = lin("gold", [(0, "#FFF4B8", None), (0.35, "#F7CD48", None), (0.75, "#D49A1E", None), (1, "#9C6510", None)])
GOLD_SIDE = lin("goldSide", [(0, "#B87A14", None), (0.4, "#F7CD48", None), (0.6, "#FFE68A", None), (1, "#A86E12", None)], 0, 0, 1, 0)
PEARL = rad("pearl", [(0, "#FFFFFF", None), (0.55, "#F1ECF6", None), (1, "#B9AFC9", None)], fx=0.35, fy=0.3)


def gem(id_, light, mid, dark):
    return rad(id_, [(0, light, None), (0.45, mid, None), (1, dark, None)], fx=0.32, fy=0.28)


GEMS = (gem("ruby", "#FFC2CC", "#E8243F", "#7A0A1E") + gem("sapphire", "#CFE4FF", "#2F6BE0", "#13306E") +
        gem("emerald", "#C9F7DA", "#1FA968", "#0B5232") + gem("amethyst", "#EBD5FF", "#9A4FE0", "#4A1C78"))


def stone(x, y, r, kind, oval=1.0):
    """A cabochon in a gold setting, with its glint."""
    return (f'<ellipse cx="{x:.1f}" cy="{y + 0.6:.1f}" rx="{r * 1.28:.1f}" ry="{r * 1.28 * oval:.1f}" fill="#8E5C0E" opacity="0.55"/>'
            f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r * 1.2:.1f}" ry="{r * 1.2 * oval:.1f}" fill="url(#goldSide)"/>'
            f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r:.1f}" ry="{r * oval:.1f}" fill="url(#{kind})"/>'
            f'<ellipse cx="{x - r * 0.35:.1f}" cy="{y - r * 0.4 * oval:.1f}" rx="{r * 0.32:.1f}" ry="{r * 0.2:.1f}" fill="#FFFFFF" opacity="0.9"/>')


def pearl(x, y, r):
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="url(#pearl)"/><circle cx="{x - r * 0.35:.1f}" cy="{y - r * 0.38:.1f}" r="{r * 0.28:.1f}" fill="#FFFFFF"/>'


def cushion(cx, top, w, h, light, mid, dark, rnd):
    """A plump velvet cushion, seen a little from above, a tassel at each front corner."""
    id_ = f"velvet{mid[1:]}"
    defs = rad(id_, [(0, light, None), (0.55, mid, None), (1, dark, None)], cx=0.4, cy=0.35, r=0.75, fx=0.3, fy=0.25)
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, top, top + h
    body = [
        f'<ellipse cx="{cx + 3:.1f}" cy="{y1 + 1:.1f}" rx="{w * 0.5:.1f}" ry="4" fill="#120818" opacity="0.28" filter="url(#soft)"/>',
        # Puffed: the corners pinched, the sides bulging.
        f'<path d="M{x0 + 4:.1f},{y0 + 4:.1f} Q{cx:.1f},{y0 - 5:.1f} {x1 - 4:.1f},{y0 + 4:.1f} Q{x1 + 5:.1f},{(y0 + y1) / 2:.1f} {x1 - 4:.1f},{y1 - 3:.1f} '
        f'Q{cx:.1f},{y1 + 5:.1f} {x0 + 4:.1f},{y1 - 3:.1f} Q{x0 - 5:.1f},{(y0 + y1) / 2:.1f} {x0 + 4:.1f},{y0 + 4:.1f} Z" fill="url(#{id_})"/>',
        # A gold piping along its front edge, and the sheen of velvet.
        f'<path d="M{x0 + 4:.1f},{y1 - 3:.1f} Q{cx:.1f},{y1 + 5:.1f} {x1 - 4:.1f},{y1 - 3:.1f}" stroke="url(#gold)" stroke-width="2.2" fill="none"/>',
        f'<ellipse cx="{cx - w * 0.18:.1f}" cy="{y0 + h * 0.3:.1f}" rx="{w * 0.24:.1f}" ry="{h * 0.14:.1f}" fill="#FFFFFF" opacity="0.22"/>',
    ]
    for tx in (x0 + 4, x1 - 4):
        body.append(f'<circle cx="{tx:.1f}" cy="{y1 - 3:.1f}" r="3" fill="url(#gold)"/>')
        for k in range(5):
            dx = (k - 2) * 1.1
            body.append(f'<path d="M{tx + dx * 0.5:.1f},{y1:.1f} L{tx + dx:.1f},{y1 + 10:.1f}" stroke="{"#F7CD48" if k % 2 else "#C68C18"}" stroke-width="1.2" stroke-linecap="round"/>')
        body.append(f'<rect x="{tx - 2.6:.1f}" y="{y1 + 1:.1f}" width="5.2" height="2.2" rx="1" fill="#B07A12"/>')
    return defs, "".join(body)


def crown(name, kind, cap, gems, cush, seed):
    """A crown on its cushion, 150 x 150; its origin, the pivot, at the cushion's foot (75, 146)."""
    rnd = random.Random(seed)
    W, H = 150, 150
    cx, base, top_band = 75, 108, 86  # the band: from y 86 to 108, its bottom curving down at the front
    cdefs, cbody = cushion(cx, 102, 112, 34, *cush, rnd)
    defs = GOLD + GOLD_SIDE + PEARL + GEMS + cdefs + rad("cap", [(0, cap[0], None), (0.6, cap[1], None), (1, cap[2], None)], fx=0.35, fy=0.3) + blur("soft", 2.5) + blur("glow", 3)
    body = [cbody]
    bw = 44  # half the band's width
    # The velvet cap inside the crown, domed.
    if kind != "spikes":
        body.append(f'<path d="M{cx - bw + 4},{top_band + 2} C{cx - bw + 2},{top_band - 40} {cx + bw - 2},{top_band - 40} {cx + bw - 4},{top_band + 2} Z" fill="url(#cap)"/>')
        body.append(f'<ellipse cx="{cx - 14}" cy="{top_band - 22}" rx="11" ry="6" fill="#FFFFFF" opacity="0.22" transform="rotate(-20 {cx - 14} {top_band - 22})"/>')
    # The points.
    if kind == "arches":
        # Two gold arches over the cap, crossing at an orb of pearls.
        body.append(f'<path d="M{cx - bw + 6},{top_band} C{cx - bw + 8},{top_band - 50} {cx + bw - 8},{top_band - 50} {cx + bw - 6},{top_band}" stroke="url(#gold)" stroke-width="7" fill="none"/>')
        body.append(f'<path d="M{cx},{top_band} L{cx},{top_band - 38}" stroke="url(#goldSide)" stroke-width="7"/>')
        for i in range(7):
            t = (i + 1) / 8
            x = (1 - t) ** 3 * (cx - bw + 6) + 3 * (1 - t) ** 2 * t * (cx - bw + 8) + 3 * (1 - t) * t * t * (cx + bw - 8) + t ** 3 * (cx + bw - 6)
            y = (1 - t) ** 3 * top_band + 3 * (1 - t) ** 2 * t * (top_band - 50) + 3 * (1 - t) * t * t * (top_band - 50) + t ** 3 * top_band
            body.append(pearl(x, y, 2.3))
        body.append(f'<circle cx="{cx}" cy="{top_band - 44}" r="8" fill="url(#gold)"/><path d="M{cx - 8},{top_band - 44} L{cx + 8},{top_band - 44}" stroke="#B07A12" stroke-width="1.6"/>')
        body.append(pearl(cx, top_band - 55, 4))
        body.append(f'<ellipse cx="{cx - 3}" cy="{top_band - 47}" rx="3" ry="2" fill="#FFFFFF" opacity="0.7"/>')
        lows = [(cx - bw + 2, top_band - 6), (cx + bw - 2, top_band - 6)]
        for x, y in lows:
            body.append(pearl(x, y, 3.4))
    else:
        n = 5 if kind == "points" else 7
        tips = []
        for i in range(n):
            t = i / (n - 1)
            x = cx - bw + 4 + t * (2 * bw - 8)
            mid = 1 - abs(t - 0.5) * 2  # taller in the middle
            h = (30 + 14 * mid) if kind == "points" else (24 + 18 * mid)
            tips.append((x, top_band - h))
        d = f"M{cx - bw},{top_band + 4} "
        for i, (x, y) in enumerate(tips):
            half = (bw * 2 - 8) / (n - 1) / 2
            if kind == "points":
                # Leaf-shaped points with a pearl on each tip.
                d += f"L{x - half * 0.9:.1f},{top_band:.1f} Q{x - half * 0.35:.1f},{y + 14:.1f} {x:.1f},{y + 4:.1f} Q{x + half * 0.35:.1f},{y + 14:.1f} {x + half * 0.9:.1f},{top_band:.1f} "
            else:
                # Tall slim spikes, a ray crown.
                d += f"L{x - half * 0.75:.1f},{top_band:.1f} L{x:.1f},{y:.1f} L{x + half * 0.75:.1f},{top_band:.1f} "
        d += f"L{cx + bw},{top_band + 4} Z"
        body.append(f'<path d="{d}" fill="url(#gold)"/>')
        # A darker inner face on each point's right, so they read as metal.
        for x, y in tips:
            body.append(f'<path d="M{x:.1f},{y + (4 if kind == "points" else 0):.1f} L{x + 3:.1f},{top_band:.1f} L{x:.1f},{top_band:.1f} Z" fill="#B07A12" opacity="0.35"/>')
            if kind == "points":
                body.append(pearl(x, y + 1, 4.2))
            else:
                body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.2" fill="url(#gold)"/><circle cx="{x - 1:.1f}" cy="{y - 1:.1f}" r="1.1" fill="#FFFFFF" opacity="0.9"/>')
        # A small gem low on each point.
        for i, (x, y) in enumerate(tips):
            if kind == "points" or i % 2 == 0:
                body.append(stone(x, top_band - 9, 2.6, gems[i % len(gems)]))
    # The band: curving down at the front, gems along it, a rim of pearls top and bottom.
    body.append(f'<path d="M{cx - bw},{top_band} Q{cx},{top_band + 7} {cx + bw},{top_band} L{cx + bw},{base - 6} Q{cx},{base + 4} {cx - bw},{base - 6} Z" fill="url(#gold)"/>')
    body.append(f'<path d="M{cx - bw},{top_band + 2} Q{cx},{top_band + 9} {cx + bw},{top_band + 2}" stroke="#FFF7CF" stroke-width="1.6" fill="none" opacity="0.8"/>')
    body.append(f'<path d="M{cx - bw},{base - 6} Q{cx},{base + 4} {cx + bw},{base - 6}" stroke="#8E5C0E" stroke-width="1.6" fill="none" opacity="0.6"/>')
    for i in range(5):
        t = (i + 0.5) / 5
        x = cx - bw + t * 2 * bw
        y = (top_band + base) / 2 + 2 - 4 * (1 - (2 * t - 1) ** 2) * -1
        if i % 2 == 0:
            body.append(stone(x, y, 4.6 if i == 2 else 3.6, gems[(i // 2) % len(gems)], 1.15 if i == 2 else 1.0))
        else:
            body.append(pearl(x, y - 0.5, 2.6))
    # The light: a bright streak along the band's top left, a sparkle.
    body.append(f'<path d="M{cx - bw + 5},{top_band + 6} Q{cx - 18},{top_band + 10} {cx - 4},{top_band + 10}" stroke="#FFFFFF" stroke-width="2.4" fill="none" opacity="0.55" stroke-linecap="round"/>')
    body.append(f'<circle cx="{cx - bw + 10}" cy="{top_band + 4}" r="6" fill="#FFF7CF" opacity="0.7" filter="url(#glow)"/>')
    body.append(f'<path d="M{cx - bw + 10},{top_band - 2} L{cx - bw + 11},{top_band + 3} L{cx - bw + 16},{top_band + 4} L{cx - bw + 11},{top_band + 5} L{cx - bw + 10},{top_band + 10} L{cx - bw + 9},{top_band + 5} L{cx - bw + 4},{top_band + 4} L{cx - bw + 9},{top_band + 3} Z" fill="#FFFFFF"/>')
    art.part(name, W, H, (75, 146), "\n".join(body), defs, "a crown on its cushion; pivot at the cushion's foot (75,146), it rocks on it")


def sweet(name, wrap, light, dark, seed):
    """A sweet in twisted cellophane, 44 x 44, centred: what the floats throw."""
    rnd = random.Random(seed)
    defs = (rad("wrap", [(0, light, None), (0.6, wrap, None), (1, dark, None)], fx=0.35, fy=0.3) +
            lin("ends", [(0, light, None), (1, dark, None)], 0, 0, 1, 1))
    body = [
        # The twisted ends, crinkled.
        '<path d="M14,22 L3,13 Q1,17 4,20 Q0,22 4,25 Q1,28 3,31 Z" fill="url(#ends)"/>',
        '<path d="M30,22 L41,13 Q43,17 40,20 Q44,22 40,25 Q43,28 41,31 Z" fill="url(#ends)"/>',
        '<path d="M5,16 L13,21 M5,28 L13,23 M39,16 L31,21 M39,28 L31,23" stroke="#FFFFFF" stroke-width="0.9" opacity="0.5"/>',
        '<ellipse cx="22" cy="22" rx="11" ry="9" fill="url(#wrap)"/>',
        # A stripe round it and the cellophane's shine.
        f'<path d="M14,17 Q22,24 30,17" stroke="#FFFFFF" stroke-width="2.2" fill="none" opacity="0.55"/>',
        '<ellipse cx="18" cy="18" rx="4" ry="2.2" fill="#FFFFFF" opacity="0.8" transform="rotate(-20 18 18)"/>',
        '<path d="M13,22 L31,22" stroke="#FFFFFF" stroke-width="0.6" opacity="0.25"/>',
    ]
    art.part(name, 44, 44, (22, 22), "\n".join(body), defs, "a tap throws these")


def roscon():
    """The ring cake, 120 x 46, on a ground line at y 41: glazed brioche, candied fruit, sugar, almonds."""
    rnd = random.Random(61)
    W, H, cx, cy = 120, 46, 60, 27
    defs = (rad("bun", [(0, "#F9D38A", None), (0.45, "#E2A24C", None), (0.85, "#B86A22", None), (1, "#8A4A16", None)], cx=0.42, cy=0.35, r=0.7, fx=0.35, fy=0.25) +
            rad("crumb", [(0, "#FFF2D6", None), (1, "#F2D8A8", None)]) +
            gem("cherryR", "#FFB0B8", "#E0243A", "#7A0A1A") + gem("cherryG", "#D8FFB0", "#4CB83A", "#1E6A1A") +
            rad("orange", [(0, "#FFE2A0", None), (0.6, "#FF9A2A", None), (1, "#D06A0A", None)], fx=0.35, fy=0.3) +
            blur("soft", 1.8))
    rx, ry, wall = 52, 15, 7  # the ring's outer edge on top, and the height of its side
    cy = 22
    hx, hy = 21, 6  # the hole
    defs += (lin("crust", [(0, "#C67A2C", None), (0.6, "#8E4A16", None), (1, "#6A3410", None)]) +
             f'<clipPath id="hole"><ellipse cx="{cx}" cy="{cy}" rx="{hx}" ry="{hy}"/></clipPath>')
    body = [f'<ellipse cx="{cx + 3}" cy="{cy + wall + ry - 2}" rx="{rx + 4}" ry="5" fill="#1A0C04" opacity="0.32" filter="url(#soft)"/>']
    # The side of the ring, then its glazed top.
    body.append(f'<path d="M{cx - rx},{cy} L{cx - rx},{cy + wall} A{rx},{ry} 0 0 0 {cx + rx},{cy + wall} L{cx + rx},{cy} Z" fill="url(#crust)"/>')
    body.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#bun)"/>')
    # The lobes of the dough, pressed round the ring.
    for i in range(12):
        a = i / 12 * 2 * math.pi + 0.15
        x1, y1 = cx + math.cos(a) * (hx + 3), cy + math.sin(a) * (hy + 1)
        x2, y2 = cx + math.cos(a) * (rx - 2), cy + math.sin(a) * (ry - 1)
        body.append(f'<path d="M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}" stroke="#A85E1E" stroke-width="1.1" opacity="0.35" stroke-linecap="round"/>')
        if math.sin(a) > 0.2:
            body.append(f'<path d="M{cx + math.cos(a) * rx:.1f},{cy + math.sin(a) * ry:.1f} l0,{wall * 0.8:.1f}" stroke="#5A2A0C" stroke-width="1" opacity="0.4"/>')
    # The hole: the inner wall of the far side, and the plate in shadow below it.
    body.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{hx}" ry="{hy}" fill="#9A5418"/>')
    body.append(f'<ellipse cx="{cx + 1}" cy="{cy + 4}" rx="{hx}" ry="{hy}" fill="#2E1606" clip-path="url(#hole)"/>')
    # The glaze's shine round the top left of the ring.
    body.append(f'<path d="M{cx - rx + 8},{cy - 3} Q{cx - 30},{cy - ry + 1} {cx - 4},{cy - ry + 2}" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.3" stroke-linecap="round"/>')
    thick = 12
    rx, ry = (rx + hx) / 2, (ry + hy) / 2  # the ring's middle line, for the toppings
    # Pearl sugar, almond flakes, then the candied fruit round the ring.
    for _ in range(60):
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(-0.8, 0.8) * thick
        x, y = cx + math.cos(a) * (rx + rr), cy + math.sin(a) * (ry + rr * 0.32)
        body.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="1.5" height="1.3" rx="0.4" fill="#FFFDF6" opacity="{rnd.uniform(0.7, 1):.2f}" transform="rotate({rnd.uniform(0, 90):.0f} {x:.1f} {y:.1f})"/>')
    for i in range(10):
        a = i / 10 * 2 * math.pi + 0.2
        x, y = cx + math.cos(a) * rx, cy + math.sin(a) * ry
        body.append(f'<ellipse cx="{x:.1f}" cy="{y + 2:.1f}" rx="3.2" ry="1.4" fill="#F4E1BC" transform="rotate({rnd.uniform(-40, 40):.0f} {x:.1f} {y + 2:.1f})"/>')
    fruit = []
    for i in range(9):
        a = i / 9 * 2 * math.pi - 0.1
        x, y = cx + math.cos(a) * rx, cy + math.sin(a) * ry - 2
        fruit.append((y, x, i))
    for y, x, i in sorted(fruit):  # back to front
        k = i % 3
        if k == 0:
            body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.4" fill="url(#cherryR)"/><circle cx="{x - 1.1:.1f}" cy="{y - 1.2:.1f}" r="0.9" fill="#FFFFFF" opacity="0.9"/>')
        elif k == 1:
            body.append(f'<path d="M{x - 5:.1f},{y + 1:.1f} Q{x:.1f},{y - 6:.1f} {x + 5:.1f},{y + 1:.1f} Z" fill="url(#cherryG)"/><path d="M{x - 3:.1f},{y - 0.5:.1f} Q{x:.1f},{y - 4:.1f} {x + 2:.1f},{y - 1.5:.1f}" stroke="#FFFFFF" stroke-width="0.8" fill="none" opacity="0.6"/>')
        else:
            # An orange slice, its segments showing.
            segs = "".join(f'<path d="M{x:.1f},{y:.1f} L{x + math.cos(s * math.pi / 3) * 3.6:.1f},{y + math.sin(s * math.pi / 3) * 2.4:.1f}" stroke="#FFD27A" stroke-width="0.7"/>' for s in range(6))
            body.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="5" ry="3.4" fill="url(#orange)"/>{segs}<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="5" ry="3.4" fill="none" stroke="#FFB04A" stroke-width="0.9"/>')
    art.still("roscon", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n<defs>{defs}</defs>\n' + "\n".join(body) + "\n</svg>\n")


# Crimson, royal blue, emerald velvet: one king's colour each.
crown("crown-points", "points", ("#FF8A9A", "#C81E3A", "#6E0A1E"), ["ruby", "emerald", "sapphire"], ("#FF8FA0", "#C0223C", "#5E0A1A"), 71)
crown("crown-arches", "arches", ("#B48CFF", "#6A2CC0", "#341060"), ["sapphire", "ruby", "amethyst"], ("#8FB4FF", "#2A54C0", "#12285E"), 72)
crown("crown-rays", "spikes", ("#FFFFFF", "#FFFFFF", "#FFFFFF"), ["emerald", "amethyst", "ruby"], ("#8FE3B0", "#1E8A54", "#0B4A2A"), 73)
sweet("sweet-red", "#E0303E", "#FFB0B8", "#8A1020", 81)
sweet("sweet-gold", "#F2B21E", "#FFF0A8", "#9A6410", 82)
sweet("sweet-violet", "#8E44D8", "#E6CCFF", "#4A1A78", 83)
roscon()

art.finish(rig={"walk": {"period": 0.9, "bob": 5.0, "swing": 3.5, "lag": 0.33}})

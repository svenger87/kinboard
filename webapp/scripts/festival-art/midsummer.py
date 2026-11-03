"""Midsummer's art (RFC-020 §3.3): a garland of wild flowers and birch leaves
along every card's top edge, as the midsummer pole and the wreaths are
dressed. No visitor: it's light all night.

    python3 webapp/scripts/festival-art/midsummer.py

One tile, 240 x 48 units (120 x 24 px), drawn to repeat: whatever crosses
an edge is drawn again on the other side. The flower crown is the shop's.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad
from _leaves import leaf

art = Art("midsummer")
W, H = 240, 48


def rope(x):
    """The garland's middle line at x: a gentle twist, two waves a tile."""
    return 22 + 3 * math.sin(2 * math.pi * x / 120)


def daisy(uid, cx, cy, r, turn):
    defs = rad(f"{uid}c", [(0, "#FFF1A8", None), (0.6, "#FFC83D", None), (1, "#E0960F", None)], fx=0.35, fy=0.3)
    petals = "".join(f'<ellipse cx="{cx}" cy="{cy - r * 0.62:.1f}" rx="{r * 0.2:.1f}" ry="{r * 0.42:.1f}" fill="{"#FFFFFF" if i % 2 else "#F4F0FA"}" transform="rotate({turn + i * 360 / 14:.1f} {cx} {cy})"/>' for i in range(14))
    return defs, (f'<circle cx="{cx}" cy="{cy}" r="{r * 1.02:.1f}" fill="#C9C3D9" opacity="0.35"/>' + petals +
                  f'<circle cx="{cx}" cy="{cy}" r="{r * 0.3:.1f}" fill="url(#{uid}c)"/><circle cx="{cx - r * 0.1:.1f}" cy="{cy - r * 0.1:.1f}" r="{r * 0.1:.1f}" fill="#FFFFFF" opacity="0.7"/>')


def cornflower(uid, cx, cy, r, turn):
    """A cornflower: ragged blue florets round a dark heart."""
    defs = rad(f"{uid}b", [(0, "#A9C8FF", None), (0.6, "#4A7BE8", None), (1, "#2A4AB0", None)], fx=0.35, fy=0.3)
    out = []
    for i in range(9):
        a = turn + i * 40
        out.append(f'<path d="M{cx},{cy} L{cx - r * 0.28:.1f},{cy - r * 0.9:.1f} L{cx - r * 0.1:.1f},{cy - r * 0.75:.1f} L{cx:.1f},{cy - r:.1f} '
                   f'L{cx + r * 0.1:.1f},{cy - r * 0.75:.1f} L{cx + r * 0.28:.1f},{cy - r * 0.9:.1f} Z" fill="url(#{uid}b)" transform="rotate({a} {cx} {cy})"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r * 0.28:.1f}" fill="#3A2A7A"/>')
    return defs, "".join(out)


def buttercup(uid, cx, cy, r, turn):
    defs = rad(f"{uid}y", [(0, "#FFFBD0", None), (0.5, "#FFE04A", None), (1, "#E8A80F", None)], fx=0.35, fy=0.3)
    petals = "".join(f'<circle cx="{cx}" cy="{cy - r * 0.55:.1f}" r="{r * 0.48:.1f}" fill="url(#{uid}y)" transform="rotate({turn + i * 72} {cx} {cy})"/>' for i in range(5))
    return defs, petals + f'<circle cx="{cx}" cy="{cy}" r="{r * 0.22:.1f}" fill="#C9A20F"/>'


def campion(uid, cx, cy, r, turn):
    """A pink campion: five notched petals."""
    defs = rad(f"{uid}p", [(0, "#FFE0EC", None), (0.5, "#FF8FC0", None), (1, "#D9468A", None)], fx=0.35, fy=0.3)
    petals = "".join(f'<path d="M{cx},{cy} C{cx - r * 0.5:.1f},{cy - r * 0.4:.1f} {cx - r * 0.5:.1f},{cy - r:.1f} {cx - r * 0.15:.1f},{cy - r:.1f} L{cx},{cy - r * 0.8:.1f} '
                     f'L{cx + r * 0.15:.1f},{cy - r:.1f} C{cx + r * 0.5:.1f},{cy - r:.1f} {cx + r * 0.5:.1f},{cy - r * 0.4:.1f} {cx},{cy} Z" fill="url(#{uid}p)" transform="rotate({turn + i * 72} {cx} {cy})"/>' for i in range(5))
    return defs, petals + f'<circle cx="{cx}" cy="{cy}" r="{r * 0.18:.1f}" fill="#FFF1F6"/>'


def garland():
    rnd = random.Random(21)
    defs = lin("stem", [(0, "#9DCB5A", None), (1, "#4E7A22", None)])
    under, over = [], []
    # The twisted stems: three strands of green, braided along the rope.
    for k, (w, col, ph) in enumerate(((5, "url(#stem)", 0), (2.2, "#7FAF3E", 1.6), (1.6, "#C9E08A", 3.4))):
        pts = " ".join(f"{x},{rope(x) + 2.2 * math.sin(x / 9 + ph):.1f}" for x in range(-4, W + 6, 4))
        under.append(f'<polyline points="{pts}" stroke="{col}" stroke-width="{w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')

    def twice(x, draw):
        """Draw at x, and again a tile away where it crosses an edge, so the tile repeats seamlessly."""
        out = [draw(x, "")]
        if x < 14:
            out.append(draw(x + W, "r"))
        if x > W - 14:
            out.append(draw(x - W, "l"))
        return out

    # Birch leaves along it, alternately above and below.
    for i in range(16):
        x = 8 + i * 15 + rnd.uniform(-3, 3)
        up = i % 2 == 0
        turn = (-40 if up else 220) + rnd.uniform(-20, 20)
        size = rnd.uniform(11, 14)
        seed = i

        def draw(xx, tag, up=up, turn=turn, size=size, seed=seed, i=i):
            nonlocal defs
            d, b = leaf("elm", "green", f"b{i}{tag}", xx, rope(xx) + (-5 if up else 5), size, turn=turn, seed=seed, sheen=False)
            defs += d
            return b
        under += twice(x, draw)
    # Flowers on the rope: daisies, cornflowers, buttercups and campion, by turns.
    kinds = [daisy, cornflower, buttercup, daisy, campion, cornflower, daisy, buttercup, campion]
    for i, fn in enumerate(kinds):
        x = 12 + i * (W / len(kinds)) + rnd.uniform(-3, 3)
        y_off = rnd.uniform(-3, 3)
        r = rnd.uniform(6.5, 8.5) if fn is daisy else rnd.uniform(5.5, 7)
        turn = rnd.uniform(0, 60)

        def draw(xx, tag, fn=fn, y_off=y_off, r=r, turn=turn, i=i):
            nonlocal defs
            d, b = fn(f"f{i}{tag}", round(xx, 1), round(rope(xx) + y_off, 1), round(r, 1), round(turn, 1))
            defs += d
            return b
        over += twice(x, draw)
    # Light from the top left along the whole garland.
    over.append(f'<path d="M0,{rope(0) - 4:.1f} ' + " ".join(f"L{x},{rope(x) - 4:.1f}" for x in range(4, W + 1, 4)) + '" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.18"/>')
    art.still("flower-garland", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 2}" height="{H // 2}">\n'
                                 f"<defs>{defs}</defs>\n" + "\n".join(under + over) + "\n</svg>\n"))


garland()
art.finish()

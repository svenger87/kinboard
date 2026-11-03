"""Eid al-Fitr's and Eid al-Adha's art (RFC-020 §3.3), drawn once here for both.

The visitor (lanterns and sparkles rising) is drawn into Eid al-Fitr's folder
only; Eid al-Adha's kit borrows it (`art: "eid-al-fitr"`), so the two share
one set of bitmaps. The dressing's stills are drawn into each festival's own
folder, because a kit's dressing reads only its own (`s.art`).
"""
from _common import lin, rad
from _lanterns import lantern, lantern_defs, sparkle, sparkle_defs, bulb, wire, side_lantern

LANTERNS = ("emerald", "amber", "rose", "turquoise")
# The string's bulbs, in turn: warm gold, emerald, warm white, rose.
BULBS = ["#FFD86B", "#5FD99A", "#FFE39A", "#FF9FB6"]


def visitor(art):
    for glass in LANTERNS:
        # 80 x 120: the lantern at 60 x 100 with its glow round it; pivot at the ring, so it sways from the top.
        art.part(f"lantern-{glass}", 80, 120, (40, 10), f'<g transform="translate(10 10)">{lantern("a")}</g>', lantern_defs("a", glass))
    for name, colour, deep, s in (("sparkle-gold", "#FFD24A", "#D99A12", 16), ("sparkle-white", "#FFF3C4", "#E8B84A", 12), ("sparkle-emerald", "#7FE8B4", "#23955C", 13)):
        art.part(name, 40, 40, (20, 20), sparkle("s", 20, 20, s, colour), sparkle_defs("s", colour, deep))


def stills(art):
    # The string lights: a 120 x 16 tile, a wire drooping between posts every 30, a bulb at each low point.
    d, lows = wire(0, 120, 2, 2.5, 4)
    glow = "".join(rad(f"g{i}", [(0, c, 0.7), (1, c, 0)]) for i, c in enumerate(BULBS))
    bulbs = "".join(bulb(x, y + 5, 3.2, BULBS[i % len(BULBS)], f"g{i % len(BULBS)}") for i, (x, y) in enumerate(lows))
    art.still("string-lights", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 16" width="120" height="16">\n'
              f"<defs>{glow}</defs>\n"
              f'<path d="{d}" fill="none" stroke="#2F5D4A" stroke-width="1.1"/>\n{bulbs}\n</svg>\n')
    # A lantern beside each card, its chain from the card's top corner; two, for alternate cards.
    art.still("lantern-side-a", side_lantern("emerald", 8))
    art.still("lantern-side-b", side_lantern("rose", 20))

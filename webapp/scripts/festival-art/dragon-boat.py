"""Dragon Boat's art (RFC-020 §3.3): a dragon boat paddling along the bottom
of the screen. A long green hull scaled like a dragon, its tail curled up at
the stern and its head held high at the bow; eight paddlers pulling in
rhythm, a drummer at the bow keeping the beat, a steerer at the stern with
the long oar; water round the hull, the blades going into it.

    python3 webapp/scripts/festival-art/dragon-boat.py

A friendly dragon, round and green with a red mane: a festival boat, not a
figure of worship (§7). The paddlers are round, soft little figures in the
creatures' manner.

Parts, each in its own units with its pivot; the rig (`rig` in the art
JSON, built by kits/dragon-boat.ts) places them on the hull: torsos under it
(their seats are below the gunwale), arms and paddles over it, the near
water over everything, so the blades dip into it.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("dragon-boat")

GREEN = ("#9BE07A", "#3FA85A", "#1E6A3A")
RED = ("#FF8A7A", "#E8453C", "#9E1F24")
GOLD = "#FFC83D"
SKIN = {"light": ("#FFE2C4", "#F2BE8E", "#C98F65"), "dark": ("#E0A87A", "#B5764A", "#7A4A2A")}
SHIRT = {"yellow": ("#FFF0A0", "#FFC83D", "#C98A12"), "red": ("#FFA08A", "#E8453C", "#9E1F24"), "blue": ("#A6D8FF", "#4A9BE8", "#2563B8")}


# ---------------------------------------------------------------- the hull, with its tail and neck
def hull():
    """600 x 124, pivot (300, 104) on the waterline: the hull scaled like a dragon, the tail curled up at the stern (left), the neck rising at the bow."""
    rnd = random.Random(6)
    defs = (lin("hg", [(0, GREEN[0], None), (0.45, GREEN[1], None), (1, GREEN[2], None)]) +
            lin("band", [(0, "#FF8A7A", None), (1, "#B3121C", None)]) +
            lin("belly", [(0, "#FFE9A8", None), (1, "#E0A030", None)]) +
            lin("deck", [(0, "#C98F55", None), (1, "#7A4E24", None)]) +
            '<clipPath id="hc"><path d="M34,72 L548,72 C566,72 574,82 568,94 C548,116 88,118 46,104 C30,98 26,84 34,72 Z"/></clipPath>' +
            blur("hb", 2))
    body = [
        # the inside of the far gunwale, the deck seen over the near side
        '<path d="M40,66 L546,66 L548,74 L36,74 Z" fill="url(#deck)"/>',
        # the tail: rising from the stern and curling over, a red fin along it
        '<path d="M50,80 C20,78 8,60 10,40 C12,22 28,14 38,22 C46,28 42,40 34,40 C28,40 28,32 32,30 C24,30 22,44 28,54 C34,64 50,68 60,70 Z" fill="url(#hg)"/>',
        '<path d="M14,40 C8,34 4,26 8,18 C12,24 16,26 20,24 C18,30 18,36 14,40 Z M24,58 C14,58 6,54 4,48 C10,50 16,50 20,46 C20,52 22,56 24,58 Z" fill="url(#band)"/>',
        '<path d="M20,32 C22,24 30,20 36,24" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.35" stroke-linecap="round"/>',
        # the neck, rising at the bow, the belly gold
        '<path d="M520,74 C548,72 562,56 566,32 L592,36 C592,62 584,84 566,94 Z" fill="url(#hg)"/>',
        '<path d="M572,40 C576,62 572,80 560,90 L568,92 C582,82 588,62 586,40 Z" fill="url(#belly)" opacity="0.9"/>',
        # the hull
        '<path d="M34,72 L548,72 C566,72 574,82 568,94 C548,116 88,118 46,104 C30,98 26,84 34,72 Z" fill="url(#hg)"/>',
    ]
    # Scales: rows of overlapping arcs, lit on top.
    scales = []
    for row, y in enumerate((84, 93, 102)):
        for k in range(46):
            x = 44 + k * 11.5 + (5.75 if row % 2 else 0)
            scales.append(f'<path d="M{x - 6:.1f},{y} Q{x:.1f},{y + 9} {x + 6:.1f},{y}" stroke="{GREEN[2]}" stroke-width="1.6" fill="none" opacity="0.45"/>'
                          f'<path d="M{x - 4:.1f},{y + 1.5} Q{x:.1f},{y + 6} {x + 4:.1f},{y + 1.5}" stroke="{GREEN[0]}" stroke-width="1" fill="none" opacity="0.5"/>')
    body.append('<g clip-path="url(#hc)">' + "".join(scales) +
                # the gold belly along the keel, and the shade under the hull
                '<path d="M40,104 C120,116 480,114 566,96 L566,124 L40,124 Z" fill="url(#belly)" opacity="0.85"/>'
                '<path d="M40,108 C120,120 480,118 566,100" stroke="#B07A12" stroke-width="1.4" fill="none" opacity="0.5"/></g>')
    # The red band along the gunwale, gold studs on it, a highlight above.
    body.append('<path d="M34,72 L548,72 L550,79 L34,79 Z" fill="url(#band)"/>')
    body.append("".join(f'<circle cx="{44 + k * 16}" cy="75.5" r="1.8" fill="{GOLD}"/>' for k in range(32)))
    body.append('<path d="M40,71 L540,71" stroke="#FFFFFF" stroke-width="1.6" opacity="0.4"/>')
    body.append('<ellipse cx="140" cy="86" rx="70" ry="4" fill="#FFFFFF" opacity="0.18"/>')
    art.part("hull", 600, 124, (300, 104), "\n".join(body), defs)


def head():
    """150 x 120, pivot (36, 76) where it meets the neck: a friendly dragon's head, looking ahead, mouth open in a smile, a red mane, gold horns, whiskers."""
    defs = (rad("dh", [(0, GREEN[0], None), (0.5, GREEN[1], None), (1, GREEN[2], None)], fx=0.35, fy=0.3) +
            lin("mane", [(0, "#FF8A7A", None), (1, "#B3121C", None)]) +
            lin("horn", [(0, "#FFF0A0", None), (1, "#D9A020", None)]) +
            rad("eye", [(0, "#FFFFFF", None), (1, "#F0EAD8", None)]) +
            rad("pearl", [(0, "#FFFFFF", None), (0.5, "#FFF0C4", None), (1, "#F2C23A", None)], fx=0.35, fy=0.3))
    body = [
        # the mane, flowing back from the head
        '<path d="M40,40 C24,30 12,34 4,26 C10,40 4,52 0,60 C10,58 16,64 12,74 C22,68 30,70 34,78 C36,68 42,60 48,56 Z" fill="url(#mane)"/>',
        # horns
        '<path d="M58,30 C54,16 46,8 36,4 C46,6 54,10 60,18 C60,8 58,2 54,-2 C64,4 68,16 66,30 Z" fill="url(#horn)" transform="translate(0 6)"/>',
        # the lower jaw, open
        '<path d="M44,74 C70,80 108,82 128,74 C130,82 118,92 92,94 C70,96 52,90 44,84 Z" fill="url(#dh)"/>',
        '<path d="M60,78 C80,84 104,84 120,78 C112,86 96,88 80,86 Z" fill="#B3121C"/>',
        '<path d="M66,80 l3,4 l3,-4 M104,80 l3,4 l3,-4" stroke="#FFFFFF" stroke-width="2" fill="#FFFFFF" stroke-linejoin="round"/>',
        # the head and long snout
        '<path d="M30,62 C28,38 46,22 72,22 C92,22 104,32 116,40 C130,48 142,52 144,62 C146,72 136,76 120,74 C96,72 64,76 44,76 C36,76 30,70 30,62 Z" fill="url(#dh)"/>',
        # the snout's ridge and nostril
        '<path d="M80,30 C100,32 118,42 136,52" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.3" stroke-linecap="round"/>',
        '<ellipse cx="134" cy="58" rx="4" ry="2.6" fill="#1E6A3A" transform="rotate(-20 134 58)"/>',
        # the eye, big and kind, under a gold brow
        '<path d="M62,36 C68,28 80,28 86,34" stroke="url(#horn)" stroke-width="5" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="74" cy="46" rx="10" ry="11" fill="url(#eye)"/>',
        '<circle cx="77" cy="47" r="6" fill="#2A1A3E"/><circle cx="79" cy="44.5" r="2.2" fill="#FFFFFF"/>',
        '<circle cx="96" cy="64" r="5" fill="#FF8FA3" opacity="0.4"/>',
        # whiskers, gold, curling back
        '<path d="M126,66 C140,76 150,74 148,88 M118,70 C124,86 116,96 106,100" stroke="#FFD24A" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="56" cy="34" rx="12" ry="5" fill="#FFFFFF" opacity="0.3" transform="rotate(-25 56 34)"/>',
    ]
    art.part("head", 150, 120, (36, 76), "\n".join(body), defs)


# ---------------------------------------------------------------- the crew
def torso(name, skin, shirt, band):
    """40 x 56, pivot (20, 56) on the seat: a round paddler facing right (the way the boat goes), a headband with its tails flying back."""
    s, c = SKIN[skin], SHIRT[shirt]
    defs = (rad("sk", [(0, s[0], None), (0.6, s[1], None), (1, s[2], None)], fx=0.35, fy=0.3) +
            rad("sh", [(0, c[0], None), (0.55, c[1], None), (1, c[2], None)], fx=0.35, fy=0.3))
    body = [
        '<ellipse cx="20" cy="42" rx="14" ry="16" fill="url(#sh)"/>',
        '<ellipse cx="14" cy="34" rx="5" ry="3" fill="#FFFFFF" opacity="0.3" transform="rotate(-30 14 34)"/>',
        '<circle cx="22" cy="15" r="12" fill="url(#sk)"/>',
        f'<path d="M10.5,10 C16,6 28,6 33.5,10 L33.5,14 C28,10 16,10 10.5,14 Z" fill="{band}"/>',
        f'<path d="M11,12 C6,12 2,10 0,14 C4,14 6,16 4,20 C8,18 10,16 11,14 Z" fill="{band}"/>',
        '<circle cx="28" cy="17" r="1.9" fill="#2A1A3E"/><circle cx="28.6" cy="16.3" r="0.6" fill="#FFFFFF"/>',
        '<path d="M27,22 Q30,24 32,21.5" stroke="#7A4A2A" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
        '<circle cx="25" cy="21" r="2" fill="#FF8FA3" opacity="0.4"/>',
        '<ellipse cx="18" cy="9" rx="4" ry="2" fill="#FFFFFF" opacity="0.35" transform="rotate(-25 18 9)"/>',
    ]
    art.part(name, 40, 56, (20, 56), "\n".join(body), defs)


def paddle(name, skin):
    """24 x 104, pivot (8, 6) at the shoulder: the arm down to both hands on the shaft, the paddle's blade at the bottom."""
    s = SKIN[skin]
    defs = (lin("arm", [(0, s[0], None), (1, s[1], None)], 0, 0, 1, 0) +
            lin("blade", [(0, "#FF8A7A", None), (0.6, "#E8453C", None), (1, "#9E1F24", None)], 0, 0, 1, 0))
    body = [
        '<path d="M8,6 C10,16 12,24 13,32" stroke="url(#arm)" stroke-width="6.5" fill="none" stroke-linecap="round"/>',
        # The shaft: solid, as a gradient across a line this thin has no box to span.
        '<path d="M12,22 L15,92" stroke="#C9965A" stroke-width="3.2" stroke-linecap="round"/>',
        '<path d="M11.4,22 L14.4,90" stroke="#F2D6A8" stroke-width="1" stroke-linecap="round" opacity="0.8"/>',
        '<path d="M11,80 C9,86 10,98 14,103 C18,98 20,86 18,80 Z" fill="url(#blade)"/>',
        f'<path d="M12,84 C11.5,90 12,96 14,100" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.4"/>',
        f'<circle cx="12.6" cy="25" r="3.4" fill="{s[1]}"/><circle cx="13.6" cy="40" r="3.4" fill="{s[1]}"/>',
        f'<path d="M8,6 C10,16 12,24 13,32" stroke="#FFFFFF" stroke-width="1.4" fill="none" opacity="0.3" stroke-linecap="round" transform="translate(-1.5 0)"/>',
    ]
    art.part(name, 24, 104, (8, 6), "\n".join(body), defs)


def drum():
    """40 x 40, pivot (20, 40) at its foot: the bow's drum, red with gold studs, its skin lit."""
    defs = (lin("dr", [(0, "#FF8A7A", None), (0.5, "#E8453C", None), (1, "#9E1F24", None)], 0, 0, 1, 0) +
            rad("skin", [(0, "#FFF8E8", None), (1, "#E9D8B8", None)], fx=0.4, fy=0.35))
    body = ('<path d="M4,10 C2,22 4,32 8,38 L32,38 C36,32 38,22 36,10 Z" fill="url(#dr)"/>'
            '<ellipse cx="20" cy="10" rx="16" ry="5" fill="url(#skin)"/>'
            + "".join(f'<circle cx="{6 + k * 7}" cy="14" r="1.4" fill="{GOLD}"/><circle cx="{8 + k * 6}" cy="36" r="1.3" fill="{GOLD}"/>' for k in range(5))
            + '<path d="M8,14 C7,22 8,30 10,36" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.3"/>')
    art.part("drum", 40, 40, (20, 40), body, defs)


def drumstick():
    """16 x 40, pivot (6, 4) at the shoulder: the drummer's arm and stick, raised and brought down on the beat."""
    s = SKIN["light"]
    body = (f'<path d="M6,4 C6,12 6,18 8,24" stroke="{s[1]}" stroke-width="6" fill="none" stroke-linecap="round"/>'
            f'<circle cx="8" cy="24" r="3.4" fill="{s[1]}"/>'
            '<path d="M8,24 L12,38" stroke="#A8743A" stroke-width="2.4" stroke-linecap="round"/>'
            f'<circle cx="12.4" cy="38.5" r="2.4" fill="{GOLD}"/>')
    art.part("drumstick", 16, 40, (6, 4), body)


def oar():
    """16 x 150, pivot (8, 6) at the steerer's hands: the long steering oar."""
    defs = (lin("b2", [(0, "#FF8A7A", None), (1, "#9E1F24", None)], 0, 0, 1, 0))
    body = ('<path d="M8,4 L8,118" stroke="#C9965A" stroke-width="3.6" stroke-linecap="round"/><path d="M7.2,4 L7.2,116" stroke="#F2D6A8" stroke-width="1.1" opacity="0.8"/>'
            '<path d="M4,112 C2,124 4,140 8,148 C12,140 14,124 12,112 Z" fill="url(#b2)"/>'
            f'<circle cx="8" cy="6" r="3.4" fill="{SKIN["dark"][1]}"/><circle cx="8" cy="16" r="3.4" fill="{SKIN["dark"][1]}"/>')
    art.part("oar", 16, 150, (8, 6), body, defs)


# ---------------------------------------------------------------- water
def water(name, near):
    """700 x 40, pivot (350, 10): the water round the hull, crests catching the light; the near band lighter and see-through, so the blades show in it."""
    rnd = random.Random(near + 2)
    top, bottom = ("#7FD0E8", "#2E8FB8") if near else ("#4AA8C8", "#1E6A8E")
    defs = (lin(f"wv{near}", [(0, top, 0.75 if near else 0.9), (1, bottom, 0.55 if near else 0.8)]) +
            # Soft at both ends, so the water fades out round the boat rather than stopping square.
            lin(f"fade{near}", [(0, "#FFFFFF", 0), (0.12, "#FFFFFF", 1), (0.88, "#FFFFFF", 1), (1, "#FFFFFF", 0)], 0, 0, 1, 0) +
            f'<mask id="m{near}" maskUnits="userSpaceOnUse" x="0" y="0" width="700" height="40"><rect width="700" height="40" fill="url(#fade{near})"/></mask>')
    pts = [f"{x},{10 + 3 * math.sin(x / 22 + near) + 1.5 * math.sin(x / 7):.1f}" for x in range(0, 701, 10)]
    crest = " ".join(f"L{p}" for p in pts)
    body = [f'<path d="M0,{pts[0].split(",")[1]} {crest} L700,40 L0,40 Z" fill="url(#wv{near})"/>',
            f'<polyline points="{" ".join(pts)}" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="{0.55 if near else 0.3}" stroke-linecap="round"/>']
    for _ in range(14):
        x, y = rnd.uniform(20, 680), rnd.uniform(18, 32)
        body.append(f'<path d="M{x:.0f},{y:.0f} q8,-3 16,0" stroke="#FFFFFF" stroke-width="1.4" fill="none" opacity="0.35" stroke-linecap="round"/>')
    art.part(name, 700, 40, (350, 10), f'<g mask="url(#m{near})">' + "\n".join(body) + "</g>", defs)


hull()
head()
for skin in ("light", "dark"):
    for shirt in ("yellow", "red", "blue"):
        torso(f"paddler-{skin}-{shirt}", skin, shirt, "#E8453C" if shirt != "red" else GOLD)
    paddle(f"paddle-{skin}", skin)
drum()
drumstick()
oar()
water("water-far", 0)
water("water-near", 1)

# The rig, in the hull's units (its top left at the origin): where each joint
# is, and the stroke as keyframes (degrees; negative reaches forward, the way
# the boat goes). Catch, pull, release, a lifted recovery.
art.finish(rig={
    "period": 0.95,
    "hull": [300, 104],
    "head": [578, 38],
    "water": {"far": [330, 100], "near": [330, 110]},
    "seats": [100 + k * 50 for k in range(8)],
    "seat_y": 90,
    "shoulder": [26, -38],
    "stroke": {"rotate": [[0, -40], [0.42, 28], [0.55, 32], [0.78, -10]],
               "lift": [[0, 0], [0.42, 0], [0.58, -10], [0.85, -6]],
               "lean": [[0, 4], [0.42, -3], [0.6, -4], [0.85, 2]]},
    "drummer": {"x": 516, "drum": 492, "shoulder": [12, -36]},
    "steerer": {"x": 52, "oar": 30},
})

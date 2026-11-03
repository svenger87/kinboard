"""Lunar New Year's art (RFC-020 §3.3): the dragon dance along the bottom of
the screen, the lanterns that rise on the last day (the Lantern Festival),
the red lanterns hanging from the cards, and what a tap drops: red envelopes
and mandarins.

    python3 webapp/scripts/festival-art/lunar-new-year.py

The dragon is a row of members on poles, as the dance is: the pearl it
chases, the head (its jaw snapping, its whiskers streaming), seven hoops of
body and the tail. Each member is a small rig: its pole, held still below,
and its part tilting on top of it with the wave that runs down the body
(`walk` bobs each member a little later than the one ahead, so the wave
travels from the head to the tail; the tilt follows the wave's slope, a
quarter of a step behind its height). The numbers are in the rig here.

Friendly, round, festive: big eyes, soft fur, gold and red, lit from the
top left, no outlines. Not a temple guardian: no fangs, no claws.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur, fur

art = Art("lunar-new-year")

RED = lin("red", [(0, "#FF7A6A", None), (0.35, "#E2343E", None), (0.8, "#B01E2C", None), (1, "#7E1220", None)])
GOLD = lin("gold", [(0, "#FFF2B0", None), (0.4, "#F7C845", None), (1, "#B9801A", None)])
GOLD_H = lin("goldH", [(0, "#C68C18", None), (0.5, "#FFE58A", None), (1, "#B9801A", None)], 0, 0, 1, 0)
FUR_W = rad("furW", [(0, "#FFFFFF", None), (0.7, "#FFF6E2", None), (1, "#F2DDB4", None)], fx=0.35, fy=0.3)
SOFT = blur("soft", 2.5)
FUR = ["#FFFFFF", "#FFF1D0", "#F7D27A", "#F2C23A"]


def scales(rnd, x0, x1, y0, y1, clip):
    """Rows of scallops, each lit on its top edge, shadowed under."""
    out = []
    row = 0
    y = y0
    while y < y1:
        off = 7 if row % 2 else 0
        x = x0 - 14 + off
        while x < x1 + 14:
            out.append(f'<path d="M{x - 7:.1f},{y:.1f} Q{x:.1f},{y + 10:.1f} {x + 7:.1f},{y:.1f}" stroke="#7E1220" stroke-width="2.2" fill="none" opacity="0.45"/>'
                       f'<path d="M{x - 6:.1f},{y - 1.2:.1f} Q{x:.1f},{y + 8:.1f} {x + 6:.1f},{y - 1.2:.1f}" stroke="#FFC08A" stroke-width="1" fill="none" opacity="0.5"/>')
            x += 14
        y += 8
        row += 1
    return f'<g clip-path="url(#{clip})">{"".join(out)}</g>'


def mane(rnd, x0, x1, y, h, n):
    """A ridge of fur along the top: tufts of white and gold flicking back."""
    out = []
    for i in range(n):
        x = x0 + (x1 - x0) * (i + rnd.uniform(0, 0.6)) / n
        L = h * rnd.uniform(0.7, 1.15)
        lean = rnd.uniform(-10, -4)
        c = rnd.choice(FUR)
        out.append(f'<path d="M{x - 4:.1f},{y + 3:.1f} Q{x + lean * 0.3:.1f},{y - L * 0.6:.1f} {x + lean:.1f},{y - L:.1f} Q{x + 2:.1f},{y - L * 0.4:.1f} {x + 5:.1f},{y + 3:.1f} Z" fill="{c}"/>')
    return "".join(out)


def fringe(rnd, x0, x1, y, L):
    return "".join(f'<path d="M{x:.1f},{y:.1f} q{rnd.uniform(-1.5, 1.5):.1f},{L * 0.5:.1f} {rnd.uniform(-3, 1):.1f},{L * rnd.uniform(0.8, 1.1):.1f}" stroke="{rnd.choice(["#F7C845", "#FFE58A", "#C68C18"])}" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
                   for x in [x0 + (x1 - x0) * i / 24 for i in range(25)])


# ---------------------------------------------------------------- a hoop of body
def body(name, seed, stripe):
    rnd = random.Random(seed)
    W, H = 130, 104
    path = "M6,48 C6,24 28,16 66,16 C104,16 126,24 126,48 C126,72 106,84 66,84 C28,84 6,72 6,48 Z"
    defs = RED + GOLD + GOLD_H + SOFT + f'<clipPath id="bc"><path d="{path}"/></clipPath>'
    b = [
        f'<path d="{path}" fill="url(#red)"/>',
        scales(rnd, 6, 126, 26, 66, "bc"),
        # The belly: a gold band, ribbed.
        f'<path d="M10,62 C30,70 102,70 122,62 C118,76 100,84 66,84 C32,84 14,76 10,62 Z" fill="url(#gold)"/>',
        "".join(f'<path d="M{x},{66 + abs(x - 66) * -0.02:.1f} l0,{14 - abs(x - 66) * 0.08:.1f}" stroke="#B9801A" stroke-width="1.2" opacity="0.6"/>' for x in range(18, 120, 8)),
        # A band of colour round the hoop, and the light along its top.
        f'<path d="M58,17 C56,40 56,64 58,83 L70,83 C68,64 68,40 70,17 Z" fill="{stripe}" opacity="0.85"/>',
        f'<path d="M22,26 C40,19 80,18 104,22" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.28" stroke-linecap="round"/>',
        # The hoop's rim at its back end, where it overlaps the one behind.
        f'<path d="M10,30 C3,40 3,58 10,70" stroke="url(#goldH)" stroke-width="5" fill="none" stroke-linecap="round"/>',
        f'<path d="M9,34 C5,42 5,54 9,64" stroke="#FFF7CF" stroke-width="1.2" fill="none" opacity="0.8"/>',
        fringe(rnd, 16, 116, 82, 12),
        mane(rnd, 10, 120, 19, 12, 16),
    ]
    art.part(name, W, H, (66, 92), "\n".join(b), defs, "a hoop of the body; pivot where its pole meets it (66,92)")


def tail():
    rnd = random.Random(44)
    W, H = 170, 104
    path = "M48,46 C60,24 92,16 116,16 C144,16 164,26 164,48 C164,70 144,84 114,84 C86,84 62,74 48,54 Z"
    defs = RED + GOLD + GOLD_H + FUR_W + SOFT + f'<clipPath id="tc"><path d="{path}"/></clipPath>'
    b = [
        # The tuft: a flame of white and gold fur streaming back.
        f'<path d="M58,50 C40,30 22,24 4,30 C18,36 22,40 20,44 C8,44 2,52 4,60 C14,56 22,58 24,62 C16,70 16,78 22,84 C32,72 46,66 60,60 Z" fill="url(#furW)"/>',
        fur(rnd, 32, 52, 24, 14, 60, FUR, length=(8, 14), width=1.6, tilt=math.pi, opacity=(0.5, 0.9)),
        f'<path d="{path}" fill="url(#red)"/>',
        scales(rnd, 48, 164, 26, 66, "tc"),
        f'<path d="M58,62 C80,74 140,74 160,62 C156,76 140,84 114,84 C88,84 70,76 58,62 Z" fill="url(#gold)"/>',
        f'<path d="M70,24 C90,18 120,17 146,22" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.28" stroke-linecap="round"/>',
        fringe(rnd, 70, 156, 82, 11),
        mane(rnd, 56, 160, 19, 11, 14),
    ]
    art.part("dragon-tail", W, H, (110, 92), "\n".join(b), defs, "the tail; pivot where its pole meets it (110,92)")


# ---------------------------------------------------------------- the head
def head():
    rnd = random.Random(45)
    W, H = 220, 176
    defs = (RED + GOLD + GOLD_H + FUR_W + SOFT +
            rad("skull", [(0, "#FF8E7A", None), (0.4, "#E8383F", None), (1, "#8E1622", None)], cx=0.42, cy=0.38, r=0.7, fx=0.32, fy=0.25) +
            rad("eyeW", [(0, "#FFFFFF", None), (0.8, "#FFF6E8", None), (1, "#E8D8C0", None)], fx=0.4, fy=0.35) +
            rad("iris", [(0, "#B8FFD8", None), (0.5, "#2FB58A", None), (1, "#0E5A40", None)], fx=0.4, fy=0.35) +
            rad("gem", [(0, "#FFD0D8", None), (0.5, "#2F6BE0", None), (1, "#13306E", None)], fx=0.32, fy=0.28) +
            lin("horn", [(0, "#FFF6CF", None), (0.5, "#F7C845", None), (1, "#A8741A", None)], 0, 0, 1, 1) +
            blur("glow", 4))
    b = [
        # The mane behind the head: a big soft mass of fur.
        f'<path d="M78,20 C46,16 18,40 16,74 C14,108 34,134 66,140 C86,144 98,124 92,100 C88,70 96,44 78,20 Z" fill="url(#furW)"/>',
        fur(rnd, 50, 80, 32, 50, 140, FUR, length=(10, 18), width=1.8, tilt=2.6, opacity=(0.5, 0.95)),
        # Horns, sweeping back, each with a branch.
        f'<path d="M100,42 C90,20 70,6 46,4 C64,12 76,22 84,40 Z" fill="url(#horn)"/>',
        f'<path d="M76,22 C68,16 62,18 56,22 C64,22 68,24 72,28 Z" fill="url(#horn)"/>',
        f'<path d="M118,38 C112,18 98,6 80,0 C94,12 102,24 106,40 Z" fill="url(#horn)" opacity="0.9"/>',
        f'<path d="M98,40 C92,24 80,14 60,8" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity="0.6" stroke-linecap="round"/>',
        # The skull and the long snout.
        f'<path d="M66,84 C62,48 86,30 118,30 C142,30 152,42 160,54 C176,54 200,58 208,72 C214,84 210,102 196,108 C170,112 140,112 116,116 C90,120 70,108 66,84 Z" fill="url(#skull)"/>',
        # The upper lip, gold, and its row of round friendly teeth.
        f'<path d="M126,104 C150,104 180,104 200,102 C206,101 210,96 210,92 C212,102 206,110 196,112 C170,116 146,116 124,114 Z" fill="url(#gold)"/>',
        "".join(f'<path d="M{x},{110} q3.5,8 7,0 Z" fill="#FFFDF6"/>' for x in range(134, 198, 9)),
        # Nostrils on the snout's top, round and gold-rimmed.
        f'<ellipse cx="186" cy="66" rx="11" ry="8" fill="url(#gold)"/><ellipse cx="189" cy="68" rx="5" ry="3.4" fill="#5A0E18"/>',
        f'<ellipse cx="182" cy="62" rx="4" ry="2.2" fill="#FFFFFF" opacity="0.7"/>',
        # A gold ridge over the snout and a gem on the brow.
        f'<path d="M120,44 C140,46 158,52 176,58" stroke="url(#goldH)" stroke-width="6" fill="none" stroke-linecap="round"/>',
        f'<circle cx="114" cy="44" r="7" fill="url(#gold)"/><circle cx="114" cy="44" r="4.6" fill="url(#gem)"/><circle cx="112.4" cy="42.4" r="1.4" fill="#FFFFFF"/>',
        # The big eye, its brow of fur.
        f'<circle cx="138" cy="62" r="17" fill="url(#eyeW)"/>',
        f'<circle cx="143" cy="63" r="10.5" fill="url(#iris)"/><circle cx="144.5" cy="63.5" r="5.6" fill="#10151E"/>',
        f'<circle cx="139.5" cy="58" r="3.4" fill="#FFFFFF"/><circle cx="148" cy="68" r="1.6" fill="#FFFFFF" opacity="0.8"/>',
        f'<path d="M118,48 C126,36 146,34 160,44 C150,42 140,42 132,46 Z" fill="#FFF1D0"/>',
        fur(rnd, 138, 42, 18, 5, 34, FUR, length=(6, 10), width=1.5, tilt=-2.9, opacity=(0.6, 0.95)),
        # A rosy cheek and the gold frill on it.
        f'<ellipse cx="112" cy="92" rx="12" ry="7" fill="#FF8FA3" opacity="0.45" filter="url(#soft)"/>',
        f'<path d="M84,98 C92,90 100,94 104,100 C108,94 116,94 120,102 C112,112 92,114 84,98 Z" fill="url(#gold)"/>',
        # The light on the skull, top left.
        f'<ellipse cx="96" cy="48" rx="18" ry="8" fill="#FFFFFF" opacity="0.3" transform="rotate(-25 96 48)"/>',
        # The beard under the jaw's hinge, white fur.
        f'<path d="M78,108 C84,128 100,140 118,136 C110,128 104,122 102,114 Z" fill="url(#furW)"/>',
        fur(rnd, 96, 124, 14, 10, 40, FUR, length=(6, 10), width=1.4, tilt=1.9, opacity=(0.5, 0.9)),
        # Where the pole meets the neck, a gold collar.
        f'<path d="M62,124 C70,136 86,142 100,140 L98,152 C82,152 68,146 58,136 Z" fill="url(#gold)"/>',
        fringe(rnd, 60, 100, 146, 12),
    ]
    art.part("dragon-head", W, H, (80, 152), "\n".join(b), defs,
             "the head, facing right; pivot where its pole meets the neck (80,152); jaw hinge at (128,110), whiskers at (204,92)")


def jaw():
    rnd = random.Random(46)
    W, H = 92, 44
    defs = RED + GOLD + rad("tongue", [(0, "#FF9AB0", None), (1, "#C8304C", None)], fx=0.4, fy=0.3) + FUR_W
    b = [
        f'<path d="M4,6 C30,4 64,4 84,6 C90,8 90,16 84,20 C62,30 30,32 10,26 C2,22 0,10 4,6 Z" fill="url(#red)"/>',
        f'<path d="M14,8 C34,14 58,14 76,10 C66,18 36,20 14,8 Z" fill="url(#tongue)"/>',
        "".join(f'<path d="M{x},{7} q3.5,-7 7,0 Z" fill="#FFFDF6"/>' for x in range(14, 80, 9)),
        f'<path d="M8,24 C30,32 62,30 84,20" stroke="url(#gold)" stroke-width="4" fill="none" stroke-linecap="round"/>',
        # The chin's tuft.
        f'<path d="M20,26 C26,38 40,44 56,40 C46,36 40,32 38,28 Z" fill="url(#furW)"/>',
    ]
    art.part("dragon-jaw", W, H, (4, 8), "\n".join(b), defs, "the lower jaw; pivot at its hinge (4,8): it snaps open and shut")


def whiskers():
    W, H = 110, 60
    defs = lin("wh", [(0, "#FFE58A", None), (1, "#F7C845", 0.2)], 0, 0, 1, 0)
    b = [
        '<path d="M2,8 C30,0 50,20 72,14 C88,10 96,0 108,4" stroke="url(#wh)" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
        '<path d="M2,12 C26,22 46,38 70,36 C86,34 94,44 106,52" stroke="url(#wh)" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
        '<circle cx="3" cy="10" r="3.4" fill="#F7C845"/>',
    ]
    art.part("dragon-whiskers", W, H, (2, 10), "\n".join(b), defs, "whiskers from the snout; pivot at their root (2,10): they stream back and wave")


def pearl():
    W, H = 84, 260
    defs = (rad("pearl", [(0, "#FFFFFF", None), (0.3, "#FFE58A", None), (0.7, "#FF7A3A", None), (1, "#D8302E", None)], fx=0.35, fy=0.3) +
            rad("halo", [(0, "#FFD27A", 0.6), (1, "#FF7A3A", 0)]) + blur("glow", 5) +
            lin("pole", [(0, "#E2343E", None), (0.5, "#FF8A7A", None), (1, "#8E1622", None)], 0, 0, 1, 0) + GOLD)
    cx, cy = 42, 42
    flames = "".join(
        f'<path d="M{cx + math.cos(a) * 18:.1f},{cy + math.sin(a) * 18:.1f} Q{cx + math.cos(a + 0.5) * 34:.1f},{cy + math.sin(a + 0.5) * 34:.1f} {cx + math.cos(a + 0.9) * 30:.1f},{cy + math.sin(a + 0.9) * 30:.1f} '
        f'Q{cx + math.cos(a + 0.6) * 24:.1f},{cy + math.sin(a + 0.6) * 24:.1f} {cx + math.cos(a + 0.6) * 18:.1f},{cy + math.sin(a + 0.6) * 18:.1f} Z" fill="#FFB43A" opacity="0.8"/>'
        for a in [i * 2 * math.pi / 7 for i in range(7)])
    b = [
        f'<rect x="{cx - 3.5}" y="{cy + 18}" width="7" height="{H - cy - 22}" rx="3.5" fill="url(#pole)"/>',
        f'<rect x="{cx - 4.5}" y="{H - 10}" width="9" height="8" rx="2" fill="url(#gold)"/>',
        f'<circle cx="{cx}" cy="{cy}" r="40" fill="url(#halo)"/>',
        flames,
        f'<circle cx="{cx}" cy="{cy}" r="19" fill="url(#pearl)"/>',
        f'<path d="M{cx - 10},{cy - 2} C{cx - 6},{cy - 14} {cx + 8},{cy - 14} {cx + 12},{cy - 4}" stroke="#FFFFFF" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>',
        f'<circle cx="{cx - 7}" cy="{cy - 8}" r="4" fill="#FFFFFF" opacity="0.95"/>',
    ]
    art.part("pearl", W, H, (cx, cy), "\n".join(b), defs, "the pearl the dragon chases, on its own pole; pivot at its centre")


def pole():
    W, H = 12, 156
    defs = lin("pole", [(0, "#8A5A2C", None), (0.45, "#E2B27A", None), (1, "#6A4020", None)], 0, 0, 1, 0) + GOLD
    b = [f'<rect x="2" y="0" width="8" height="{H - 6}" rx="4" fill="url(#pole)"/>',
         f'<rect x="1" y="{H - 12}" width="10" height="10" rx="2.5" fill="url(#gold)"/>',
         f'<rect x="1" y="0" width="10" height="7" rx="2" fill="url(#gold)"/>']
    art.part("pole", W, H, (6, 2), "\n".join(b), defs, "a dancer's pole; pivot at its top (6,2), under the member it carries")


# ---------------------------------------------------------------- lanterns
def lantern(name, W, H, kind):
    """A red silk lantern glowing from inside, gold caps, a tassel: for rising and for hanging."""
    defs = (rad("silk", [(0, "#FFE0A8", None), (0.35, "#FF6A4A", None), (0.8, "#D8202E", None), (1, "#8E1020", None)], cx=0.45, cy=0.45, r=0.6, fx=0.4, fy=0.38) +
            rad("halo", [(0, "#FFB060", 0.55), (1, "#FF5A3A", 0)]) + GOLD)
    cx = W / 2
    if kind == "round":
        top, bot, rx = H * 0.2, H * 0.72, W * 0.36
    else:
        top, bot, rx = H * 0.16, H * 0.76, W * 0.28
    cy, ry = (top + bot) / 2, (bot - top) / 2
    ribs = "".join(f'<path d="M{cx + rx * k:.1f},{top + 2:.1f} Q{cx + rx * k * 1.45:.1f},{cy:.1f} {cx + rx * k:.1f},{bot - 2:.1f}" stroke="#8E1020" stroke-width="1.2" fill="none" opacity="0.55"/>'
                   for k in (-0.75, -0.4, 0, 0.4, 0.75))
    b = [
        f'<ellipse cx="{cx}" cy="{cy}" rx="{min(cx, rx * 1.9):.1f}" ry="{ry * 1.5:.1f}" fill="url(#halo)"/>',
        f'<path d="M{cx},{top - H * 0.12:.1f} L{cx},{top:.1f}" stroke="#C68C18" stroke-width="1.4"/>',
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx:.1f}" ry="{ry:.1f}" fill="url(#silk)"/>',
        ribs,
        f'<rect x="{cx - rx * 0.55:.1f}" y="{top - 3:.1f}" width="{rx * 1.1:.1f}" height="6" rx="2" fill="url(#gold)"/>',
        f'<rect x="{cx - rx * 0.55:.1f}" y="{bot - 3:.1f}" width="{rx * 1.1:.1f}" height="6" rx="2" fill="url(#gold)"/>',
        f'<ellipse cx="{cx - rx * 0.4:.1f}" cy="{cy - ry * 0.4:.1f}" rx="{rx * 0.22:.1f}" ry="{ry * 0.3:.1f}" fill="#FFFFFF" opacity="0.35" transform="rotate(-15 {cx - rx * 0.4:.1f} {cy - ry * 0.4:.1f})"/>',
        # The tassel.
        f'<path d="M{cx},{bot + 3:.1f} L{cx},{bot + H * 0.06:.1f}" stroke="#C68C18" stroke-width="1.4"/>',
        f'<circle cx="{cx}" cy="{bot + H * 0.07:.1f}" r="2.6" fill="url(#gold)"/>',
        "".join(f'<path d="M{cx + d:.1f},{bot + H * 0.08:.1f} L{cx + d * 1.6:.1f},{H - 2:.1f}" stroke="{c}" stroke-width="1.3" stroke-linecap="round"/>'
                for d, c in ((-2, "#D8202E"), (-1, "#FF6A4A"), (0, "#D8202E"), (1, "#FF6A4A"), (2, "#D8202E"))),
    ]
    art.part(name, W, H, (cx, H / 2), "\n".join(b), defs, "a lantern rising on the Lantern Festival")


def lanterns_hanging():
    """Two small lanterns on a gold cord, 64 x 34, hung from a card's bottom edge."""
    defs = (rad("s", [(0, "#FFE0A8", None), (0.4, "#FF6A4A", None), (1, "#B01826", None)], fx=0.4, fy=0.38) +
            rad("h", [(0, "#FFB060", 0.5), (1, "#FF5A3A", 0)]))

    def one(x, w, h):
        y = 6 + h / 2
        return (f'<path d="M{x},1 L{x},{6}" stroke="#C68C18" stroke-width="0.9"/>'
                f'<ellipse cx="{x}" cy="{y}" rx="{w * 0.9}" ry="{h * 0.8}" fill="url(#h)"/>'
                f'<ellipse cx="{x}" cy="{y}" rx="{w / 2}" ry="{h / 2}" fill="url(#s)"/>'
                f'<path d="M{x - w * 0.2},{y - h / 2 + 1} Q{x - w * 0.32},{y} {x - w * 0.2},{y + h / 2 - 1} M{x + w * 0.2},{y - h / 2 + 1} Q{x + w * 0.32},{y} {x + w * 0.2},{y + h / 2 - 1}" stroke="#8E1020" stroke-width="0.6" fill="none" opacity="0.6"/>'
                f'<rect x="{x - w * 0.28}" y="{y - h / 2 - 1.2}" width="{w * 0.56}" height="2.4" rx="0.8" fill="#F2C23A"/>'
                f'<rect x="{x - w * 0.28}" y="{y + h / 2 - 1.2}" width="{w * 0.56}" height="2.4" rx="0.8" fill="#F2C23A"/>'
                f'<ellipse cx="{x - w * 0.18}" cy="{y - h * 0.18}" rx="{w * 0.1}" ry="{h * 0.14}" fill="#FFFFFF" opacity="0.4"/>'
                f'<path d="M{x},{y + h / 2 + 1} L{x},{y + h / 2 + 3} M{x - 1},{y + h / 2 + 3} L{x - 1.4},{33} M{x},{y + h / 2 + 3} L{x},{33} M{x + 1},{y + h / 2 + 3} L{x + 1.4},{33}" stroke="#D8202E" stroke-width="0.8" stroke-linecap="round"/>')
    art.still("lanterns-hanging", (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 34" width="64" height="34">\n'
        f'<defs>{defs}</defs>\n'
        '<path d="M2,1 Q32,6 62,1" fill="none" stroke="#C68C18" stroke-width="1"/>\n'
        + one(18, 15, 16) + one(46, 13, 14) + "\n</svg>\n"))


def hongbao():
    """A red envelope, 44 x 44, gold-printed: what a tap drops."""
    defs = lin("env", [(0, "#FF5A50", None), (0.5, "#E0242E", None), (1, "#A01420", None)], 0, 0, 1, 1) + GOLD
    b = [
        '<rect x="10" y="4" width="24" height="36" rx="3" fill="url(#env)"/>',
        '<path d="M10,7 Q22,18 34,7 L34,6 Q34,4 32,4 L12,4 Q10,4 10,6 Z" fill="#B81A26"/>',
        '<circle cx="22" cy="14" r="4.2" fill="url(#gold)"/>',
        # A gold coin printed on it, its square hole.
        '<circle cx="22" cy="28" r="7" fill="none" stroke="#F7C845" stroke-width="1.6"/>',
        '<rect x="19.6" y="25.6" width="4.8" height="4.8" fill="none" stroke="#F7C845" stroke-width="1.4"/>',
        '<rect x="12" y="6" width="5" height="30" rx="2" fill="#FFFFFF" opacity="0.18"/>',
    ]
    art.part("hongbao", 44, 44, (22, 22), "\n".join(b), defs, "a red envelope; a tap drops these")


def mandarin():
    defs = rad("peel", [(0, "#FFD07A", None), (0.5, "#FF9A1F", None), (1, "#D06A0A", None)], fx=0.35, fy=0.3)
    rnd = random.Random(47)
    b = [
        '<circle cx="22" cy="24" r="15" fill="url(#peel)"/>',
        "".join(f'<circle cx="{22 + rnd.uniform(-11, 11):.1f}" cy="{24 + rnd.uniform(-11, 11):.1f}" r="0.6" fill="#D06A0A" opacity="0.5"/>' for _ in range(20)),
        '<path d="M22,10 C26,4 34,4 38,8 C32,12 26,12 22,10 Z" fill="#3FA877"/><path d="M24,9 C28,7 32,7 35,8" stroke="#A8E0C0" stroke-width="0.8" fill="none"/>',
        '<ellipse cx="16" cy="17" rx="5" ry="3" fill="#FFFFFF" opacity="0.5" transform="rotate(-30 16 17)"/>',
    ]
    art.part("mandarin", 44, 44, (22, 22), "\n".join(b), defs, "a mandarin; a tap drops these")


body("dragon-body-a", 41, "#F7C845")
body("dragon-body-b", 42, "#2FB58A")
tail(); head(); jaw(); whiskers(); pearl(); pole()
lantern("lantern-round", 64, 92, "round")
lantern("lantern-tall", 54, 100, "tall")
lanterns_hanging()
hongbao(); mandarin()

art.finish(rig={
    "dance": {
        # Seconds per step: the wave's period. Each member a little later than the one ahead.
        "period": 1.5, "lag": 0.085, "bob": 24, "gap": 78,
        # The tilt along the wave: degrees, a quarter of a step behind the height.
        "tilt": 12,
        "jaw": {"at": [128, 108], "open": [[0, 2], [0.3, 16], [0.5, 4], [0.75, 12]]},
        "whiskers": {"at": [204, 92], "wave": [9, 0.15]},
        "head_at": [0, 0],
        # The pearl circles in front of the head, out of step with it.
        "pearl": {"at": [210, -90], "circle": [26, 18]},
    },
})

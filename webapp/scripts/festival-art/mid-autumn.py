"""Mid-Autumn's art (RFC-020 §3.3): paper sky lanterns drifting past a large,
soft full moon with a wisp of cloud across it; a rabbit and mooncakes in the
Tasks card's corner; mooncakes that fall when the moon is tapped.

    python3 webapp/scripts/festival-art/mid-autumn.py

The sky lanterns are drawn here once, in four colours, and Diwali's rising
lanterns are the same parts (its kit borrows this folder, `art:
"mid-autumn"`). Paper, light, the moon, a rabbit and cakes: festive, never
devotional (§7).

The visitor is a rig flown by `fly`: its origin at the left, the moon at
(MOON_X, 0), the lanterns round it, each sliding from behind the moon to
ahead of it over one pass (`rig.lanterns`, read by the kit).
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("mid-autumn")

# ---------------------------------------------------------------- sky lanterns
# Each: the paper's colour where the light is weakest (the top), its colour, and the glow round it.
LANTERNS = {"red": ("#B3121C", "#E8453C", "#FF6B4A"), "gold": ("#C98A12", "#FFC83D", "#FFD24A"),
            "saffron": ("#C9600A", "#FF9933", "#FFA64A"), "magenta": ("#8E1A5E", "#D6338A", "#FF6BB0")}


def sky_lantern(name, top, hue, glow):
    """80 x 110, pivot in the middle: a paper sky lantern lit from inside, brightest at its open bottom, a halo round it."""
    W, H = 80, 110
    defs = (rad("halo", [(0, glow, 0.55), (0.5, glow, 0.18), (1, glow, 0)]) +
            rad("paper", [(0, "#FFF8DA", None), (0.35, "#FFE7A0", None), (0.75, hue, None), (1, top, None)], cx=0.5, cy=0.9, r=0.95, fx=0.5, fy=0.95) +
            rad("flame", [(0, "#FFFFFF", None), (0.4, "#FFE27A", None), (1, "#FF9A1F", 0)]) +
            blur("g", 5))
    paper = "M17,24 C17,8 63,8 63,24 L56,86 C50,90 30,90 24,86 Z"
    body = [
        f'<ellipse cx="40" cy="58" rx="38" ry="52" fill="url(#halo)"/>',
        f'<path d="{paper}" fill="url(#paper)"/>',
        # the bamboo ribs, catching the light inside
        '<path d="M29,13 C26,40 27,68 31,88 M40,11 L40,89 M51,13 C54,40 53,68 49,88" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.28"/>',
        f'<path d="M20,40 C33,43 47,43 60,40" stroke="{top}" stroke-width="1" fill="none" opacity="0.25"/>',
        # light from the top left on the paper's shoulder; shade on the right
        '<ellipse cx="29" cy="20" rx="8" ry="4" fill="#FFFFFF" opacity="0.35" transform="rotate(-20 29 20)"/>',
        f'<path d="M55,22 C60,40 57,70 54,86 C56,70 58,40 55,22 Z" fill="{top}" opacity="0.25"/>',
        # the open bottom: a wire ring, the fuel glowing in it
        '<ellipse cx="40" cy="87" rx="16" ry="3.2" fill="#5A3A1E" opacity="0.55"/>',
        '<path d="M26,87 L54,87" stroke="#8A6236" stroke-width="1"/>',
        '<circle cx="40" cy="88" r="9" fill="url(#flame)" filter="url(#g)"/>',
        '<ellipse cx="40" cy="87.5" rx="3" ry="2.2" fill="#FFF6D0"/>',
    ]
    art.part(name, W, H, (40, 55), "\n".join(body), defs)


# ---------------------------------------------------------------- the moon and a cloud
def moon():
    """400 x 400, pivot at its middle: a full moon 300 across, soft, warm, its halo drawn in."""
    rnd = random.Random(8)
    defs = (rad("mhalo", [(0, "#FFF2C2", 0.55), (0.6, "#FFE29A", 0.18), (1, "#FFE29A", 0)]) +
            rad("mdisc", [(0, "#FFFDF2", None), (0.5, "#FFF0C4", None), (0.85, "#F7D98A", None), (1, "#E8BC62", None)], cx=0.42, cy=0.4, fx=0.36, fy=0.34) +
            rad("crater", [(0, "#E3B65C", 0.5), (1, "#E3B65C", 0)]) +
            blur("mb", 6))
    body = ['<circle cx="200" cy="200" r="198" fill="url(#mhalo)"/>', '<circle cx="200" cy="200" r="150" fill="url(#mdisc)"/>']
    # The seas, soft and darker, and small craters.
    for (x, y, rx, ry) in ((240, 170, 52, 36), (180, 240, 40, 30), (270, 250, 30, 24), (150, 165, 22, 18)):
        body.append(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="url(#crater)" filter="url(#mb)"/>')
    for _ in range(14):
        a, d = rnd.uniform(0, 2 * math.pi), rnd.uniform(20, 130)
        x, y, r = 200 + math.cos(a) * d, 200 + math.sin(a) * d, rnd.uniform(3, 8)
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="#E3B65C" opacity="0.28"/><circle cx="{x - r * 0.3:.1f}" cy="{y - r * 0.3:.1f}" r="{r * 0.6:.1f}" fill="#FFFDF2" opacity="0.25"/>')
    body.append('<ellipse cx="150" cy="128" rx="46" ry="24" fill="#FFFFFF" opacity="0.35" transform="rotate(-35 150 128)"/>')
    art.part("moon", 400, 400, (200, 200), "\n".join(body), defs)


def cloud():
    """300 x 70, pivot in the middle: a long soft wisp of night cloud, lit on top by the moon."""
    defs = (lin("cl", [(0, "#F4EEF8", 0.85), (1, "#8C93C4", 0.55)]) + blur("cb", 3))
    blobs = [(40, 46, 30, 16), (80, 36, 38, 22), (130, 40, 44, 24), (180, 34, 40, 22), (226, 42, 36, 18), (262, 48, 26, 12)]
    body = ['<g filter="url(#cb)">' + "".join(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="url(#cl)"/>' for x, y, rx, ry in blobs) + "</g>",
            '<path d="M60,26 C90,14 150,14 200,22" stroke="#FFFFFF" stroke-width="4" fill="none" opacity="0.4" stroke-linecap="round" filter="url(#cb)"/>']
    art.part("cloud", 300, 70, (150, 35), "\n".join(body), defs)


# ---------------------------------------------------------------- mooncakes and the rabbit
def mooncake_body(uid, cx, cy, r):
    """A mooncake seen from a little above: golden-brown, a scalloped rim, a flower pressed into its top."""
    defs = (rad(f"{uid}t", [(0, "#F7C77A", None), (0.6, "#D9963F", None), (1, "#A8641E", None)], fx=0.38, fy=0.32) +
            lin(f"{uid}s", [(0, "#C98135", None), (1, "#7A4614", None)]))
    out = [f'<ellipse cx="{cx}" cy="{cy + r * 0.32:.1f}" rx="{r}" ry="{r * 0.5:.1f}" fill="url(#{uid}s)"/>',
           f'<rect x="{cx - r}" y="{cy:.1f}" width="{2 * r}" height="{r * 0.32:.1f}" fill="url(#{uid}s)"/>']
    for i in range(14):
        a = 2 * math.pi * i / 14
        out.append(f'<circle cx="{cx + math.cos(a) * r * 0.92:.1f}" cy="{cy + math.sin(a) * r * 0.46:.1f}" r="{r * 0.16:.1f}" fill="#D9963F"/>')
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 0.92:.1f}" ry="{r * 0.46:.1f}" fill="url(#{uid}t)"/>')
    for i in range(8):
        a = 2 * math.pi * i / 8
        x, y = cx + math.cos(a) * r * 0.36, cy + math.sin(a) * r * 0.18
        out.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r * 0.18:.1f}" ry="{r * 0.08:.1f}" fill="#B8742A" opacity="0.6" transform="rotate({math.degrees(a):.0f} {x:.1f} {y:.1f})"/>')
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 0.1:.1f}" ry="{r * 0.05:.1f}" fill="#8E5216" opacity="0.6"/>')
    out.append(f'<ellipse cx="{cx - r * 0.4:.1f}" cy="{cy - r * 0.18:.1f}" rx="{r * 0.28:.1f}" ry="{r * 0.08:.1f}" fill="#FFFFFF" opacity="0.4"/>')
    return defs, "".join(out)


def mooncake_part():
    d, b = mooncake_body("mc", 24, 20, 20)
    art.part("mooncake", 48, 36, (24, 18), b, d)


def rabbit_mooncakes():
    """140 x 90 units (70 x 45 px), standing on the card's top edge at y = 78: a white rabbit beside two mooncakes on a plate."""
    rnd = random.Random(12)
    defs = (rad("fur", [(0, "#FFFFFF", None), (0.6, "#F4EEF4", None), (1, "#CFC4D9", None)], fx=0.35, fy=0.3) +
            rad("ear", [(0, "#FFC4D6", None), (1, "#F28FB0", None)]) +
            lin("plate", [(0, "#E9F2FF", None), (1, "#9EB3D6", None)]) +
            blur("rs", 2.5))
    body = ['<ellipse cx="70" cy="84" rx="62" ry="4" fill="#1A1430" opacity="0.3" filter="url(#rs)"/>']
    # The rabbit, sitting, facing right, on the left.
    body += [
        '<ellipse cx="38" cy="64" rx="24" ry="19" fill="url(#fur)"/>',  # body
        '<circle cx="16" cy="66" r="7" fill="url(#fur)"/><circle cx="14" cy="63.5" r="2.6" fill="#FFFFFF"/>',  # tail
        '<ellipse cx="54" cy="78" rx="8" ry="4" fill="#F4EEF4"/>',  # front paw
        '<path d="M44,30 C38,8 44,2 48,6 C52,10 52,24 50,32 Z" fill="url(#fur)"/>',  # far ear
        '<path d="M46,28 C43,14 46,9 48,11 C50,14 50,22 49,28 Z" fill="url(#ear)"/>',
        '<path d="M52,32 C52,8 60,4 63,9 C66,14 62,28 58,34 Z" fill="url(#fur)"/>',  # near ear
        '<path d="M55,30 C55,14 59,11 61,13 C63,17 60,26 57,31 Z" fill="url(#ear)"/>',
        '<circle cx="55" cy="44" r="16" fill="url(#fur)"/>',  # head
        '<circle cx="61" cy="42" r="2.6" fill="#3A2A4A"/><circle cx="60" cy="41" r="0.9" fill="#FFFFFF"/>',
        '<ellipse cx="69" cy="47" rx="2" ry="1.5" fill="#F28FB0"/>',
        '<path d="M69,49 q-2,3 -4,2 M69,49 q1,3 3,2" stroke="#B89AA8" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
        '<circle cx="62" cy="50" r="3.2" fill="#FFB6C8" opacity="0.45"/>',
        '<ellipse cx="47" cy="36" rx="6" ry="3" fill="#FFFFFF" opacity="0.8" transform="rotate(-30 47 36)"/>',
    ]
    body.append("".join(f'<path d="M{rnd.uniform(22, 52):.1f},{rnd.uniform(52, 76):.1f} q2,-1 3,1" stroke="#D9D0E2" stroke-width="0.8" fill="none" opacity="0.7"/>' for _ in range(18)))
    # The plate, and two mooncakes on it, one behind the other.
    body += ['<ellipse cx="104" cy="78" rx="32" ry="7" fill="url(#plate)"/>', '<ellipse cx="104" cy="76.5" rx="26" ry="5" fill="#F4F8FF" opacity="0.7"/>']
    for uid, (cx, cy, r) in (("a", (112, 58, 17)), ("b", (98, 68, 18))):
        d, b = mooncake_body(uid, cx, cy, r)
        defs += d
        body.append(b)
    art.still("rabbit-mooncakes", ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 90" width="70" height="45">\n'
                                   f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


for colour, (top, hue, glow) in LANTERNS.items():
    sky_lantern(f"lantern-{colour}", top, hue, glow)
moon()
cloud()
mooncake_part()
rabbit_mooncakes()

# The rig's layout, in the body's units: its origin at the left, the moon at
# (300, 0). Each lantern: its colour, where it sits, its size (nearer ones
# larger), how far it slides past the moon over one pass, and its bob.
art.finish(rig={
    "moon": [300, 0],
    "cloud": [330, 70],
    "length": 760,
    "lanterns": [
        {"part": "lantern-red", "at": [150, -40], "scale": 0.8, "slide": 130, "bob": 6},
        {"part": "lantern-gold", "at": [250, 90], "scale": 1.05, "slide": 170, "bob": 8},
        {"part": "lantern-saffron", "at": [360, -110], "scale": 0.65, "slide": 110, "bob": 5},
        {"part": "lantern-red", "at": [430, 40], "scale": 0.95, "slide": 160, "bob": 7},
        {"part": "lantern-gold", "at": [520, -60], "scale": 0.75, "slide": 120, "bob": 6},
    ],
})

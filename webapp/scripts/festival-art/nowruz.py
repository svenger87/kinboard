"""Nowruz's art (RFC-020 §3.3): goldfish swimming along the bottom of the
screen, as rigged parts (body, a two-segment fantail that whips, a dorsal
and a pectoral fin), in gold and in red and white; what a tap drops (an
apple, a gold coin and a painted egg, from the haft-sin); and the sabzeh,
sprouting wheatgrass along the cards' bottom edges, with its red ribbon.

    python3 webapp/scripts/festival-art/nowruz.py

The fish face right: the walk swims them left to right.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("nowruz")

# Two coats: a gold goldfish, and a red-and-white one.
COATS = {
    "": {"light": "#FFC15A", "mid": "#FF8A1F", "dark": "#D9580E", "belly": "#FFE3A3", "fin": "#FFA640", "fin_edge": "#FFE0A8", "patch": None},
    "-calico": {"light": "#FFF6EE", "mid": "#FBE6D8", "dark": "#E9C2AE", "belly": "#FFFFFF", "fin": "#FFD0B8", "fin_edge": "#FF9466", "patch": ("#FF6A3D", "#D93A1E")},
}

BODY_W, BODY_H, BODY_PIVOT = 150, 104, (78, 54)
# Where the parts join the body, in the body's drawing.
JOINTS = {"tail": [32, 54], "dorsal": [70, 26], "fin": [100, 70]}


def goldfish_body(suffix):
    c = COATS[suffix]
    rnd = random.Random(41)
    outline = "M28,47 C40,42 50,26 80,22 C108,20 132,32 140,50 C144,60 138,72 124,80 C108,90 82,90 60,84 C46,80 40,66 28,61 C26,57 26,51 28,47 Z"
    defs = (rad("skin", [(0, c["light"], None), (0.55, c["mid"], None), (1, c["dark"], None)], cx=0.42, cy=0.3, r=0.8) +
            lin("belly", [(0, c["belly"], 0), (1, c["belly"], 0.95)]) +
            rad("eye", [(0, "#3A2C4A", None), (1, "#120C1C", None)], fx=0.35, fy=0.3) +
            rad("iris", [(0, "#FFF6D8", None), (1, "#F4D28A", None)]) +
            rad("hi", [(0, "#FFFFFF", 0.6), (1, "#FFFFFF", 0)]) +
            f'<clipPath id="bodyClip"><path d="{outline}"/></clipPath>' +
            blur("soft", 2.5))
    body = [
        f'<path d="{outline}" fill="url(#skin)"/>',
        '<path d="M50,78 C70,90 104,90 126,78 C114,88 92,92 72,90 C62,89 54,84 50,78 Z" fill="url(#belly)"/>',
        f'<path d="M44,70 C64,86 108,88 132,70 L132,92 L44,92 Z" fill="url(#belly)" clip-path="url(#bodyClip)"/>',
    ]
    if c["patch"]:
        p1, p2 = c["patch"]
        body.append(f'<g clip-path="url(#bodyClip)"><path d="M62,18 C88,16 112,24 120,40 C110,48 94,46 84,54 C72,62 56,58 46,50 C42,38 50,24 62,18 Z" fill="{p1}"/>'
                    f'<path d="M62,18 C88,16 112,24 120,40 C110,40 96,36 80,40 C64,44 52,44 46,40 C48,30 54,22 62,18 Z" fill="{p2}" opacity="0.5"/>'
                    f'<path d="M30,48 C36,58 46,62 52,56 C48,48 40,44 30,48 Z" fill="{p1}"/></g>')
    # Scales: rows of soft arcs, lighter on the upper edge, fading toward the head.
    scales = []
    for row in range(5):
        for col in range(7):
            x = 46 + col * 11 + (row % 2) * 5.5
            y = 34 + row * 10
            if x > 116 - row * 2:
                continue
            o = 0.35 * (1 - (x - 46) / 90)
            scales.append(f'<path d="M{x - 5},{y} Q{x},{y + 7} {x + 5},{y}" stroke="#FFFFFF" stroke-width="1.3" fill="none" opacity="{o + 0.12:.2f}"/>'
                          f'<path d="M{x - 5},{y + 1.5} Q{x},{y + 8.5} {x + 5},{y + 1.5}" stroke="{c["dark"]}" stroke-width="1" fill="none" opacity="{o * 0.8:.2f}"/>')
    body.append(f'<g clip-path="url(#bodyClip)">{"".join(scales)}</g>')
    body += [
        # The gill's curve, the cheek's blush.
        f'<path d="M108,34 C100,48 100,64 110,78" stroke="{c["dark"]}" stroke-width="2.2" fill="none" opacity="0.45" stroke-linecap="round"/>',
        f'<path d="M110,36 C103,48 103,62 112,74" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.4" stroke-linecap="round"/>',
        '<ellipse cx="124" cy="62" rx="7" ry="4.5" fill="#FF6F8A" opacity="0.4" filter="url(#soft)"/>',
        # The pelvic and anal fins, drawn in (they barely move).
        f'<path d="M86,86 C84,96 92,102 98,100 C96,94 96,90 96,86 Z" fill="{c["fin"]}" opacity="0.85"/>',
        f'<path d="M54,82 C48,92 54,98 60,98 C60,92 62,88 64,84 Z" fill="{c["fin"]}" opacity="0.8"/>',
        # A big round eye with a gold iris and two catchlights.
        '<circle cx="120" cy="44" r="10.5" fill="url(#iris)"/>',
        '<circle cx="121.5" cy="44.5" r="7.5" fill="url(#eye)"/>',
        '<circle cx="118" cy="40.5" r="2.8" fill="#FFFFFF"/><circle cx="124" cy="48" r="1.2" fill="#FFFFFF" opacity="0.8"/>',
        # The little round mouth.
        f'<ellipse cx="141" cy="57" rx="2.6" ry="3.4" fill="{c["dark"]}"/><ellipse cx="141.6" cy="57" rx="1.3" ry="2" fill="#7A2A10" opacity="0.7"/>',
        # The light, from the top left: a long soft sheen along the back.
        '<ellipse cx="82" cy="34" rx="34" ry="8" fill="url(#hi)" transform="rotate(-6 82 34)"/>',
        '<path d="M52,38 C66,28 92,25 112,28" stroke="#FFFFFF" stroke-width="2.5" fill="none" opacity="0.45" stroke-linecap="round"/>',
    ]
    # A few glints of scale, seeded.
    for _ in range(6):
        x, y = rnd.uniform(56, 104), rnd.uniform(34, 52)
        body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rnd.uniform(0.8, 1.5):.1f}" fill="#FFFFFF" opacity="{rnd.uniform(0.5, 0.85):.2f}"/>')
    art.part(f"goldfish-body{suffix}", BODY_W, BODY_H, BODY_PIVOT, "\n".join(body), defs,
             f"pivot at the body's middle {BODY_PIVOT}; the tail joins at {JOINTS['tail']}, the dorsal fin at {JOINTS['dorsal']}, the pectoral at {JOINTS['fin']}")


def fin_defs(c, uid, x1=1, x2=0):
    return lin(uid, [(0, c["fin"], 1), (0.65, c["fin"], 0.9), (1, c["fin_edge"], 0.82)], x1, 0, x2, 0)


def rays(paths, c, o=0.35):
    return "".join(f'<path d="{d}" stroke="{c["dark"]}" stroke-width="1" fill="none" opacity="{o}" stroke-linecap="round"/>' for d in paths)


def tail_base(suffix):
    """The tail's root: short and strong, from the body to where the fan opens. Pivot at the body (right)."""
    c = COATS[suffix]
    W, H = 42, 48
    # A root as tall as the peduncle (16) where it tucks under the body, flaring to the fan.
    body = (f'<path d="M42,17 C30,17 18,12 4,6 C1,14 1,34 4,42 C18,36 30,31 42,31 Z" fill="url(#f)"/>'
            + rays(["M36,19 C24,18 14,14 5,10", "M36,24 L4,24", "M36,29 C24,30 14,34 5,38"], c)
            + '<path d="M34,18 C22,16 14,12 6,8" stroke="#FFFFFF" stroke-width="1.5" fill="none" opacity="0.45" stroke-linecap="round"/>')
    art.part(f"goldfish-tail-base{suffix}", W, H, (34, 24), body, fin_defs(c, "f"), "pivot at the peduncle (34,24), its right end under the body; the fan hangs at (4,24)")


def tail_fan(suffix):
    """The fantail: two flowing lobes, split, rays and a lighter edge. Pivot at its root (right)."""
    c = COATS[suffix]
    W, H = 70, 100
    lobes = ("M68,42 C56,30 40,10 14,4 C6,4 2,10 8,16 C14,24 22,30 28,36 C16,34 8,40 10,48 "
             "C8,56 16,64 28,62 C22,68 14,76 8,84 C2,90 6,96 14,96 C40,90 56,70 68,58 Z")
    body = (f'<clipPath id="fan"><path d="{lobes}"/></clipPath><path d="{lobes}" fill="url(#f)"/>'
            + '<g clip-path="url(#fan)">'
            + rays(["M66,46 C50,34 32,18 12,8", "M66,48 C48,42 30,36 16,30", "M66,50 C48,50 28,48 12,48",
                    "M66,52 C48,58 30,62 16,66", "M66,54 C50,66 32,82 12,92"], c, 0.3)
            # The fan's thin outer edge, lighter, as a fin is.
            + f'<path d="{lobes}" stroke="{c["fin_edge"]}" stroke-width="5" fill="none" opacity="0.55"/>'
            + '</g>'
            + '<path d="M60,40 C48,28 34,16 18,10" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.45" stroke-linecap="round"/>')
    art.part(f"goldfish-tail-fan{suffix}", W, H, (68, 50), body, fin_defs(c, "f"), "pivot at its root (68,50): it whips after the base")


def dorsal(suffix):
    c = COATS[suffix]
    W, H = 64, 40
    body = (f'<path d="M60,40 C56,22 36,4 14,2 C8,2 6,8 10,12 C18,20 20,30 20,40 Z" fill="url(#f)"/>'
            + rays(["M54,30 C46,20 34,10 16,5", "M44,31 C38,22 28,14 14,9", "M32,31 C28,24 22,18 14,14"], c, 0.3)
            + '<path d="M50,24 C42,14 30,6 16,4" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity="0.5" stroke-linecap="round"/>')
    art.part(f"goldfish-dorsal{suffix}", W, H, (40, 34), body, fin_defs(c, "f", 0, 1), "pivot at its base (40,34), tucked under the back")


def pectoral(suffix):
    c = COATS[suffix]
    W, H = 36, 28
    body = (f'<path d="M30,4 C20,4 6,10 4,20 C4,26 12,26 18,22 C24,18 30,12 32,6 Z" fill="url(#f)"/>'
            + rays(["M30,6 C22,10 12,16 6,22", "M30,8 C24,14 18,20 12,24"], c, 0.3))
    art.part(f"goldfish-fin{suffix}", W, H, (30, 5), body, fin_defs(c, "f"), "pivot at its root (30,5): it paddles")


# ---------------------------------------------------------------- what a tap drops: from the haft-sin
def apple():
    defs = (rad("a", [(0, "#FF8A80", None), (0.5, "#E8323A", None), (1, "#9E1420", None)], cx=0.35, cy=0.3, r=0.8) +
            lin("leaf", [(0, "#8FE3A4", None), (1, "#2FA65E", None)]))
    body = ('<path d="M20,11 C12,6 3,11 4,22 C5,32 12,38 20,36 C28,38 35,32 36,22 C37,11 28,6 20,11 Z" fill="url(#a)"/>'
            '<path d="M20,11 C20,7 21,4 23,2" stroke="#6B4423" stroke-width="2" fill="none" stroke-linecap="round"/>'
            '<path d="M22,6 C26,1 33,2 34,5 C30,8 25,8 22,6 Z" fill="url(#leaf)"/>'
            '<ellipse cx="12" cy="17" rx="4" ry="2.5" fill="#FFFFFF" opacity="0.6" transform="rotate(-40 12 17)"/>')
    art.part("apple", 40, 40, (20, 20), body, defs, "dropped by a tap: the sib of the haft-sin")


def coin():
    defs = rad("g", [(0, "#FFF0A8", None), (0.5, "#F2C23A", None), (1, "#A8741A", None)], cx=0.35, cy=0.3, r=0.75)
    body = ('<ellipse cx="20" cy="21.5" rx="15" ry="14" fill="#A8741A"/><ellipse cx="20" cy="20" rx="15" ry="14" fill="url(#g)"/>'
            '<ellipse cx="20" cy="20" rx="11" ry="10.2" fill="none" stroke="#A8741A" stroke-width="1.2" opacity="0.5"/>'
            '<path d="M20,13 L21.8,18 L27,18.2 L22.8,21.4 L24.3,26.5 L20,23.5 L15.7,26.5 L17.2,21.4 L13,18.2 L18.2,18 Z" fill="#A8741A" opacity="0.4"/>'
            '<ellipse cx="14" cy="13" rx="4.5" ry="2.4" fill="#FFFFFF" opacity="0.7" transform="rotate(-30 14 13)"/>')
    art.part("coin", 40, 40, (20, 20), body, defs, "dropped by a tap: the sekkeh of the haft-sin")


def egg():
    defs = (rad("e", [(0, "#9EE8FF", None), (0.6, "#2FB8D9", None), (1, "#1A7F9E", None)], cx=0.35, cy=0.3, r=0.8))
    body = ('<path d="M20,3 C30,3 35,18 35,25 C35,33 28,38 20,38 C12,38 5,33 5,25 C5,18 10,3 20,3 Z" fill="url(#e)"/>'
            '<path d="M6.5,20 Q13,15 20,20 Q27,25 33.5,20" stroke="#FFD24A" stroke-width="2.6" fill="none"/>'
            '<path d="M5.5,28 Q13,24 20,28 Q27,32 34.5,28" stroke="#FF6F8A" stroke-width="2.2" fill="none"/>'
            '<circle cx="14" cy="13" r="1.6" fill="#FFFFFF"/><circle cx="20" cy="11" r="1.6" fill="#FFD24A"/><circle cx="26" cy="13" r="1.6" fill="#FFFFFF"/>'
            '<ellipse cx="13" cy="10" rx="3.5" ry="2" fill="#FFFFFF" opacity="0.55" transform="rotate(-40 13 10)"/>')
    art.part("egg", 40, 40, (20, 20), body, defs, "dropped by a tap: a painted egg")


# ---------------------------------------------------------------- the dressing: sabzeh along the bottom edge
def sabzeh():
    """A 120 x 20 tile of young wheatgrass, repeated in the gap under a card's bottom edge (at 120 x 16 px), the tips reaching up to the edge."""
    rnd = random.Random(43)
    W, H = 120, 20
    defs = (lin("blade", [(0, "#C8F07A", None), (0.45, "#6CCB4A", None), (1, "#2E8A3A", None)]) +
            lin("blade2", [(0, "#A6E86A", None), (0.5, "#4DB848", None), (1, "#24732F", None)]) +
            lin("base", [(0, "#2E8A3A", 0), (1, "#1E5E28", 0.55)]))
    blades = []
    for layer, (n, hmin, hmax, grad, op) in enumerate(((70, 6, 12, "blade2", 0.85), (64, 9, 18, "blade", 1.0))):
        for i in range(n):
            x = 1 + (W - 2) * (i + rnd.uniform(0, 1)) / n
            h = rnd.uniform(hmin, hmax)
            lean = rnd.uniform(-2.5, 3.5)
            w = rnd.uniform(1.3, 2.1)
            # Each blade a thin leaf: up one side, a curved tip, down the other.
            blades.append(f'<path d="M{x - w / 2:.2f},{H} Q{x - w / 2 + lean * 0.3:.2f},{H - h * 0.6:.2f} {x + lean:.2f},{H - h:.2f} '
                          f'Q{x + w / 2 + lean * 0.35:.2f},{H - h * 0.55:.2f} {x + w / 2:.2f},{H} Z" fill="url(#{grad})" opacity="{op}"/>')
    art.still("sabzeh", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="none">\n'
                         f"<defs>{defs}</defs>\n" + "\n".join(blades) + f'\n<rect x="0" y="{H - 3}" width="{W}" height="3" fill="url(#base)"/>\n</svg>\n'))


def ribbon():
    """A 34 x 20 red ribbon tied round the grass: a bow and two tails, satin-lit from the top left."""
    W, H = 34, 20
    defs = (lin("r", [(0, "#FF6B7A", None), (0.5, "#E02D45", None), (1, "#9E1428", None)], 0, 0, 0.4, 1))
    body = ('<path d="M17,11 C12,4 3,3 3,8 C3,13 11,14 17,11 Z" fill="url(#r)"/>'
            '<path d="M17,11 C22,4 31,3 31,8 C31,13 23,14 17,11 Z" fill="url(#r)"/>'
            '<path d="M16,12 C14,15 11,18 8,19 L11,20 C13,18 15,16 17,13 Z" fill="#C21E38"/>'
            '<path d="M18,12 C20,15 23,18 26,19 L23,20 C21,18 19,16 17,13 Z" fill="#C21E38"/>'
            '<ellipse cx="17" cy="11" rx="3" ry="2.6" fill="#E02D45"/>'
            '<path d="M6,6.5 C8,5 11,5.5 13,7.5" stroke="#FFFFFF" stroke-width="1.1" fill="none" opacity="0.55" stroke-linecap="round"/>'
            '<path d="M21,7.5 C23,5.5 26,5 28,6.5" stroke="#FFFFFF" stroke-width="1.1" fill="none" opacity="0.4" stroke-linecap="round"/>')
    art.still("ribbon", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
                         f"<defs>{defs}</defs>\n{body}\n</svg>\n"))


for suffix in COATS:
    goldfish_body(suffix); tail_base(suffix); tail_fan(suffix); dorsal(suffix); pectoral(suffix)
apple(); coin(); egg()
sabzeh(); ribbon()

art.finish(rig={
    "joints": JOINTS,
    # Where the fan hangs from the tail's root, in the root's drawing.
    "fan": [4, 24],
    # A swim stroke, one per walk step: the tail sweeps, the fan whips after
    # it, the body counters the tail a little, the fins paddle. Degrees.
    "swim": {
        "period": 0.9,
        "tail": [18, 0.0],
        "fan": [22, -0.14],
        "body": [2.5, 0.5],
        "dorsal": [6, -0.1],
        "fin": [24, 0.2],
    },
})

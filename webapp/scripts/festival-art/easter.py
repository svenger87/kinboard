"""Easter's art (RFC-020 §3.3), for Easter and Orthodox Easter: the bunny
that hops along the bottom of the screen, as rigged parts (body, head, two
ears, a haunch and a long foot each side, two forelegs, the tail) in two
coats, caramel and white, with its hop as keyframed curves; the painted
eggs a tap drops; the bunting along the cards' top edges; and the eggs in
a nest of grass at a card's corner, painted for Easter and dyed red for
Orthodox Easter.

    python3 webapp/scripts/festival-art/easter.py

Both kits fly these drawings (kits/orthodox-easter.ts borrows this folder),
so there is one script and one copy of each. The bunny faces right.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur, fur

art = Art("easter")

COATS = {
    # A caramel bunny, and a white one with grey-cream shading.
    "": {"light": "#F2D3AE", "mid": "#D9AE80", "dark": "#A97B52", "deep": "#8A603C", "cream": "#FFF4E3",
         "far": ("#B88E64", "#8A633F"), "fur": ("#A97B52", "#F7E2C6", "#C49468")},
    "-white": {"light": "#FFFFFF", "mid": "#F1ECE6", "dark": "#CFC6BC", "deep": "#ADA297", "cream": "#FFFFFF",
               "far": ("#D6CDC3", "#B3A89C"), "fur": ("#CFC6BC", "#FFFFFF", "#E2DAD1")},
}
PINK, PINK_DARK = "#FFB3C4", "#E87E98"

# Where the parts join the body, in the body's drawing (pivot (80, 60)).
BODY = {"w": 150, "h": 110, "pivot": [80, 60], "hip": [50, 62], "shoulder": [112, 66], "neck": [120, 36], "tail": [22, 46]}
HEAD = {"w": 104, "h": 100, "pivot": [30, 82], "ear": [48, 24], "ear_far": [38, 26]}
THIGH = {"w": 64, "h": 64, "pivot": [32, 20], "hock": [34, 50]}
FOOT = {"w": 74, "h": 26, "pivot": [12, 10], "sole": 22}
FORE = {"w": 26, "h": 50, "pivot": [13, 6], "paw": 48}


def body(sfx):
    c = COATS[sfx]
    rnd = random.Random(61)
    W, H = BODY["w"], BODY["h"]
    shape = "M128,40 C120,22 94,17 70,21 C40,25 12,40 11,62 C10,84 30,98 58,98 C80,98 100,95 116,87 C134,78 141,57 128,40 Z"
    defs = (rad("coat", [(0, c["light"], None), (0.55, c["mid"], None), (1, c["dark"], None)], cx=0.38, cy=0.22, r=0.85) +
            lin("belly", [(0, c["cream"], 0), (0.5, c["cream"], 0.9), (1, c["cream"], 1)]) +
            rad("hi", [(0, "#FFFFFF", 0.55), (1, "#FFFFFF", 0)]) +
            f'<clipPath id="bc"><path d="{shape}"/></clipPath>' + blur("soft", 3))
    out = [
        f'<path d="{shape}" fill="url(#coat)"/>',
        '<path d="M64,96 C92,98 114,90 126,76 C132,68 135,60 133,52 C124,70 102,84 64,90 Z" fill="url(#belly)" clip-path="url(#bc)"/>',
        fur(rnd, 70, 52, 58, 32, 110, list(c["fur"]), length=(4, 7), width=1.1, tilt=-0.25, opacity=(0.15, 0.38), clip="bc"),
        # The chest's fluff, at the front.
        f'<path d="M124,42 C138,46 142,62 134,74 C130,80 122,82 118,78 C126,68 128,54 124,42 Z" fill="{c["cream"]}"/>',
        fur(rnd, 130, 60, 6, 14, 26, [c["cream"], "#FFFFFF", c["fur"][2]], length=(3, 6), tilt=1.3, opacity=(0.5, 0.9)),
        # The light along the back, from the top left; the shade under the belly.
        '<ellipse cx="66" cy="34" rx="40" ry="11" fill="url(#hi)" transform="rotate(-10 66 34)"/>',
        f'<path d="M30,90 C50,100 92,100 112,90" stroke="{c["deep"]}" stroke-width="5" fill="none" opacity="0.2" filter="url(#soft)"/>',
    ]
    art.part(f"bunny-body{sfx}", W, H, BODY["pivot"], "\n".join(out), defs,
             f"pivot at the middle; hip {BODY['hip']}, shoulder {BODY['shoulder']}, neck {BODY['neck']}, tail {BODY['tail']}")


def head(sfx):
    c = COATS[sfx]
    rnd = random.Random(62)
    W, H = HEAD["w"], HEAD["h"]
    skull = "M22,52 C20,30 36,18 54,18 C72,18 84,30 86,42 C96,44 100,54 96,62 C92,72 80,76 68,76 C54,78 38,76 30,70 C24,66 22,60 22,52 Z"
    defs = (rad("coat", [(0, c["light"], None), (0.6, c["mid"], None), (1, c["dark"], None)], cx=0.35, cy=0.25, r=0.85) +
            rad("muzzle", [(0, "#FFFFFF", None), (1, c["cream"], None)], cx=0.4, cy=0.35) +
            rad("eye", [(0, "#4A3A5C", None), (1, "#160F24", None)], fx=0.35, fy=0.3) +
            rad("nose", [(0, "#FFC2D0", None), (1, PINK_DARK, None)], fx=0.35, fy=0.3) +
            lin("bow", [(0, "#FFE680", None), (1, "#F2B91F", None)], 0, 0, 0.3, 1) +
            f'<clipPath id="hc"><path d="{skull}"/></clipPath>' + blur("soft", 2))
    out = [
        # The neck, down into the body.
        '<path d="M12,98 C10,84 14,70 26,62 L52,66 C50,78 44,90 46,98 Z" fill="url(#coat)"/>',
        f'<path d="{skull}" fill="url(#coat)"/>',
        fur(rnd, 50, 42, 26, 20, 40, list(c["fur"]), length=(3, 5), width=1, tilt=-0.2, opacity=(0.15, 0.35), clip="hc"),
        # Cheek fluff and the muzzle.
        f'<path d="M28,64 C24,72 30,80 40,78 C36,74 36,70 38,66 Z" fill="{c["cream"]}"/>',
        '<ellipse cx="80" cy="60" rx="17" ry="13" fill="url(#muzzle)"/>',
        '<ellipse cx="70" cy="64" rx="7" ry="4.5" fill="#FF8FA3" opacity="0.45" filter="url(#soft)"/>',
        # The eye: dark, round, two catchlights, a lid and lashes.
        '<ellipse cx="62" cy="44" rx="7.5" ry="8.5" fill="url(#eye)"/>',
        '<circle cx="59.5" cy="40.5" r="2.8" fill="#FFFFFF"/><circle cx="64.5" cy="48" r="1.2" fill="#FFFFFF" opacity="0.8"/>',
        f'<path d="M54,38 C58,33 66,33 70,37" stroke="{c["deep"]}" stroke-width="2" fill="none" stroke-linecap="round"/>',
        f'<path d="M56,35.5 l-2.5,-3.5 M60,34 l-1,-4 M64.5,34 l0.5,-4" stroke="{c["deep"]}" stroke-width="1.2" stroke-linecap="round"/>',
        # The nose, the split lip, the whiskers.
        '<path d="M92,52 C96,50 99,53 97,57 C95,60 92,59 91,56 C90,54 90,53 92,52 Z" fill="url(#nose)"/>',
        '<ellipse cx="93.5" cy="53" rx="1.4" ry="1" fill="#FFFFFF" opacity="0.8"/>',
        f'<path d="M94,59 C94,63 91,66 87,65 M94,59 C95,63 97,65 99,65" stroke="{c["deep"]}" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
        '<path d="M88,60 C94,58 100,58 104,57 M88,62 C94,62 100,63 104,64 M86,58 C92,54 98,52 102,50" stroke="#FFFFFF" stroke-width="0.8" fill="none" opacity="0.7"/>',
        f'<path d="M88,60.5 C94,58.5 100,58.5 104,57.5 M88,62.5 C94,62.5 100,63.5 104,64.5" stroke="{c["deep"]}" stroke-width="0.6" fill="none" opacity="0.35"/>',
        # The light on the crown of the head.
        '<ellipse cx="46" cy="28" rx="16" ry="6" fill="#FFFFFF" opacity="0.4" transform="rotate(-18 46 28)"/>',
        # A yellow bow at the neck.
        '<path d="M32,84 C22,74 12,78 14,86 C16,94 26,92 32,86 Z" fill="url(#bow)"/>',
        '<path d="M32,84 C40,72 52,76 50,84 C48,92 38,92 32,86 Z" fill="url(#bow)"/>',
        '<path d="M31,86 C28,92 24,96 20,98 M33,86 C36,92 40,96 44,98" stroke="#E6A817" stroke-width="3" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="32" cy="85" rx="4" ry="3.6" fill="#F2B91F"/>',
        '<path d="M18,82 C20,79 24,79 26,81 M38,79 C41,77 45,77 47,80" stroke="#FFFFFF" stroke-width="1.3" fill="none" opacity="0.6" stroke-linecap="round"/>',
    ]
    art.part(f"bunny-head{sfx}", W, H, HEAD["pivot"], "\n".join(out), defs,
             f"pivot at the base of the neck {HEAD['pivot']}; ears at {HEAD['ear']} (near) and {HEAD['ear_far']} (far)")


def ear(sfx, far):
    c = COATS[sfx]
    W, H = 32, 86
    outer, edge = (c["far"][0], c["far"][1]) if far else (c["mid"], c["dark"])
    defs = (lin("e", [(0, c["light"] if not far else outer, None), (1, edge, None)], 0, 0, 1, 0.3) +
            lin("in", [(0, "#FFD3DD" if not far else "#E8A2B4", None), (1, PINK if not far else "#C9778E", None)], 0, 0, 0, 1))
    out = ('<path d="M16,84 C6,72 3,42 9,15 C11,4 23,4 25,15 C30,42 27,72 16,84 Z" fill="url(#e)"/>'
           '<path d="M16,76 C10,64 10,42 13,21 C14.5,14 19.5,14 21,21 C24,42 22,64 16,76 Z" fill="url(#in)"/>'
           + ('' if far else '<path d="M11,52 C10,38 11,24 14,14" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.55" stroke-linecap="round"/>'))
    art.part(f"bunny-ear{'-far' if far else ''}{sfx}", W, H, (16, 82), out, defs, "pivot at its root (16,82): it lags the hop and blows back in the wind")


def thigh(sfx, far):
    c = COATS[sfx]
    W, H = THIGH["w"], THIGH["h"]
    c1, c2 = c["far"] if far else (c["light"], c["dark"])
    defs = rad("t", [(0, c1, None), (0.6, c2 if far else c["mid"], None), (1, c2, None)], cx=0.35, cy=0.25, r=0.8)
    out = ('<path d="M8,26 C8,8 26,2 40,6 C56,10 62,28 56,42 C52,52 44,58 34,58 C24,58 16,52 12,44 C8,38 8,32 8,26 Z" fill="url(#t)"/>'
           + ('' if far else
              f'<path d="M16,20 C22,10 36,8 46,14" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.35" stroke-linecap="round"/>'
              f'<path d="M14,44 C22,54 36,58 48,52" stroke="{c["deep"]}" stroke-width="2" fill="none" opacity="0.25" stroke-linecap="round"/>'))
    art.part(f"bunny-thigh{'-far' if far else ''}{sfx}", W, H, THIGH["pivot"], out, defs, f"the haunch; pivot at the hip {THIGH['pivot']}, the hock at {THIGH['hock']}")


def foot(sfx, far):
    c = COATS[sfx]
    W, H = FOOT["w"], FOOT["h"]
    c1, c2 = c["far"] if far else (c["mid"], c["dark"])
    defs = lin("f", [(0, c1, None), (1, c2, None)], 0, 0, 0, 1)
    out = ('<path d="M3,10 C3,2 18,1 28,4 L60,8 C70,10 72,20 64,22 L12,23 C5,23 2,17 3,10 Z" fill="url(#f)"/>'
           + (f'<path d="M14,22 L62,21 C66,21 68,19 68,17" stroke="{PINK if not far else "#C9778E"}" stroke-width="2.4" fill="none" opacity="0.7" stroke-linecap="round"/>'
              f'<path d="M58,10 L62,16 M64,11 L67,16" stroke="{c["deep"]}" stroke-width="1" opacity="0.4" stroke-linecap="round"/>'
              + ('' if far else '<path d="M10,6 C20,3 32,5 46,7" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.4" stroke-linecap="round"/>')))
    art.part(f"bunny-foot{'-far' if far else ''}{sfx}", W, H, FOOT["pivot"], out, defs, f"the long hind foot; pivot at the heel {FOOT['pivot']}, toes forward")


def fore(sfx, far):
    c = COATS[sfx]
    W, H = FORE["w"], FORE["h"]
    c1, c2 = c["far"] if far else (c["mid"], c["dark"])
    defs = lin("l", [(0, c1, None), (1, c2, None)], 0, 0, 1, 0)
    out = ('<path d="M5,6 C5,0 21,0 21,6 L20,38 L6,38 Z" fill="url(#l)"/>'
           f'<ellipse cx="14" cy="41" rx="10" ry="7" fill="{c["cream"] if not far else c1}"/>'
           f'<path d="M12,46 L12,42 M16,46 L16,42" stroke="{c["deep"]}" stroke-width="1" opacity="0.35" stroke-linecap="round"/>'
           + ('' if far else '<path d="M8,8 L9,32" stroke="#FFFFFF" stroke-width="2.4" opacity="0.35" stroke-linecap="round"/>'))
    art.part(f"bunny-fore{'-far' if far else ''}{sfx}", W, H, FORE["pivot"], out, defs, f"a foreleg; pivot at the shoulder {FORE['pivot']}")


def tail(sfx):
    c = COATS[sfx]
    rnd = random.Random(63)
    defs = rad("p", [(0, "#FFFFFF", None), (0.7, c["cream"], None), (1, "#E6DCCF", None)], cx=0.35, cy=0.3)
    puffs = "".join(f'<circle cx="{14 + math.cos(a) * 6:.1f}" cy="{15 + math.sin(a) * 6:.1f}" r="{rnd.uniform(6.5, 8):.1f}" fill="url(#p)"/>'
                    for a in [i * 2 * math.pi / 6 for i in range(6)])
    out = puffs + '<circle cx="14" cy="15" r="8" fill="url(#p)"/><ellipse cx="10" cy="10" rx="4" ry="2.5" fill="#FFFFFF" opacity="0.9"/>'
    art.part(f"bunny-tail{sfx}", 32, 30, (26, 15), out, defs, "the cotton tail; pivot at its root (26,15): it flicks")


# ---------------------------------------------------------------- the eggs
EGGS = {
    # base light, base, base dark, pattern colours
    "egg-blue": ("#B8E6FF", "#5AB0FF", "#2F7FD9", ("#FFE066", "#FFFFFF")),
    "egg-pink": ("#FFD3E0", "#FF8FB1", "#D9577A", ("#FFFFFF", "#9BE3B4")),
    "egg-yellow": ("#FFF6B8", "#FFD84A", "#E0A419", ("#FF8FB1", "#7FC8FF")),
    "egg-green": ("#D2F5C8", "#7FD69A", "#3FA86A", ("#FFFFFF", "#FFB3C4")),
    # Orthodox Easter's: dyed deep red, glossy, no pattern.
    "egg-red": ("#FF8A80", "#D9232E", "#8E0F1A", None),
}
EGG_PATH = "M0,-17 C8,-17 13,-4 13,4 C13,12 7,17 0,17 C-7,17 -13,12 -13,4 C-13,-4 -8,-17 0,-17 Z"


def egg_svg(name, x, y, s, turn, uid):
    """An egg, centred at (x, y), `s` times 26 x 34 units, its painted bands and dots; its gradient is `uid`."""
    hi, base, low, pat = EGGS[name]
    clip = f"{uid}Clip"
    out = [f'<g transform="translate({x:.2f} {y:.2f}) rotate({turn:.1f}) scale({s:.3f})">',
           f'<clipPath id="{clip}"><path d="{EGG_PATH}"/></clipPath>',
           f'<path d="{EGG_PATH}" fill="url(#{uid})"/>']
    if pat:
        a, b = pat
        out.append(f'<g clip-path="url(#{clip})">'
                   f'<path d="M-14,-2 Q-7,-7 0,-2 Q7,3 14,-2 L14,3 Q7,8 0,3 Q-7,-2 -14,3 Z" fill="{a}"/>'
                   f'<path d="M-14,9 L-9,5 L-4,9 L1,5 L6,9 L11,5 L14,8" stroke="{b}" stroke-width="2.2" fill="none" stroke-linejoin="round"/>'
                   f'<circle cx="-5" cy="-10" r="1.6" fill="{b}"/><circle cx="2" cy="-12" r="1.6" fill="{a}"/><circle cx="7" cy="-8" r="1.4" fill="{b}"/>'
                   "</g>")
    # Shade on the lower right, and the gloss on the upper left.
    out.append(f'<path d="M10,-4 C14,6 10,15 0,17 C8,12 11,4 10,-4 Z" fill="{low}" opacity="0.35"/>')
    out.append('<ellipse cx="-5.5" cy="-8" rx="3.2" ry="5.5" fill="#FFFFFF" opacity="0.55" transform="rotate(20 -5.5 -8)"/>')
    out.append("</g>")
    return "".join(out)


def egg_grad(name, uid):
    hi, base, low, _ = EGGS[name]
    return rad(uid, [(0, hi, None), (0.5, base, None), (1, low, None)], cx=0.38, cy=0.3, r=0.8)


def egg_part(name):
    art.part(name, 40, 40, (20, 20), egg_svg(name, 20, 20, 1.0, -12, "g"), egg_grad(name, "g"), "dropped by a tap")


# ---------------------------------------------------------------- the dressing
PENNANTS = [("#FFB3C4", "#E87E98"), ("#FFE680", "#E8B820"), ("#9BE3B4", "#4DB87A"), ("#A8D8FF", "#5AA0E0")]


def bunting():
    """A 96 x 18 tile of bunting, repeated along a card's top edge: a string sagging between two pins, four pennants on it.

    The kit hangs it wholly outside the card, in the grid's gap, ending at
    the card's edge (a card's content can start at its very first pixel),
    so the whole drawing may be seen; CSS draws it at 85 x 16 px, above the edge.
    """
    W, H = 96, 18
    defs = "".join(lin(f"p{i}", [(0, a, None), (1, b, None)], 0, 0, 0.6, 1) for i, (a, b) in enumerate(PENNANTS))
    sag = lambda x: 2.2 + 4.2 * math.sin(math.pi * x / W)
    out = [f'<path d="M0,{sag(0):.2f} Q{W / 2},{sag(W / 2) * 2 - 2.2:.2f} {W},{sag(W):.2f}" stroke="#B88A5A" stroke-width="1.1" fill="none"/>']
    for i in range(4):
        x0 = 6 + i * 22.5
        x1 = x0 + 17
        y0, y1 = sag(x0), sag(x1)
        tip = ((x0 + x1) / 2 + 0.6, max(y0, y1) + 11.2)
        out.append(f'<path d="M{x0:.2f},{y0:.2f} L{x1:.2f},{y1:.2f} L{tip[0]:.2f},{tip[1]:.2f} Z" fill="url(#p{i})"/>')
        # A row of dots, and the light on the left edge of each.
        mx = (x0 + x1) / 2
        out.append(f'<circle cx="{mx - 3:.2f}" cy="{(y0 + y1) / 2 + 3.2:.2f}" r="1" fill="#FFFFFF" opacity="0.75"/>'
                   f'<circle cx="{mx + 3:.2f}" cy="{(y0 + y1) / 2 + 3.2:.2f}" r="1" fill="#FFFFFF" opacity="0.75"/>'
                   f'<circle cx="{mx:.2f}" cy="{(y0 + y1) / 2 + 6.5:.2f}" r="1" fill="#FFFFFF" opacity="0.75"/>')
        out.append(f'<path d="M{x0 + 1.5:.2f},{y0 + 1:.2f} L{tip[0] - 1:.2f},{tip[1] - 2.5:.2f}" stroke="#FFFFFF" stroke-width="1" opacity="0.45" stroke-linecap="round"/>')
        out.append(f'<path d="M{x0 + 0.5:.2f},{y0 + 0.9:.2f} L{x1 - 0.5:.2f},{y1 + 0.9:.2f}" stroke="{PENNANTS[i][1]}" stroke-width="1.3" opacity="0.7" stroke-linecap="round"/>')
    # The pins it hangs from.
    out.append(f'<circle cx="0.8" cy="{sag(0):.2f}" r="1.3" fill="#E8B820"/><circle cx="{W - 0.8}" cy="{sag(W):.2f}" r="1.3" fill="#E8B820"/>')
    art.still("bunting", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="none">\n'
                          f"<defs>{defs}</defs>\n" + "\n".join(out) + "\n</svg>\n"))


def nest(name, eggs):
    """60 x 26: eggs in a tuft of grass, drawn at 46 x 20 px in the gap under a card's bottom corner, its top at the card's edge."""
    rnd = random.Random(64)
    W, H = 60, 26
    defs = (lin("g1", [(0, "#C8F07A", None), (1, "#3E9A3E", None)]) + lin("g2", [(0, "#9BE36A", None), (1, "#2E7A32", None)]) +
            "".join(egg_grad(e, f"e{i}") for i, (e, *_r) in enumerate(eggs)) +
            '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>')

    def grass(n, x0, x1, hmin, hmax, grad):
        out = []
        for i in range(n):
            x = x0 + (x1 - x0) * (i + rnd.uniform(0, 1)) / n
            h = rnd.uniform(hmin, hmax)
            lean = rnd.uniform(-3, 3)
            out.append(f'<path d="M{x - 0.8:.2f},{H - 2} Q{x + lean * 0.3:.2f},{H - 2 - h * 0.6:.2f} {x + lean:.2f},{H - 2 - h:.2f} Q{x + 0.8 + lean * 0.3:.2f},{H - 2 - h * 0.5:.2f} {x + 0.8:.2f},{H - 2} Z" fill="url(#{grad})"/>')
        return "".join(out)

    out = [f'<ellipse cx="30" cy="{H - 2}" rx="26" ry="2.5" fill="#1E3A1A" opacity="0.25" filter="url(#soft)"/>',
           grass(22, 4, 56, 5, 11, "g2")]
    for i, (e, x, y, s, t) in enumerate(eggs):
        out.append(egg_svg(e, x, y, s, t, f"e{i}"))
    out.append(grass(26, 3, 57, 3, 8, "g1"))
    art.still(name, (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
                     f"<defs>{defs}</defs>\n" + "\n".join(out) + "\n</svg>\n"))


for sfx in COATS:
    body(sfx); head(sfx); tail(sfx)
    for far in (False, True):
        ear(sfx, far); thigh(sfx, far); foot(sfx, far); fore(sfx, far)
for name in EGGS:
    egg_part(name)
bunting()
nest("eggs-corner", [("egg-blue", 19, 14, 0.56, -14), ("egg-yellow", 41, 14.5, 0.52, 16), ("egg-pink", 30, 16, 0.6, 3)])
nest("eggs-corner-red", [("egg-red", 19, 14, 0.56, -14), ("egg-red", 41, 14.5, 0.52, 16), ("egg-red", 30, 16, 0.6, 3)])

# Ground under the body's pivot: hip below it, the haunch to the hock, the heel to the sole.
GROUND = (BODY["hip"][1] - BODY["pivot"][1]) + (THIGH["hock"][1] - THIGH["pivot"][1]) + (FOOT["sole"] - FOOT["pivot"][1])

art.finish(rig={
    "body": BODY, "head": HEAD, "thigh": THIGH, "foot": FOOT, "fore": FORE,
    "ground": GROUND,
    # The far limbs sit a little behind and above the near ones.
    "far_offset": [8, -4],
    # One hop a cycle. The walk lifts the whole bunny by |sin(pi t)|: on the
    # ground at t = 0, highest at 0.5. Angles in degrees, clockwise (a
    # limb's tip swings back for positive). Each joint is a smooth periodic
    # curve through these keyframes (Catmull-Rom).
    #
    # On the ground the hind feet come forward under the body and the
    # forepaws back; they push off, the haunches driving back and the feet
    # extending, the body nose-up; in the air the bunny stretches out, then
    # gathers, forepaws reaching for the landing, the body tipping nose-down.
    # The ears lag it all: back on the push, floating at the top, flopping
    # forward on the landing.
    "hop": {
        "period": 0.62,
        "body": [[0, 6], [0.08, -12], [0.25, -10], [0.5, 0], [0.75, 8], [0.92, 10]],
        "thigh": [[0, -24], [0.08, 22], [0.22, 55], [0.45, 34], [0.7, -6], [0.88, -26]],
        # The foot, against the haunch, so that it lies flat on the ground (0
        # against the screen), rises onto its toes on the push (60), trails
        # back in the air (120) and swings forward under the body to land (-4).
        "foot": [[0, 18], [0.08, 50], [0.22, 75], [0.45, 63], [0.7, 20], [0.88, 12]],
        "fore": [[0, 12], [0.1, 28], [0.28, 40], [0.5, 8], [0.72, -28], [0.9, -34]],
        "head_follow": -0.6,
        "ears": [[0, 12], [0.1, -4], [0.25, -20], [0.5, -12], [0.75, -2], [0.92, 10]],
        "ear_far_lag": 0.05,
        "tail": [10, 0.2],
        # Squash on the landing, stretch on the push, about the feet.
        "squash": [[0, 0.9], [0.06, 0.96], [0.14, 1.06], [0.35, 1.02], [0.6, 1.0], [0.9, 0.99]],
        "stretch": [[0, 1.07], [0.06, 1.03], [0.14, 0.96], [0.35, 0.99], [0.6, 1.0], [0.9, 1.0]],
    },
})

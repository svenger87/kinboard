"""Valentine's Day's art (RFC-020 §3.3): hearts floating up from the bottom.

    python3 webapp/scripts/festival-art/valentines.py

Glossy hearts in three shades of rose and pink, a heart balloon on a
curling string, and a small heart a tap drops. Each heart is lit from the
top left (a sheen on the left lobe, a soft shade low on the right) with its
glow drawn in. No dressing: the hearts, the wash and the heart glasses are
the whole festival.
"""
import sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("valentines")

# A plump heart in a 100 x 92 box, its point at (50, 88).
HEART = ("M50,88 C22,68 4,50 4,30 C4,14 16,4 30,4 C40,4 47,10 50,19 "
         "C53,10 60,4 70,4 C84,4 96,14 96,30 C96,50 78,68 50,88 Z")

# (light, mid, deep) for each shade.
SHADES = {
    "rose": ("#FF8FA6", "#E8455F", "#A8213B"),
    "pink": ("#FFC2D4", "#FF7FA6", "#D9487A"),
    "blush": ("#FFE3EC", "#FFADC6", "#E77CA0"),
}


def heart_body(key, shade, glow=True):
    light, mid, deep = SHADES[shade]
    defs = (rad(f"{key}f", [(0, light, None), (0.5, mid, None), (1, deep, None)], cx=0.36, cy=0.32, r=0.78, fx=0.3, fy=0.26)
            + lin(f"{key}d", [(0, deep, 0), (1, deep, 0.55)], 0.2, 0.2, 0.9, 1)
            + rad(f"{key}h", [(0, mid, 0.5), (1, mid, 0)])
            + blur(f"{key}b", 5))
    body = []
    if glow:
        body.append(f'<path d="{HEART}" fill="url(#{key}h)" transform="translate(50 46) scale(1.18) translate(-50 -46)" filter="url(#{key}b)"/>')
    body += [
        f'<path d="{HEART}" fill="url(#{key}f)"/>',
        # The shade, low on the right, away from the light.
        f'<path d="M96,30 C96,50 78,68 50,88 C66,70 84,52 86,30 C87,20 82,12 76,8 C88,10 96,18 96,30 Z" fill="url(#{key}d)"/>',
        # Sheens: a long one on the left lobe, a dot on the right.
        '<path d="M14,30 C14,20 20,13 29,12 C22,16 18,22 18,32 Z" fill="#FFFFFF" opacity="0.6"/>',
        '<ellipse cx="66" cy="15" rx="5" ry="3" fill="#FFFFFF" opacity="0.5" transform="rotate(-15 66 15)"/>',
        '<circle cx="24" cy="38" r="2" fill="#FFFFFF" opacity="0.45"/>',
    ]
    return defs, "\n".join(body)


def heart(name, shade):
    """A glossy heart, 120 x 112 with room for its glow; pivot at its middle."""
    defs, body = heart_body("h", shade)
    art.part(name, 120, 112, (60, 52), f'<g transform="translate(10 8)">{body}</g>', defs)


def balloon():
    """A heart balloon on a curling string, 120 x 200: the pivot at the heart's middle, the string trailing below."""
    defs, body = heart_body("b", "rose", glow=False)
    defs += lin("str", [(0, "#F6E7EA", None), (1, "#C9A9B0", None)])
    parts = [
        # The string, curling as it hangs.
        '<path d="M60,104 C56,120 68,132 62,148 C56,164 70,176 64,196" fill="none" stroke="url(#str)" stroke-width="1.8" stroke-linecap="round"/>',
        f'<g transform="translate(10 8)">{body}</g>',
        # The knot at the heart's point, and the shine of the foil.
        '<path d="M56,96 L64,96 L62,104 L58,104 Z" fill="#A8213B"/>',
        '<path d="M28,30 C30,22 36,18 42,18" stroke="#FFFFFF" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>',
    ]
    art.part("heart-balloon", 120, 200, (60, 52), "\n".join(parts), defs)


def drop():
    """The heart a tap drops: square, as drops are drawn."""
    defs, body = heart_body("d", "pink", glow=False)
    art.part("heart-drop", 60, 60, (30, 30), f'<g transform="translate(5 7) scale(0.5)">{body}</g>', defs)


heart("heart-rose", "rose")
heart("heart-pink", "pink")
heart("heart-blush", "blush")
balloon()
drop()
art.finish()

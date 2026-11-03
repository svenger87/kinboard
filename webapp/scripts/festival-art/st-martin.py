"""St Martin's art (RFC-020 §3.3): the children's paper lanterns -- sun, moon,
star -- carried on sticks in the lantern walk along the bottom of the screen,
and the small ones hanging from the cards.

    python3 webapp/scripts/festival-art/st-martin.py

The walking lanterns are ported as they were from the groundwork's
docs/rfc/020/art.py.
"""
import math, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("st-martin")

# ---------------------------------------------------------------- Sankt Martin: paper lanterns
def lantern(shape, hue):
    W, H = 120, 190
    name = f"lantern-{shape}"
    defs = (rad("paper", [(0, "#FFF6D0", None), (0.45, hue, None), (1, hue, 0.85)], fx=0.45, fy=0.45) +
            rad("halo", [(0, hue, 0.55), (1, hue, 0)]) +
            rad("flame", [(0, "#FFFFFF", None), (0.4, "#FFE27A", None), (1, "#FF9A1F", None)]) +
            lin("stick", [(0, "#C9A46E", None), (1, "#8A6236", None)], 0, 0, 1, 0) +
            blur("glow", 8))
    if shape == "sun":
        rays = "".join(f'<path d="M{60 + math.cos(a) * 34:.1f},{120 + math.sin(a) * 34:.1f} L{60 + math.cos(a + 0.18) * 46:.1f},{120 + math.sin(a + 0.18) * 46:.1f} '
                       f'L{60 + math.cos(a + 0.36) * 34:.1f},{120 + math.sin(a + 0.36) * 34:.1f} Z" fill="{hue}"/>'
                       for a in [i * 2 * math.pi / 12 for i in range(12)])
        face = (f'{rays}<circle cx="60" cy="120" r="36" fill="url(#paper)"/>'
                '<path d="M46,114 C48,110 52,110 54,114 M66,114 C68,110 72,110 74,114 M48,128 C54,136 66,136 72,128" stroke="#B5502E" stroke-width="2.5" fill="none" stroke-linecap="round"/>')
    elif shape == "moon":
        face = ('<path d="M76,84 C44,86 30,112 38,136 C46,158 72,164 88,154 C64,150 52,132 56,114 C60,98 70,88 76,84 Z" fill="url(#paper)"/>'
                '<path d="M54,118 C56,114 60,114 62,118" stroke="#8A6236" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
                '<circle cx="50" cy="128" r="4" fill="#FF8FA3" opacity="0.5"/>')
    else:
        pts = " ".join(f"{60 + math.cos(-math.pi/2 + i*math.pi/5) * (42 if i % 2 == 0 else 18):.1f},{120 + math.sin(-math.pi/2 + i*math.pi/5) * (42 if i % 2 == 0 else 18):.1f}" for i in range(10))
        face = f'<polygon points="{pts}" fill="url(#paper)"/>'
    body = [
        '<path d="M60,0 L60,72" stroke="url(#stick)" stroke-width="4" stroke-linecap="round"/>',
        '<path d="M60,72 C54,78 54,82 60,84 C66,82 66,78 60,72" stroke="#3B2A1E" stroke-width="1.4" fill="none"/>',
        '<circle cx="60" cy="122" r="58" fill="url(#halo)" filter="url(#glow)"/>',
        face,
        '<ellipse cx="60" cy="128" rx="5" ry="9" fill="url(#flame)" opacity="0.85"/>',
        '<ellipse cx="50" cy="104" rx="10" ry="6" fill="#FFFFFF" opacity="0.35" transform="rotate(-25 50 104)"/>',
    ]
    art.part(name, W, H, (60, 0), "\n".join(body), defs, "carried on a stick; pivot at the stick's top (60,0) so it swings")



# ---------------------------------------------------------------- the dressing: three small lanterns on a string
def lanterns_hanging():
    """A 96 x 30 string with a sun, a moon and a star lantern, hung from a card's bottom edge."""
    def glow(cid, hue):
        return (f'<radialGradient id="{cid}" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.4"><stop offset="0" stop-color="#FFF6D0"/>'
                f'<stop offset="0.5" stop-color="{hue}"/><stop offset="1" stop-color="{hue}" stop-opacity="0.9"/></radialGradient>')

    def hang(x, hue, face):
        return (f'<path d="M{x},2 L{x},8" stroke="#3B2A1E" stroke-width="0.9"/><circle cx="{x}" cy="17" r="10" fill="{hue}" opacity="0.28"/>'
                f'{face}<ellipse cx="{x}" cy="18" rx="1.3" ry="2.2" fill="#FFF6D0" opacity="0.9"/>')

    star = " L".join(f"{76 + math.cos(-math.pi / 2 + i * math.pi / 5) * (7 if i % 2 == 0 else 3):.2f},{17 + math.sin(-math.pi / 2 + i * math.pi / 5) * (7 if i % 2 == 0 else 3):.2f}" for i in range(10))
    art.still("lanterns-hanging", (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 30" width="96" height="30">\n'
        f'<defs>{glow("psun", "#FFB02E")}{glow("pmoon", "#F2D45C")}{glow("pstar", "#FF8A5B")}</defs>\n'
        '<path d="M2,1 Q48,9 94,1" fill="none" stroke="#8A6236" stroke-width="1.1"/>\n'
        + hang(20, "#FFB02E", '<circle cx="20" cy="17" r="6.2" fill="url(#psun)"/>')
        + hang(48, "#F2D45C", '<path d="M51,10.5 C43,11 41,18 44,22 C47,25.5 52,25 54,23 C48,22.5 46,18 48,14.5 C49,12.5 50,11 51,10.5 Z" fill="url(#pmoon)"/>')
        + hang(76, "#FF8A5B", f'<path d="M{star} Z" fill="url(#pstar)"/>')
        + "\n</svg>\n"))


lantern("sun", "#FFB02E"); lantern("moon", "#F2D45C"); lantern("star", "#FF8A5B")
lanterns_hanging()
art.finish(rig={"lantern": {"walk_period": 1.1, "swing": 11.0, "damping_lag": 0.18, "bob": 4.0}})

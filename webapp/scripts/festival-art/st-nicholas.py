"""St Nicholas's art (RFC-020 §3.3): the boot by the Tasks card, empty on the
evening of the 5th and filled with an orange, nuts and chocolate on the
morning of the 6th.

    python3 webapp/scripts/festival-art/st-nicholas.py

Ported as it was from the groundwork's docs/rfc/020/art.py. The boots are
dressing, placed by CSS, so they are stills with no rig.
"""
import random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("st-nicholas")

# ---------------------------------------------------------------- Nikolaus: the boot
def boot(filled):
    rnd = random.Random(4)
    W, H = 150, 170
    name = "boot-filled" if filled else "boot-empty"
    defs = (lin("leather", [(0, "#B5502E", None), (0.5, "#8E3A1E", None), (1, "#5E2410", None)]) +
            lin("leatherHi", [(0, "#FFFFFF", 0.35), (1, "#FFFFFF", 0)]) +
            rad("orange", [(0, "#FFC46B", None), (0.6, "#FF9A1F", None), (1, "#D9700A", None)], fx=0.35, fy=0.3) +
            rad("nut", [(0, "#C98F55", None), (1, "#7A4E24", None)], fx=0.35, fy=0.3) +
            lin("foil", [(0, "#FFF0A8", None), (0.5, "#E3B341", None), (1, "#9A6A12", None)]) +
            lin("wrap", [(0, "#4A9BE8", None), (1, "#2563B8", None)]) +
            blur("soft", 3))
    body = ['<ellipse cx="78" cy="162" rx="58" ry="6" fill="#140C06" opacity="0.3" filter="url(#soft)"/>']
    if filled:
        body += [
            '<circle cx="58" cy="34" r="22" fill="url(#orange)"/>',
            "".join(f'<circle cx="{58 + rnd.uniform(-14, 14):.1f}" cy="{34 + rnd.uniform(-14, 14):.1f}" r="0.9" fill="#D9700A" opacity="0.6"/>' for _ in range(26)),
            '<path d="M58,12 C60,6 66,4 70,6 C66,10 62,12 58,12 Z" fill="#3E8E5A"/>',
            '<ellipse cx="50" cy="26" rx="6" ry="4" fill="#FFFFFF" opacity="0.45"/>',
            '<ellipse cx="94" cy="30" rx="13" ry="11" fill="url(#nut)"/><path d="M88,24 C92,30 96,32 102,32" stroke="#5A3416" stroke-width="1.4" fill="none"/>',
            '<ellipse cx="86" cy="44" rx="11" ry="9" fill="url(#nut)"/>',
            # a chocolate in foil and a wrapped sweet
            '<path d="M104,8 L120,4 L126,40 L108,44 Z" fill="url(#foil)"/><path d="M106,18 L122,14" stroke="#9A6A12" stroke-width="1.2"/>',
            '<path d="M30,50 L36,40 L46,46 L60,44 L70,52 L60,56 L46,56 L36,62 Z" fill="url(#wrap)"/><path d="M46,46 L46,56 M60,44 L60,56" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>',
        ]
    body += [
        # the boot: shaft, foot, heel, sole, and the fold of the cuff
        '<path d="M26,46 C26,40 104,40 104,46 L104,112 C104,118 112,120 124,122 C140,124 146,134 144,146 C142,154 132,156 120,156 L36,156 C28,156 24,150 24,142 Z" fill="url(#leather)"/>',
        '<path d="M34,52 L36,140" stroke="url(#leatherHi)" stroke-width="10" stroke-linecap="round"/>',
        '<path d="M22,146 L146,146 C146,154 140,160 128,160 L30,160 C24,160 22,154 22,146 Z" fill="#2E1A10"/>',
        '<path d="M22,40 C22,30 108,30 108,40 L108,58 C108,64 22,64 22,58 Z" fill="#F4EBDD"/>',
        '<path d="M22,40 C22,30 108,30 108,40" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.8"/>',
        "".join(f'<circle cx="{rnd.uniform(26, 104):.1f}" cy="{rnd.uniform(38, 60):.1f}" r="{rnd.uniform(1, 2):.1f}" fill="#D9CDB8" opacity="0.7"/>' for _ in range(40)),
        # laces and eyelets
        "".join(f'<circle cx="{96 + (i % 2) * 6}" cy="{72 + i * 9}" r="2" fill="#E3B341"/>' for i in range(5)),
        '<path d="M96,72 L102,81 L96,90 L102,99 L96,108" stroke="#F4EBDD" stroke-width="1.6" fill="none"/>',
        '<path d="M98,112 C110,118 132,118 140,128" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.25"/>',
    ]
    art.part(name, W, H, (78, 158), "\n".join(body), defs,
         "stands on the Tasks card" + (": the morning of 6 Dec" if filled else ": the evening of 5 Dec"))



boot(False); boot(True)
# No visitor: the boots are drawn as parts (with their pivot, the heel) but
# only the dressing uses them, so there is no art.json.

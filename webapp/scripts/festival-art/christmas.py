"""Christmas's art (RFC-020 §5.1): the sleigh with Santa, two reindeer as
rigged parts (body, head, tail, two-segment legs near and far), their rig and
gallop, and the snow resting on the cards' top edges.

    python3 webapp/scripts/festival-art/christmas.py

Ported as it was from the groundwork's docs/rfc/020/art.py: the same seeds,
so the same drawings, byte for byte.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur, fur

art = Art("christmas")

# ---------------------------------------------------------------- reindeer
FUR, FUR_DARK, FUR_LIGHT, BELLY = "#B47A45", "#7C4E27", "#D9A774", "#F1DDBE"


def reindeer_body():
    rnd = random.Random(1)
    W, H = 200, 120
    defs = (lin("rbFur", [(0, "#C88B52", None), (0.55, FUR, None), (1, "#8E5A2E", None)]) +
            lin("rbBelly", [(0, "#FFF3DE", None), (1, BELLY, None)]) +
            rad("rbHi", [(0, "#FFFFFF", 0.45), (1, "#FFFFFF", 0)]) +
            lin("strap", [(0, "#D63A3A", None), (1, "#8E1F26", None)]) +
            rad("bell", [(0, "#FFF4B5", None), (0.45, "#F2C23A", None), (1, "#A8741A", None)], fx=0.35, fy=0.3) +
            blur("soft", 3) +
            '<clipPath id="rbClip"><path d="M30,62 C24,34 58,18 100,20 C142,22 178,30 182,58 C186,86 156,98 110,98 C66,98 36,90 30,62 Z"/></clipPath>')
    body = [
        # the shadow it casts on itself
        '<ellipse cx="104" cy="96" rx="70" ry="8" fill="#3B2412" opacity="0.25" filter="url(#soft)"/>',
        # body
        '<path d="M30,62 C24,34 58,18 100,20 C142,22 178,30 182,58 C186,86 156,98 110,98 C66,98 36,90 30,62 Z" fill="url(#rbFur)"/>',
        '<path d="M58,82 C80,96 140,98 166,80 C160,94 128,100 104,100 C80,100 64,94 58,82 Z" fill="url(#rbBelly)"/>',
        # chest fluff, at the front (right)
        '<path d="M160,40 C186,40 194,62 184,80 C178,90 166,92 160,84 C168,72 166,54 160,40 Z" fill="#FFF3DE"/>',
        fur(rnd, 105, 52, 70, 26, 150, [FUR_DARK, "#9A6435", FUR_LIGHT], clip="rbClip"),
        fur(rnd, 176, 64, 10, 18, 30, ["#E7D3B4", "#FFFFFF"], length=(3, 6), tilt=1.2, opacity=(0.5, 0.9)),
        '<ellipse cx="88" cy="36" rx="46" ry="12" fill="url(#rbHi)" transform="rotate(-6 88 36)"/>',
        # the harness: a red strap round the chest with three bells
        '<path d="M150,26 C140,52 140,76 152,96" stroke="url(#strap)" stroke-width="9" fill="none" stroke-linecap="round"/>',
        '<path d="M150,26 C140,52 140,76 152,96" stroke="#FF8A8A" stroke-width="2" fill="none" opacity="0.5" stroke-dasharray="1 7" stroke-linecap="round"/>',
    ]
    for (bx, by) in ((144, 44), (141, 62), (145, 80)):
        body.append(f'<circle cx="{bx}" cy="{by}" r="6.5" fill="url(#bell)"/><path d="M{bx-4},{by+2} L{bx+4},{by+2}" stroke="#7A5210" stroke-width="1.4"/>'
                    f'<circle cx="{bx-2}" cy="{by-2.5}" r="1.6" fill="#FFFFFF" opacity="0.9"/>')
    body.append('<circle cx="150" cy="26" r="4.5" fill="#E3B341"/><circle cx="149" cy="25" r="1.5" fill="#FFF4C7"/>')  # the rein ring
    art.part("reindeer-body", W, H, (100, 60), "\n".join(body), defs,
         "pivot at the body's centre; head joins at (172,34); legs at hips (64,80) back and (150,82) front; rein ring at (150,26)")


def reindeer_head(lead):
    rnd = random.Random(2)
    W, H = 150, 150
    name = "reindeer-head-lead" if lead else "reindeer-head"
    nose = (('<circle cx="122" cy="98" r="16" fill="#FF4040" opacity="0.55" filter="url(#glow)"/>'
             '<circle cx="122" cy="98" r="8.5" fill="url(#noseRed)"/><ellipse cx="119" cy="95" rx="3" ry="2" fill="#FFFFFF" opacity="0.9"/>')
            if lead else
            '<ellipse cx="121" cy="98" rx="7" ry="6" fill="url(#noseBrown)"/><ellipse cx="119" cy="95.5" rx="2.4" ry="1.6" fill="#FFFFFF" opacity="0.7"/>')
    defs = (lin("hFur", [(0, "#C88B52", None), (1, "#9A6435", None)]) +
            lin("snout", [(0, "#E9C79B", None), (1, "#D2A472", None)]) +
            lin("antler", [(0, "#F4E6C8", None), (1, "#C9A46E", None)]) +
            rad("noseRed", [(0, "#FF9A8A", None), (0.5, "#FF3B3B", None), (1, "#B3121C", None)], fx=0.35, fy=0.3) +
            rad("noseBrown", [(0, "#6B4A33", None), (1, "#2F1E12", None)], fx=0.35, fy=0.3) +
            rad("eye", [(0, "#4A3A5C", None), (1, "#1D1630", None)], fx=0.35, fy=0.3) +
            blur("glow", 5) + blur("soft", 2))

    def antler(sx, side):
        # a main beam with three tines, as a tapered stroke drawn twice for shading
        d = (f"M{sx},40 C{sx + side*-6},22 {sx + side*-4},10 {sx + side*4},0 "
             f"M{sx + side*-3},26 C{sx + side*-16},20 {sx + side*-20},12 {sx + side*-18},4 "
             f"M{sx + side*-1},14 C{sx + side*8},10 {sx + side*14},6 {sx + side*16},-2 "
             f"M{sx + side*-5},34 C{sx + side*-14},32 {sx + side*-22},28 {sx + side*-26},22")
        return (f'<path d="{d}" stroke="#A88454" stroke-width="7" stroke-linecap="round" fill="none" transform="translate(1.5,1.5)" opacity="0.5"/>'
                f'<path d="{d}" stroke="url(#antler)" stroke-width="6" stroke-linecap="round" fill="none"/>'
                f'<path d="{d}" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.5" transform="translate(-1,-1)"/>')
    body = [
        # the neck, down to where it joins the chest; a pale throat
        '<path d="M44,100 C32,114 22,130 20,148 L76,148 C78,134 84,120 94,110 Z" fill="url(#hFur)"/>',
        '<path d="M76,114 C70,124 66,136 64,148 L76,148 C78,134 84,120 94,110 Z" fill="#F1DDBE"/>',
        fur(rnd, 52, 128, 22, 18, 30, [FUR_DARK, FUR_LIGHT], length=(4, 7), width=1.1, tilt=1.2),
        f'<g transform="translate(20,18)">{antler(46, 1)}{antler(62, -1)}</g>',
        # far ear, head, near ear
        '<path d="M58,62 C46,48 40,50 44,62 C46,68 54,70 58,66 Z" fill="#8E5A2E"/>',
        '<path d="M40,96 C30,70 52,50 78,52 C100,54 112,66 124,80 C134,92 130,110 114,114 C96,118 78,116 62,114 C48,112 42,106 40,96 Z" fill="url(#hFur)"/>',
        '<path d="M96,78 C112,76 132,86 132,100 C132,112 118,116 104,114 C92,112 86,104 88,94 C89,86 90,80 96,78 Z" fill="url(#snout)"/>',
        fur(rnd, 66, 82, 22, 20, 45, [FUR_DARK, FUR_LIGHT, "#9A6435"], length=(3, 6), width=1.1, tilt=-0.3),
        '<path d="M70,58 C76,38 92,34 96,40 C98,46 88,58 78,64 Z" fill="#C88B52"/>',
        '<path d="M74,58 C80,44 90,42 92,46 C92,50 86,56 80,60 Z" fill="#F4B8B0"/>',
        # eye with a lid, a catchlight and lashes; a blush below
        '<ellipse cx="86" cy="80" rx="7.5" ry="8.5" fill="url(#eye)"/>',
        '<circle cx="83.5" cy="76.5" r="2.6" fill="#FFFFFF"/><circle cx="88.5" cy="83" r="1.1" fill="#FFFFFF" opacity="0.8"/>',
        '<path d="M78,74 C82,69 90,69 94,73" stroke="#5A3A20" stroke-width="2" fill="none" stroke-linecap="round"/>',
        '<path d="M80,71 l-3,-4 M84,69.5 l-1.5,-4.5 M88.5,69.5 l0.5,-4.5" stroke="#5A3A20" stroke-width="1.2" stroke-linecap="round"/>',
        '<ellipse cx="96" cy="96" rx="8" ry="5" fill="#FF8FA3" opacity="0.45" filter="url(#soft)"/>',
        '<path d="M112,108 C116,112 122,112 126,108" stroke="#7A4A2A" stroke-width="2" fill="none" stroke-linecap="round"/>',
        nose,
        '<ellipse cx="70" cy="66" rx="18" ry="6" fill="#FFFFFF" opacity="0.18" transform="rotate(-12 70 66)"/>',
    ]
    art.part(name, W, H, (48, 144), "\n".join(body), defs,
         "pivot at the base of the neck (48,144), placed on the body at (164,46)" + ("; the red nose glows" if lead else ""))


def leg_colours(far):
    return ("#6E4422", "#4E2E15") if far else (FUR, "#8A5528")


def reindeer_leg_upper(front, far):
    """Shoulder to knee (front), or hip to hock (back): thick, muscled."""
    c1, c2 = leg_colours(far)
    name = f"reindeer-{'front' if front else 'back'}-upper{'-far' if far else ''}"
    defs = lin("g", [(0, c1, None), (1, c2, None)], 0, 0, 1, 0)
    if front:
        W, H, shape, joint = 40, 54, "M3,8 C3,-3 37,-3 37,10 C37,24 31,38 27,50 C24,54 16,54 13,50 C9,38 4,24 3,8 Z", (20, 48)
    else:
        W, H, shape, joint = 46, 50, "M2,8 C2,-5 44,-5 44,12 C44,28 36,38 30,46 C27,50 19,50 17,46 C11,34 2,22 2,8 Z", (24, 44)
    body = [f'<path d="{shape}" fill="url(#g)"/>',
            f'<ellipse cx="{joint[0]}" cy="{joint[1]}" rx="8" ry="5.5" fill="{c2}" opacity="0.55"/>',
            f'<path d="M10,10 C10,22 13,{joint[1]-10} 16,{joint[1]-2}" stroke="#FFFFFF" stroke-width="3.5" fill="none" opacity="{0.06 if far else 0.2}" stroke-linecap="round"/>']
    art.part(name, W, H, (W // 2, 8), "\n".join(body), defs, f"pivot at the {'shoulder' if front else 'hip'}; the {'knee' if front else 'hock'} at {joint}")
    return joint


def reindeer_leg_lower(front, far):
    """Knee (or hock) to hoof: slim, a fur cuff, the hoof."""
    c1, c2 = leg_colours(far)
    name = f"reindeer-{'front' if front else 'back'}-lower{'-far' if far else ''}"
    defs = lin("g", [(0, c1, None), (1, c2, None)], 0, 0, 1, 0) + lin("hoof", [(0, "#4A3628", None), (1, "#211710", None)])
    L = 32 if front else 36
    body = [f'<path d="M8,4 C8,-2 24,-2 24,4 L21,{L} L11,{L} Z" fill="url(#g)"/>',
            f'<path d="M7,{L-4} C4,{L+5} 28,{L+5} 25,{L-4} C25,{L-9} 7,{L-9} 7,{L-4} Z" fill="#F4E6D2"/>',
            f'<path d="M7,{L+3} L25,{L+3} L27,{L+15} C27,{L+20} 5,{L+20} 5,{L+15} Z" fill="url(#hoof)"/>',
            f'<path d="M16,{L+5} L16,{L+18}" stroke="#0F0A06" stroke-width="1.2" opacity="0.6"/>',
            f'<path d="M9,{L+7} C10,{L+5} 13,{L+5} 13,{L+7}" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.5"/>']
    art.part(name, 32, L + 22, (16, 3), "\n".join(body), defs, f"pivot at the {'knee' if front else 'hock'} (16,3)")


def reindeer_tail():
    defs = lin("t", [(0, "#FFFFFF", None), (1, "#E6D5BC", None)])
    body = ['<path d="M26,8 C10,-4 0,8 8,16 C0,20 8,30 22,22 Z" fill="url(#t)"/>',
            '<path d="M20,12 C14,8 12,14 16,18" stroke="#D9C6A8" stroke-width="1.5" fill="none"/>']
    art.part("reindeer-tail", 30, 30, (26, 12), "\n".join(body), defs, "pivot at its root (26,12): it flicks")


# ---------------------------------------------------------------- the sleigh and Santa
def sleigh():
    rnd = random.Random(3)
    W, H = 300, 210
    defs = (lin("lacquer", [(0, "#F0605A", None), (0.45, "#D6363A", None), (1, "#8E1C25", None)]) +
            lin("lacquerSide", [(0, "#C62F35", None), (1, "#7A1520", None)], 0, 0, 1, 0) +
            lin("gold", [(0, "#FFF0A8", None), (0.4, "#F2C23A", None), (1, "#A8741A", None)]) +
            lin("velvet", [(0, "#3E8E5A", None), (1, "#1F5A36", None)]) +
            lin("sack", [(0, "#C9A06A", None), (1, "#8A6236", None)]) +
            lin("coat", [(0, "#F05A5A", None), (0.5, "#D23B44", None), (1, "#93212C", None)]) +
            rad("skin", [(0, "#FFE0C8", None), (1, "#EDB894", None)], fx=0.35, fy=0.3) +
            rad("furW", [(0, "#FFFFFF", None), (1, "#E4E8EE", None)], fx=0.35, fy=0.3) +
            rad("gloss", [(0, "#FFFFFF", 0.55), (1, "#FFFFFF", 0)]) +
            blur("soft", 3) + blur("glow", 4))
    gift = lambda x, y, w, h, c1, c2, r: (
        f'<g transform="rotate({r} {x + w/2} {y + h/2})"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{c1}"/>'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h*0.35}" rx="3" fill="#FFFFFF" opacity="0.18"/>'
        f'<rect x="{x + w/2 - 3}" y="{y}" width="6" height="{h}" fill="{c2}"/><rect x="{x}" y="{y + h/2 - 3}" width="{w}" height="6" fill="{c2}"/>'
        f'<path d="M{x + w/2},{y} C{x + w/2 - 14},{y - 12} {x + w/2 - 16},{y - 2} {x + w/2},{y} C{x + w/2 + 14},{y - 12} {x + w/2 + 16},{y - 2} {x + w/2},{y} Z" fill="{c2}"/></g>')
    body = [
        '<ellipse cx="150" cy="200" rx="120" ry="7" fill="#1B120A" opacity="0.25" filter="url(#soft)"/>',
        # the sack and presents, behind Santa
        '<path d="M28,96 C14,60 40,30 70,34 C96,38 104,64 100,96 Z" fill="url(#sack)"/>',
        fur(rnd, 62, 70, 30, 26, 60, ["#7A5530", "#D9B47E"], length=(3, 6), width=1, tilt=0.9, opacity=(0.25, 0.5)),
        '<path d="M40,46 C52,40 66,40 78,46" stroke="#6E4A28" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        gift(32, 14, 30, 26, "#4AA8FF", "#FFD24A", -10) + gift(62, 4, 26, 30, "#4AD66D", "#E04848", 8) + gift(46, 30, 22, 18, "#C084FC", "#FFFFFF", 4),
        # Santa: coat, fur trim, belt
        '<path d="M118,98 C110,60 130,38 160,38 C190,38 206,62 200,100 Z" fill="url(#coat)"/>',
        fur(rnd, 160, 72, 34, 24, 40, ["#B32A33", "#FF7A7A"], length=(4, 8), width=1, tilt=1.1, opacity=(0.2, 0.4)),
        '<path d="M156,40 C154,60 154,84 156,100" stroke="url(#furW)" stroke-width="10" stroke-linecap="round"/>',
        '<rect x="120" y="78" width="80" height="11" rx="4" fill="#2A2026"/>',
        '<rect x="150" y="76" width="16" height="15" rx="3" fill="none" stroke="url(#gold)" stroke-width="3.5"/>',
        # head: beard, face, hat
        '<path d="M136,40 C130,62 146,76 160,78 C176,76 190,62 184,40 Z" fill="url(#furW)"/>',
    ]
    for _ in range(14):  # the beard's curls
        x, y = rnd.uniform(140, 180), rnd.uniform(46, 72)
        body.append(f'<path d="M{x:.1f},{y:.1f} c-3,2 -3,6 0,7" stroke="#C9CED8" stroke-width="1.3" fill="none" opacity="0.7"/>')
    body += [
        '<ellipse cx="160" cy="28" rx="20" ry="18" fill="url(#skin)"/>',
        '<ellipse cx="148" cy="34" rx="6" ry="4" fill="#FF8FA3" opacity="0.55" filter="url(#soft)"/>',
        '<ellipse cx="172" cy="34" rx="6" ry="4" fill="#FF8FA3" opacity="0.55" filter="url(#soft)"/>',
        '<path d="M150,26 C152,23 156,23 158,26 M163,26 C165,23 169,23 171,26" stroke="#3B2A2A" stroke-width="2" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="160.5" cy="32" rx="4.5" ry="3.8" fill="#F29C8C"/><ellipse cx="159" cy="30.6" rx="1.4" ry="1" fill="#FFFFFF" opacity="0.8"/>',
        '<path d="M146,20 C150,16 156,17 158,20 M162,20 C165,17 171,16 174,20" stroke="#FFFFFF" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
        '<path d="M144,38 C150,44 156,42 160,38 C164,42 170,44 176,38 C172,48 148,48 144,38 Z" fill="#FFFFFF"/>',
        # hat flopping back in the wind, with its pompom
        '<path d="M140,16 C142,-6 168,-14 186,-6 C200,0 196,14 210,18 C196,22 186,14 178,10 C176,16 178,18 180,16 Z" fill="url(#coat)" transform="translate(0,4)"/>',
        '<path d="M138,18 C150,10 172,10 184,18 L184,26 C172,18 150,18 138,26 Z" fill="url(#furW)"/>',
        '<circle cx="211" cy="23" r="8" fill="url(#furW)"/>',
        # the sleigh: back panel, velvet seat edge, the body with its scroll
        '<path d="M96,92 C96,70 104,62 116,62 L118,110 Z" fill="url(#lacquerSide)"/>',
        '<path d="M96,96 L238,96 L238,104 L96,104 Z" fill="url(#velvet)"/>',
        '<path d="M60,100 L240,100 C262,100 276,92 284,74 C292,58 286,44 274,44 C262,44 258,56 266,62 C272,66 268,82 256,92 C252,118 236,150 200,156 L96,156 C72,156 58,134 60,100 Z" fill="url(#lacquer)"/>',
        '<path d="M70,108 C70,128 82,144 100,146 L196,146 C222,144 238,128 244,108" stroke="url(#gold)" stroke-width="4" fill="none" stroke-linecap="round"/>',
        # gold filigree on the side panel
        '<path d="M120,128 c-10,-14 6,-24 14,-14 c6,8 -4,14 -8,8 M168,128 c10,-14 -6,-24 -14,-14 c-6,8 4,14 8,8 M144,112 c-6,4 -6,12 0,16 c6,-4 6,-12 0,-16 Z" stroke="url(#gold)" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
        '<circle cx="144" cy="120" r="3" fill="#FFF0A8"/>',
        '<path d="M88,110 C110,104 200,104 230,108" stroke="#FFFFFF" stroke-width="5" opacity="0.28" fill="none" stroke-linecap="round"/>',
        '<ellipse cx="274" cy="56" rx="8" ry="6" fill="url(#gloss)"/>',
        # runners and struts
        '<path d="M100,156 L104,182 M196,156 L192,182" stroke="url(#gold)" stroke-width="6" stroke-linecap="round"/>',
        '<path d="M60,184 L250,184 C280,184 296,170 292,150 C290,140 280,138 276,146" stroke="url(#gold)" stroke-width="7" fill="none" stroke-linecap="round"/>',
        '<path d="M70,181 L246,181" stroke="#FFFFFF" stroke-width="1.6" opacity="0.6"/>',
    ]
    art.part("sleigh", W, H, (150, 120), "\n".join(body), defs,
         "pivot at its centre; Santa's shoulder at (186,52) for the arm, his hands (reins) at (200,64)")


def santa_arm():
    W, H = 70, 50
    defs = (lin("coatArm", [(0, "#F05A5A", None), (1, "#A8232F", None)]) + rad("furW2", [(0, "#FFFFFF", None), (1, "#E4E8EE", None)]) +
            rad("mitten", [(0, "#5FD08A", None), (1, "#2E8A52", None)], fx=0.35, fy=0.3))
    body = ['<path d="M6,10 C20,2 42,6 52,14 L48,26 C38,20 22,20 10,24 C2,22 0,14 6,10 Z" fill="url(#coatArm)"/>',
            '<path d="M46,10 C52,6 58,10 56,18 C54,26 48,28 44,24 Z" fill="url(#furW2)"/>',
            '<ellipse cx="60" cy="16" rx="9" ry="8" fill="url(#mitten)"/><ellipse cx="58" cy="9" rx="4" ry="5" fill="url(#mitten)"/>',
            '<ellipse cx="57" cy="13" rx="3" ry="2" fill="#FFFFFF" opacity="0.4"/>']
    art.part("santa-arm", W, H, (8, 16), "\n".join(body), defs, "pivot at the shoulder (8,16): it waves when the sleigh is tapped")



# ---------------------------------------------------------------- the dressing: snow on the cards' top edges
def snow_cap():
    """A 120 x 22 tile of snow, repeated along a card's top edge: a soft heaped top, icicle drips below."""
    tops = [5, 3, 6, 2.5, 5.5, 3.5, 5]
    ctrl = [-0.5, -0.5, -1.0, -1.0, 0.0, 0.0]
    edge = "M0,5 " + " ".join(f"Q{20 * i + 10},{ctrl[i]} {20 * (i + 1)},{tops[i + 1]}" for i in range(6))
    lift = 5.8 - 5  # the highlight, just under the top edge
    shine = f"M0,{tops[0] + lift} " + " ".join(f"Q{20 * i + 10},{ctrl[i] + lift} {20 * (i + 1)},{tops[i + 1] + lift}" for i in range(6))
    art.still("snow-cap", (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 22" width="120" height="22" preserveAspectRatio="none">\n'
        '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#F2F7FF"/><stop offset="1" stop-color="#D5E2F4"/></linearGradient></defs>\n'
        f'<path d="{edge} L120,12 C116,12.6 110,12.2 106,12.8 C105,16 103.4,19.2 101.5,19.2 C99.6,19.2 98.4,16 97.4,13 C90,13.6 80,12.4 72,13 '
        'C71.2,15 70,16.4 68.6,16.4 C67.2,16.4 66.2,15 65.4,13.2 C56,13.6 46,12.4 36,13 C35,16.6 33.4,20 31.4,20 C29.4,20 28.2,16.6 27.2,13.2 '
        'C18,13.6 8,12.2 0,12 Z" fill="url(#s)"/>\n'
        f'<path d="{shine}" fill="none" stroke="#FFFFFF" stroke-width="1.6" opacity="0.9"/>\n'
        '<path d="M0,11.6 L120,11.6" stroke="#B9CBE3" stroke-width="0.8" opacity="0.45"/>\n'
        '<circle cx="18" cy="6.5" r="0.9" fill="#CFE0F7"/><circle cx="57" cy="5" r="0.8" fill="#CFE0F7"/><circle cx="91" cy="6.8" r="0.9" fill="#CFE0F7"/>\n'
        "</svg>\n"))


reindeer_body()
reindeer_head(False); reindeer_head(True)
JOINTS = {}
for front in (True, False):
    for far in (False, True):
        JOINTS["front" if front else "back"] = reindeer_leg_upper(front, far)
        reindeer_leg_lower(front, far)
reindeer_tail()
sleigh(); santa_arm()
snow_cap()

# The rig: where each part sits on its parent, in the parent's units
# (lib/festivals/kits/christmas.ts builds the sleigh's rig from it).
art.finish(rig={
    "sleigh": {"arm": {"part": "santa-arm", "at": [186, 52]}, "reins_from": [200, 64]},
    "reindeer": {"head": [164, 46], "rein_ring": [150, 26], "tail": [36, 52],
                 "legs": {"front": [148, 80], "back": [68, 78]}, "joints": JOINTS, "far_offset": [10, -4],
                 "spacing": 230, "first": [400, 90]},
    # A rotary gallop, in the air. Angles in degrees, clockwise (a leg's tip
    # swings back for positive). Each joint is a smooth periodic curve through
    # these keyframes (Catmull-Rom); `phase` offsets the four legs.
    "gait": {
        "period": 0.72,
        "legs": {
            "front": {"upper": [[0, 30], [0.15, 18], [0.38, -30], [0.55, -46], [0.75, -8]],
                      "lower": [[0, 0], [0.15, 75], [0.38, 45], [0.55, -6], [0.75, 0]]},
            "back": {"upper": [[0, -36], [0.25, -12], [0.45, 24], [0.6, 44], [0.8, 8]],
                     "lower": [[0, -42], [0.25, -12], [0.45, 6], [0.6, 22], [0.8, -55]]},
        },
        "phase": {"back-far": 0.0, "back": 0.07, "front-far": 0.0, "front": 0.07},  # front reach meets hind drive: stretched, then gathered
        "body": {"pitch": [3.0, 0.1], "bob": [5.0, 0.0]},
        "head": {"follow": -0.6, "nod": [2.5, 0.35]},
        "tail": {"flick": [9.0, 0.2], "freq": 2},
        "second_deer_phase": 0.31,
        "sleigh": {"bob": [2.5, 0.55], "sway": [1.2, 0.3], "arm": [4.0, 0.5]},
    },
})

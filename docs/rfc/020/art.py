"""The RFC-020 art, drawn in detail (§5.1): every visitor is drawn as SVG part
by part, each part in its own coordinates with a pivot, so the canvas can rig
it (a reindeer's legs rotate at the hip, its head bobs at the neck, Santa's arm
waves at the shoulder). The prototype rasterises each part once and only moves
it per frame.

    python3 docs/rfc/020/art.py docs/rfc/020/art

Writes one SVG per part, `parts.json` (each part's size and pivot, plus the
rig: where each part sits), and `sheet.svg`, every part laid out for the RFC.

Style: the creatures' palette and roundness (RFC-016), with Storybook's
gradients, soft shadows and highlights for depth. No outlines. Light from the
top left.
"""
import json, math, os, random, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
PARTS = {}


def part(name, w, h, pivot, body, defs="", note=""):
    """One part: a w x h drawing whose pivot (rotation centre, in its own units) is `pivot`."""
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
           f'data-pivot="{pivot[0]} {pivot[1]}">\n<defs>{defs}</defs>\n{body}\n</svg>\n')
    with open(os.path.join(OUT, f"{name}.svg"), "w") as f:
        f.write(svg)
    PARTS[name] = {"w": w, "h": h, "pivot": list(pivot), "note": note}
    return svg


def lin(id_, stops, x1=0, y1=0, x2=0, y2=1):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if a is None else f" stop-opacity=\"{a}\""}/>' for o, c, a in stops)
    return f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>'


def rad(id_, stops, cx=0.5, cy=0.5, r=0.5, fx=None, fy=None):
    f = f' fx="{fx}" fy="{fy}"' if fx is not None else ""
    s = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if a is None else f" stop-opacity=\"{a}\""}/>' for o, c, a in stops)
    return f'<radialGradient id="{id_}" cx="{cx}" cy="{cy}" r="{r}"{f}>{s}</radialGradient>'


def blur(id_, sd):
    return f'<filter id="{id_}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{sd}"/></filter>'


def fur(rnd, cx, cy, rx, ry, n, colours, length=(5, 9), width=1.4, tilt=-0.6, opacity=(0.35, 0.7), clip=None):
    """Short curved strokes inside an ellipse, leaning the way the fur lies."""
    out = []
    for _ in range(n):
        a, r = rnd.uniform(0, 2 * math.pi), math.sqrt(rnd.uniform(0, 1))
        x, y = cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r
        L = rnd.uniform(*length)
        dx, dy = math.cos(tilt) * L, math.sin(tilt) * L
        bend = rnd.uniform(-2.5, 2.5)
        out.append(f'<path d="M{x:.1f},{y:.1f} q{dx/2 + bend:.1f},{dy/2 - bend:.1f} {dx:.1f},{dy:.1f}" stroke="{rnd.choice(colours)}" '
                   f'stroke-width="{width}" stroke-linecap="round" fill="none" opacity="{rnd.uniform(*opacity):.2f}"/>')
    g = "".join(out)
    return f'<g clip-path="url(#{clip})">{g}</g>' if clip else f"<g>{g}</g>"


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
    part("reindeer-body", W, H, (100, 60), "\n".join(body), defs,
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
    part(name, W, H, (48, 144), "\n".join(body), defs,
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
    part(name, W, H, (W // 2, 8), "\n".join(body), defs, f"pivot at the {'shoulder' if front else 'hip'}; the {'knee' if front else 'hock'} at {joint}")
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
    part(name, 32, L + 22, (16, 3), "\n".join(body), defs, f"pivot at the {'knee' if front else 'hock'} (16,3)")


def reindeer_tail():
    defs = lin("t", [(0, "#FFFFFF", None), (1, "#E6D5BC", None)])
    body = ['<path d="M26,8 C10,-4 0,8 8,16 C0,20 8,30 22,22 Z" fill="url(#t)"/>',
            '<path d="M20,12 C14,8 12,14 16,18" stroke="#D9C6A8" stroke-width="1.5" fill="none"/>']
    part("reindeer-tail", 30, 30, (26, 12), "\n".join(body), defs, "pivot at its root (26,12): it flicks")


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
    part("sleigh", W, H, (150, 120), "\n".join(body), defs,
         "pivot at its centre; Santa's shoulder at (186,52) for the arm, his hands (reins) at (200,64)")


def santa_arm():
    W, H = 70, 50
    defs = (lin("coatArm", [(0, "#F05A5A", None), (1, "#A8232F", None)]) + rad("furW2", [(0, "#FFFFFF", None), (1, "#E4E8EE", None)]) +
            rad("mitten", [(0, "#5FD08A", None), (1, "#2E8A52", None)], fx=0.35, fy=0.3))
    body = ['<path d="M6,10 C20,2 42,6 52,14 L48,26 C38,20 22,20 10,24 C2,22 0,14 6,10 Z" fill="url(#coatArm)"/>',
            '<path d="M46,10 C52,6 58,10 56,18 C54,26 48,28 44,24 Z" fill="url(#furW2)"/>',
            '<ellipse cx="60" cy="16" rx="9" ry="8" fill="url(#mitten)"/><ellipse cx="58" cy="9" rx="4" ry="5" fill="url(#mitten)"/>',
            '<ellipse cx="57" cy="13" rx="3" ry="2" fill="#FFFFFF" opacity="0.4"/>']
    part("santa-arm", W, H, (8, 16), "\n".join(body), defs, "pivot at the shoulder (8,16): it waves when the sleigh is tapped")


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
    part(name, W, H, (78, 158), "\n".join(body), defs,
         "stands on the Tasks card" + (": the morning of 6 Dec" if filled else ": the evening of 5 Dec"))


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
    part(name, W, H, (60, 0), "\n".join(body), defs, "carried on a stick; pivot at the stick's top (60,0) so it swings")


reindeer_body()
reindeer_head(False); reindeer_head(True)
JOINTS = {}
for front in (True, False):
    for far in (False, True):
        JOINTS["front" if front else "back"] = reindeer_leg_upper(front, far)
        reindeer_leg_lower(front, far)
reindeer_tail()
sleigh(); santa_arm()
boot(False); boot(True)
lantern("sun", "#FFB02E"); lantern("moon", "#F2D45C"); lantern("star", "#FF8A5B")

# The rig: where each part sits on its parent, in the parent's units.
RIG = {
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
    "lantern": {"walk_period": 1.1, "swing": 11.0, "damping_lag": 0.18, "bob": 4.0},
}

# ---------------------------------------------------------------- motion: the gait, evaluated
import re

G = RIG["gait"]
R = RIG["reindeer"]


def curve(keys, t):
    """A smooth periodic curve through [phase, value] keyframes (Catmull-Rom), at phase t in [0, 1)."""
    t %= 1.0
    n = len(keys)
    for i in range(n):
        p0, p1 = keys[i][0], (keys[(i + 1) % n][0] if i + 1 < n else keys[0][0] + 1.0)
        if p0 <= t < p1 or (i == n - 1 and t >= p0):
            u = (t - p0) / (p1 - p0)
            v0, v1, v2, v3 = keys[(i - 1) % n][1], keys[i][1], keys[(i + 1) % n][1], keys[(i + 2) % n][1]
            return 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u ** 3)
    return keys[0][1]


def wave(amp_phase, t, freq=1):
    amp, ph = amp_phase
    return amp * math.sin(2 * math.pi * (freq * t + ph))


def pose(t):
    """Every joint of one reindeer at gait phase t (0..1): degrees, and the body's bob in units."""
    out = {}
    for leg, ph in G["phase"].items():
        kind = leg.split("-")[0]
        out[leg] = (curve(G["legs"][kind]["upper"], t + ph), curve(G["legs"][kind]["lower"], t + ph))
    pitch = wave(G["body"]["pitch"], t)
    out["pitch"], out["bob"] = pitch, -G["body"]["bob"][0] * math.cos(2 * math.pi * t)
    out["head"] = G["head"]["follow"] * pitch + wave(G["head"]["nod"], t)
    out["tail"] = wave(G["tail"]["flick"], t, G["tail"]["freq"])
    return out


# ---------------------------------------------------------------- parts as symbols, a reindeer as nested groups
def inner_of(name):
    with open(os.path.join(OUT, f"{name}.svg")) as f:
        s_ = f.read()
    inner = s_.split(">", 1)[1].rsplit("</svg>", 1)[0]
    for i in set(re.findall(r'id="([^"]+)"', inner)):  # each part's ids get its name, so they can't collide
        inner = inner.replace(f'id="{i}"', f'id="{name}-{i}"').replace(f"url(#{i})", f"url(#{name}-{i})")
    return inner


def symbols(names):
    return "".join(f'<symbol id="p-{n}" viewBox="0 0 {PARTS[n]["w"]} {PARTS[n]["h"]}" overflow="visible">{inner_of(n)}</symbol>' for n in names)


def use(name):
    px, py = PARTS[name]["pivot"]
    return f'<use href="#p-{name}" x="{-px}" y="{-py}" width="{PARTS[name]["w"]}" height="{PARTS[name]["h"]}"/>'


def joint_group(attach, cls, angle, content):
    """Content rotating about a point `attach` in its parent's units: by CSS class (animated) or a fixed angle."""
    rot = f' class="{cls}"' if cls else f' transform="rotate({angle:.1f})"'
    return f'<g transform="translate({attach[0]:.1f},{attach[1]:.1f})"><g{rot}>{content}</g></g>'


def reindeer(k, lead, p=None):
    """One reindeer, origin at its body's pivot. Animated by CSS classes `d{k}-…`, or posed by `p` (a pose())."""
    bp = PARTS["reindeer-body"]["pivot"]
    rel = lambda pt, off=(0, 0): (pt[0] + off[0] - bp[0], pt[1] + off[1] - bp[1])
    cls = (lambda name: None) if p else (lambda name: f"d{k}-{name}")
    ang = (lambda key, i=None: (p[key][i] if i is not None else p[key])) if p else (lambda key, i=None: 0)

    def leg(kind, far):
        key = f"{kind}{'-far' if far else ''}"
        upper, lower = f"reindeer-{kind}-upper{'-far' if far else ''}", f"reindeer-{kind}-lower{'-far' if far else ''}"
        j = R["joints"][kind]
        up_piv = PARTS[upper]["pivot"]
        lower_g = joint_group((j[0] - up_piv[0], j[1] - up_piv[1]), cls(key + "-lower"), ang(key, 1), use(lower))
        return joint_group(rel(R["legs"][kind], R["far_offset"] if far else (0, 0)), cls(key + "-upper"), ang(key, 0), lower_g + use(upper))

    inside = (leg("back", True) + leg("front", True) +
              joint_group(rel(R["tail"]), cls("tail"), ang("tail"), use("reindeer-tail")) +
              leg("back", False) + leg("front", False) +
              use("reindeer-body") +
              joint_group(rel(R["head"]), cls("head"), ang("head"), use("reindeer-head-lead" if lead else "reindeer-head")))
    body = (f'<g class="d{k}-body">{inside}</g>' if not p else
            f'<g transform="translate(0,{p["bob"]:.1f}) rotate({p["pitch"]:.1f})">{inside}</g>')
    return body


def team(x, y, sc, animated, phase=0.3):
    """The sleigh and two reindeer, the sleigh's top-left at (x, y)."""
    sp = PARTS["sleigh"]["pivot"]
    out = []
    first, spacing = R["first"], R["spacing"]
    bp = PARTS["reindeer-body"]["pivot"]
    deer_at = [(first[0] + k * spacing + bp[0], first[1] + bp[1]) for k in range(2)]
    # reins: from Santa's hands to each ring, under everything (drawn live on the canvas)
    hx, hy = RIG["sleigh"]["reins_from"]
    for (dx, dy) in deer_at:
        rx, ry = dx - bp[0] + R["rein_ring"][0], dy - bp[1] + R["rein_ring"][1]
        out.append(f'<path d="M{hx},{hy} Q{(hx + rx) / 2:.0f},{max(hy, ry) + 34:.0f} {rx},{ry}" stroke="#C9A46E" stroke-width="2.2" fill="none"/>')
    arm_at = (RIG["sleigh"]["arm"]["at"][0] - sp[0], RIG["sleigh"]["arm"]["at"][1] - sp[1])
    arm = joint_group(arm_at, "s-arm" if animated else None, 0, use("santa-arm"))
    sl = f'<g class="s-body">{use("sleigh")}{arm}</g>' if animated else f'<g>{use("sleigh")}{arm}</g>'
    out.append(f'<g transform="translate({sp[0]},{sp[1]})">{sl}</g>')
    for k, (dx, dy) in enumerate(deer_at):
        p = None if animated else pose(phase + k * G["second_deer_phase"])
        out.append(f'<g transform="translate({dx},{dy})">{reindeer(k, k == 1, p)}</g>')
    return f'<g transform="translate({x},{y}) scale({sc})">{"".join(out)}</g>'


ALL_PARTS = list(PARTS)


def css_keyframes(name, frames, period, fmt):
    steps = "".join(f"{100 * i / (len(frames) - 1):.2f}% {{ transform: {fmt(v)}; }} " for i, v in enumerate(frames))
    return f"@keyframes {name} {{ {steps}}} .{name} {{ animation: {name} {period}s linear infinite; }}\n"


def team_css(samples=32):
    css = []
    T = G["period"]
    ts = [i / samples for i in range(samples + 1)]
    for k in range(2):
        poses = [pose(t + k * G["second_deer_phase"]) for t in ts]
        for leg in G["phase"]:
            css.append(css_keyframes(f"d{k}-{leg}-upper", [p_[leg][0] for p_ in poses], T, lambda v: f"rotate({v:.1f}deg)"))
            css.append(css_keyframes(f"d{k}-{leg}-lower", [p_[leg][1] for p_ in poses], T, lambda v: f"rotate({v:.1f}deg)"))
        css.append(css_keyframes(f"d{k}-body", [(p_["bob"], p_["pitch"]) for p_ in poses], T, lambda v: f"translate(0px,{v[0]:.1f}px) rotate({v[1]:.1f}deg)"))
        css.append(css_keyframes(f"d{k}-head", [p_["head"] for p_ in poses], T, lambda v: f"rotate({v:.1f}deg)"))
        css.append(css_keyframes(f"d{k}-tail", [p_["tail"] for p_ in poses], T, lambda v: f"rotate({v:.1f}deg)"))
    sg = G["sleigh"]
    css.append(css_keyframes("s-body", [(wave(sg["bob"], t), wave(sg["sway"], t)) for t in ts], T * 2, lambda v: f"translate(0px,{v[0]:.1f}px) rotate({v[1]:.2f}deg)"))
    css.append(css_keyframes("s-arm", [wave(sg["arm"], t) for t in ts], T, lambda v: f"rotate({v:.1f}deg)"))
    return "".join(css)


def snow(w, h, n, seed, cls="fl"):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        x, y, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(1.2, 3.4)
        dur = rnd.uniform(6, 12)
        out.append(f'<circle class="{cls}" cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="#fff" opacity="{rnd.uniform(0.5, 0.95):.2f}" '
                   f'style="--dy:{h + 20}px;--dx:{rnd.uniform(-40, -10):.0f}px;animation-duration:{dur:.1f}s;animation-delay:{-rnd.uniform(0, dur):.1f}s"/>')
    return "".join(out)


SNOW_CSS = ("@keyframes fall { from { transform: translate(0, calc(var(--dy) * -1)); } to { transform: translate(var(--dx), 0); } }"
            ".fl { animation: fall linear infinite; }")
REDUCED = "@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }"
FONT = "'Hanken Grotesk', system-ui, sans-serif"


def doc(w, h, title, style, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="{FONT}" role="img" aria-label="{title}">'
            f'<title>{title}</title><style>{style}\n{REDUCED}</style>{body}</svg>\n')


# ---------------------------------------------------------------- team.svg: the gallop, animated
W, H = 1200, 430
body = [f'<rect width="{W}" height="{H}" fill="#1b140e"/>', f'<defs>{symbols(ALL_PARTS)}</defs>',
        f'<g>{snow(W, H, 70, 1)}</g>', team(40, 70, 1.0, True), f'<g>{snow(W, H, 22, 2)}</g>',
        f'<text x="40" y="{H - 24}" font-size="15" fill="#a89a88">Two-segment legs on a rotary gallop (gait in parts.json): knees fold on the lift, hocks drive back; the body pitches and rises once a stride, the head counters it, the tail flicks.</text>']
with open(os.path.join(OUT, "team.svg"), "w") as f:
    f.write(doc(W, H, "The sleigh team galloping: two-segment legs, body pitch and bob, head and tail motion", SNOW_CSS + team_css(), "".join(body)))

# ---------------------------------------------------------------- lanterns.svg: Sankt Martin's walk
L = RIG["lantern"]
W, H = 1200, 330
lan = []
css = [SNOW_CSS]
for i, name in enumerate(("lantern-sun", "lantern-moon", "lantern-star", "lantern-sun")):
    lag = i * 0.23
    ts = [j / 32 for j in range(33)]
    # the child's step bobs the stick; the lantern swings behind the bob, like a pendulum that lags
    bob = [L["bob"] * abs(math.sin(math.pi * (t + lag))) for t in ts]
    sw = [L["swing"] * math.sin(2 * math.pi * (t + lag - L["damping_lag"])) for t in ts]
    css.append(css_keyframes(f"lb{i}", bob, L["walk_period"], lambda v: f"translate(0px,{-v:.1f}px)"))
    css.append(css_keyframes(f"ls{i}", sw, L["walk_period"], lambda v: f"rotate({v:.1f}deg)"))
    x = 170 + i * 260
    lan.append(f'<g transform="translate({x},70)"><g class="lb{i}"><path d="M0,0 L-30,200" stroke="#8A6236" stroke-width="4" stroke-linecap="round"/>'
               f'<g class="ls{i}">{use(name)}</g></g></g>')
with open(os.path.join(OUT, "lanterns.svg"), "w") as f:
    f.write(doc(W, H, "Sankt Martin: paper lanterns carried on sticks, bobbing with each step and swinging behind it",
                "".join(css), f'<rect width="{W}" height="{H}" fill="#14100c"/><defs>{symbols(ALL_PARTS)}</defs>{"".join(lan)}'
                f'<text x="40" y="{H - 24}" font-size="15" fill="#a89a88">Each step bobs the stick; the lantern swings behind it like a pendulum, each child a little out of step.</text>'))

# ---------------------------------------------------------------- sheet.svg: every part, and a frozen moment of the gallop
W, H = 1200, 1010
LABEL = {"sleigh": "sleigh", "santa-arm": "Santa's arm", "reindeer-body": "body", "reindeer-head": "head", "reindeer-head-lead": "lead head",
         "reindeer-tail": "tail", "reindeer-front-upper": "front upper", "reindeer-front-lower": "lower", "reindeer-back-upper": "back upper",
         "reindeer-back-lower": "lower", "boot-empty": "Nikolaus · 5 Dec, evening", "boot-filled": "Nikolaus · 6 Dec, morning",
         "lantern-sun": "Sankt Martin · sun", "lantern-moon": "moon", "lantern-star": "star"}


def place(name, x, y, sc=1.0):
    w, h = PARTS[name]["w"], PARTS[name]["h"]
    return (f'<use href="#p-{name}" x="{x}" y="{y}" width="{w*sc:.0f}" height="{h*sc:.0f}"/>'
            f'<text x="{x + w*sc/2:.0f}" y="{y + h*sc + 22:.0f}" text-anchor="middle" font-size="14" fill="#a89a88">{LABEL.get(name, name)}</text>')


sheet = [f'<rect width="{W}" height="{H}" fill="#1b140e"/>', f'<defs>{symbols(ALL_PARTS)}</defs>',
         '<text x="40" y="52" font-size="22" font-weight="700" fill="#f2ebe0">RFC-020 art, part by part</text>',
         '<text x="40" y="78" font-size="14" fill="#a89a88">Each part is its own SVG with a pivot; the canvas rasterises it once and only moves it. Light from the top left, no outlines.</text>',
         team(40, 110, 0.9, False, 0.3),
         '<text x="40" y="420" font-size="14" fill="#a89a88">One moment of the gallop, posed by the rig (parts.json). team.svg shows it moving.</text>']
x = 40
for name, sc in (("sleigh", 0.55), ("santa-arm", 1.2), ("reindeer-body", 0.8), ("reindeer-head", 0.8), ("reindeer-head-lead", 0.8), ("reindeer-tail", 1.2)):
    sheet.append(place(name, x, 470, sc))
    x += PARTS[name]["w"] * sc + 30
x = 40
for name in ("reindeer-front-upper", "reindeer-front-lower", "reindeer-back-upper", "reindeer-back-lower",
             "reindeer-front-upper-far", "reindeer-front-lower-far", "reindeer-back-upper-far", "reindeer-back-lower-far"):
    sheet.append(f'<use href="#p-{name}" x="{x}" y="660" width="{PARTS[name]["w"]}" height="{PARTS[name]["h"]}"/>')
    x += PARTS[name]["w"] + 26
sheet.append('<text x="40" y="760" font-size="14" fill="#a89a88">Legs in two segments, near and far: upper (shoulder or hip to knee or hock) and lower (to the hoof).</text>')
x = 560
for name in ("boot-empty", "boot-filled"):
    sheet.append(place(name, x, 620, 0.85))
    x += 180
x = 40
for name in ("lantern-sun", "lantern-moon", "lantern-star"):
    sheet.append(place(name, x, 790, 0.85))
    x += 150
with open(os.path.join(OUT, "sheet.svg"), "w") as f:
    f.write(doc(W, H, "The RFC-020 art, part by part", "", "".join(sheet)))

with open(os.path.join(OUT, "parts.json"), "w") as f:
    json.dump({"parts": PARTS, "rig": RIG}, f, indent=1)
print("parts:", len(PARTS))

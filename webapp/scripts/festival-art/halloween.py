"""Halloween's art (RFC-020 §3.3): friendly bats bursting out of a corner,
sweets they drop when one is tapped, a cobweb on the cards' corners and two
pumpkins, one carved with a smile and lit, on the Tasks card.

    python3 webapp/scripts/festival-art/halloween.py

Cute rather than frightening: round bats with big eyes, a little spider on
its thread. The witch's hat is the shop's `wizard_hat`.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad, blur

art = Art("halloween")


# ---------------------------------------------------------------- the bat
def bat():
    """100 x 60, pivot at its middle: wings spread, scalloped, the fingers showing; a round furry body, ears, big eyes. `flap` squashes it."""
    rnd = random.Random(3)
    defs = (rad("bbody", [(0, "#8A6BB8", None), (0.55, "#4A3470", None), (1, "#251838", None)], fx=0.35, fy=0.3) +
            lin("bwing", [(0, "#7A5CA8", None), (0.6, "#4E3678", None), (1, "#2E1E48", None)], 0, 0, 0.4, 1) +
            rad("beye", [(0, "#FFFFFF", None), (1, "#E8E0F4", None)]) +
            rad("bear", [(0, "#FF9AC0", None), (1, "#C25A8E", None)]))

    def wing(side):
        # Shoulder at (50 + side*8, 26), tip out at the side; three scallops along its trailing edge.
        s = side
        x = lambda v: 50 + s * v
        return (f'<path d="M{x(8)},22 C{x(20)},10 {x(34)},4 {x(47)},8 C{x(44)},14 {x(42)},20 {x(44)},30 '
                f'C{x(38)},26 {x(32)},27 {x(30)},34 C{x(25)},29 {x(19)},30 {x(17)},37 C{x(14)},33 {x(10)},33 {x(8)},36 Z" fill="url(#bwing)"/>'
                f'<path d="M{x(10)},24 L{x(46)},9 M{x(12)},26 L{x(30)},33 M{x(11)},26 L{x(17)},36 M{x(12)},25 L{x(43)},29" '
                f'stroke="#9C82C8" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="0.6"/>')
    body = [
        wing(-1), wing(1),
        '<path d="M42,14 L40,2 L48,10 Z M58,14 L60,2 L52,10 Z" fill="#3A2858"/>',
        '<path d="M42.5,11 L41.5,5 L46,9.5 Z M57.5,11 L58.5,5 L54,9.5 Z" fill="url(#bear)"/>',
        '<ellipse cx="50" cy="28" rx="13" ry="16" fill="url(#bbody)"/>',
        "".join(f'<path d="M{50 + rnd.uniform(-9, 9):.1f},{30 + rnd.uniform(-2, 11):.1f} q1,1.6 0,3" stroke="#6B5294" stroke-width="0.9" fill="none" opacity="0.6"/>' for _ in range(14)),
        '<circle cx="45" cy="23" r="4.2" fill="url(#beye)"/><circle cx="55" cy="23" r="4.2" fill="url(#beye)"/>',
        '<circle cx="45.8" cy="23.6" r="2.4" fill="#2A1A3E"/><circle cx="55.8" cy="23.6" r="2.4" fill="#2A1A3E"/>',
        '<circle cx="45" cy="22.4" r="0.9" fill="#FFFFFF"/><circle cx="55" cy="22.4" r="0.9" fill="#FFFFFF"/>',
        '<path d="M46.5,30 Q50,32.5 53.5,30" stroke="#2A1A3E" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
        '<path d="M47.6,30.6 l0.7,2 l0.7,-1.8 Z M51,30.8 l0.7,1.8 l0.7,-2 Z" fill="#FFFFFF"/>',
        '<circle cx="41.5" cy="28" r="2" fill="#FF8FB0" opacity="0.45"/><circle cx="58.5" cy="28" r="2" fill="#FF8FB0" opacity="0.45"/>',
        '<ellipse cx="45" cy="16" rx="4" ry="2" fill="#FFFFFF" opacity="0.25" transform="rotate(-25 45 16)"/>',
    ]
    art.part("bat", 100, 48, (50, 26), "\n".join(body), defs)


# ---------------------------------------------------------------- sweets, for the tap
def sweet(name, light, colour, shade):
    """40 x 24: a wrapped sweet, twisted at both ends, a stripe and a shine."""
    defs = rad("w", [(0, light, None), (0.55, colour, None), (1, shade, None)], fx=0.35, fy=0.3)
    body = (f'<path d="M12,12 L2,4 C0,8 0,16 2,20 Z" fill="url(#w)"/><path d="M28,12 L38,4 C40,8 40,16 38,20 Z" fill="url(#w)"/>'
            f'<ellipse cx="20" cy="12" rx="10" ry="8" fill="url(#w)"/>'
            f'<path d="M14,6 C18,10 18,14 14,18 M22,4.5 C26,9 26,15 22,19.5" stroke="#FFFFFF" stroke-width="1.8" fill="none" opacity="0.55"/>'
            f'<ellipse cx="16.5" cy="8" rx="3" ry="1.5" fill="#FFFFFF" opacity="0.6" transform="rotate(-20 16.5 8)"/>')
    art.part(name, 40, 24, (20, 12), body, defs)


def lollipop():
    """28 x 44: a swirl lollipop on its stick."""
    defs = rad("lp", [(0, "#FFFFFF", None), (0.5, "#FFB14A", None), (1, "#E0672A", None)], fx=0.35, fy=0.3)
    swirl = " ".join(f"{14 + math.cos(a) * a * 1.15:.1f},{14 + math.sin(a) * a * 1.15:.1f}" for a in [i * 0.3 for i in range(36)])
    body = (f'<rect x="12.6" y="22" width="2.8" height="21" rx="1.4" fill="#E3D5BC"/><rect x="12.6" y="22" width="1.2" height="21" rx="0.6" fill="#FFFFFF" opacity="0.7"/>'
            f'<circle cx="14" cy="14" r="12.5" fill="url(#lp)"/>'
            f'<polyline points="{swirl}" stroke="#8A4FE0" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.85"/>'
            f'<ellipse cx="9.5" cy="8.5" rx="3.6" ry="2" fill="#FFFFFF" opacity="0.6" transform="rotate(-35 9.5 8.5)"/>')
    art.part("lollipop", 28, 44, (14, 14), body, defs)


# ---------------------------------------------------------------- the dressing
def cobweb():
    """60 x 60 units (30 x 30 px), the card's corner at (28, 28): a web across the corner, threads pale with a soft shadow, so it reads on light and dark; a little spider on its thread."""
    cx = cy = 4
    threads = [math.radians(a) for a in (2, 22, 45, 68, 88)]
    rings = [12, 22, 33, 45]
    paths = []
    for a in threads:
        paths.append(f"M{cx},{cy} L{cx + math.cos(a) * 54:.1f},{cy + math.sin(a) * 54:.1f}")
    for r in rings:
        seg = []
        for i, a in enumerate(threads):
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            if i == 0:
                seg.append(f"M{x:.1f},{y:.1f}")
            else:
                # Each strand sags towards the corner between two threads.
                m = (a + threads[i - 1]) / 2
                qx, qy = cx + math.cos(m) * r * 0.82, cy + math.sin(m) * r * 0.82
                seg.append(f"Q{qx:.1f},{qy:.1f} {x:.1f},{y:.1f}")
        paths.append(" ".join(seg))
    d = " ".join(paths)
    defs = rad("sp", [(0, "#8A6BB8", None), (1, "#2E1E48", None)], fx=0.35, fy=0.3)
    sx, sy = 36, 44
    body = [
        f'<path d="{d}" stroke="#4A3470" stroke-width="1.4" fill="none" opacity="0.3" transform="translate(0.8 0.8)"/>',
        f'<path d="{d}" stroke="#E8E2F2" stroke-width="1" fill="none" opacity="0.9"/>',
        f'<path d="M{sx},{24} L{sx},{sy - 3}" stroke="#E8E2F2" stroke-width="0.7"/>',
        # the spider: eight short legs, a round body, two white eyes
        "".join(f'<path d="M{sx},{sy} q{side * 4},{-3 + k * 2} {side * 6.5},{-1 + k * 2.6}" stroke="#2E1E48" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
                for side in (-1, 1) for k in range(4)),
        f'<circle cx="{sx}" cy="{sy}" r="4" fill="url(#sp)"/>',
        f'<circle cx="{sx - 1.4}" cy="{sy - 0.6}" r="1.1" fill="#FFFFFF"/><circle cx="{sx + 1.4}" cy="{sy - 0.6}" r="1.1" fill="#FFFFFF"/>',
        f'<circle cx="{sx - 1.2}" cy="{sy - 0.4}" r="0.5" fill="#2A1A3E"/><circle cx="{sx + 1.6}" cy="{sy - 0.4}" r="0.5" fill="#2A1A3E"/>',
    ]
    art.still("cobweb", ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="30" height="30">\n'
                         f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


def pumpkin(uid, cx, base, w, carved):
    """A pumpkin `w` wide standing at (cx, base): ribbed lobes lit from the top left, a stem, and if `carved`, a smiling face glowing from inside."""
    h = w * 0.72
    cy = base - h / 2
    defs = (rad(f"{uid}o", [(0, "#FFC46B", None), (0.5, "#F2801E", None), (1, "#B5450A", None)], cx=0.4, cy=0.38, r=0.7, fx=0.32, fy=0.28) +
            rad(f"{uid}e", [(0, "#F7A04A", None), (1, "#A83E08", None)], cx=0.4, cy=0.4, fx=0.3, fy=0.3) +
            lin(f"{uid}s", [(0, "#8BB050", None), (1, "#4E6A22", None)]) +
            rad(f"{uid}l", [(0, "#FFF6B0", None), (0.5, "#FFC83D", None), (1, "#FF8A1F", None)]))
    out = []
    # Outer lobes first, then the middle one over them.
    for dx, rx in ((-0.3, 0.26), (0.3, 0.26), (-0.14, 0.27), (0.14, 0.27)):
        out.append(f'<ellipse cx="{cx + dx * w:.1f}" cy="{cy:.1f}" rx="{rx * w:.1f}" ry="{h / 2:.1f}" fill="url(#{uid}e)"/>')
    out.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{0.22 * w:.1f}" ry="{h / 2 * 1.02:.1f}" fill="url(#{uid}o)"/>')
    out.append(f'<ellipse cx="{cx - 0.2 * w:.1f}" cy="{cy - h * 0.22:.1f}" rx="{w * 0.08:.1f}" ry="{h * 0.07:.1f}" fill="#FFFFFF" opacity="0.4" transform="rotate(-30 {cx - 0.2 * w:.1f} {cy - h * 0.22:.1f})"/>')
    # stem and a curl of vine
    top = base - h
    out.append(f'<path d="M{cx - w * 0.04:.1f},{top + h * 0.06:.1f} C{cx - w * 0.05:.1f},{top - h * 0.12:.1f} {cx + w * 0.02:.1f},{top - h * 0.2:.1f} {cx + w * 0.1:.1f},{top - h * 0.2:.1f} '
               f'L{cx + w * 0.1:.1f},{top - h * 0.1:.1f} C{cx + w * 0.05:.1f},{top - h * 0.08:.1f} {cx + w * 0.05:.1f},{top:.1f} {cx + w * 0.05:.1f},{top + h * 0.06:.1f} Z" fill="url(#{uid}s)"/>')
    out.append(f'<path d="M{cx + w * 0.04:.1f},{top + h * 0.02:.1f} c{w * 0.1:.1f},{-h * 0.02:.1f} {w * 0.16:.1f},{h * 0.08:.1f} {w * 0.1:.1f},{h * 0.12:.1f} c{-w * 0.04:.1f},{h * 0.02:.1f} {-w * 0.06:.1f},{-h * 0.04:.1f} {-w * 0.02:.1f},{-h * 0.06:.1f}" '
               f'stroke="#6B8A2E" stroke-width="{w * 0.018:.1f}" fill="none" stroke-linecap="round"/>')
    if carved:
        # A friendly face: round eyes, a smile with two teeth, lit from inside.
        e = w * 0.075
        face = (f'<path d="M{cx - w * 0.2:.1f},{cy - h * 0.08:.1f} q{e:.1f},{-e * 1.6:.1f} {e * 2:.1f},0 q{-e:.1f},{e * 0.6:.1f} {-e * 2:.1f},0 Z" fill="url(#{uid}l)"/>'
                f'<path d="M{cx + w * 0.05:.1f},{cy - h * 0.08:.1f} q{e:.1f},{-e * 1.6:.1f} {e * 2:.1f},0 q{-e:.1f},{e * 0.6:.1f} {-e * 2:.1f},0 Z" fill="url(#{uid}l)"/>'
                f'<path d="M{cx - w * 0.22:.1f},{cy + h * 0.08:.1f} Q{cx:.1f},{cy + h * 0.38:.1f} {cx + w * 0.22:.1f},{cy + h * 0.08:.1f} '
                f'L{cx + w * 0.1:.1f},{cy + h * 0.13:.1f} L{cx + w * 0.07:.1f},{cy + h * 0.2:.1f} L{cx + w * 0.03:.1f},{cy + h * 0.15:.1f} '
                f'L{cx - w * 0.05:.1f},{cy + h * 0.16:.1f} L{cx - w * 0.08:.1f},{cy + h * 0.22:.1f} L{cx - w * 0.11:.1f},{cy + h * 0.14:.1f} Z" fill="url(#{uid}l)"/>')
        out.append(face)
    else:
        # A leaf at the plain one's stem.
        lx, ly = cx + w * 0.16, top + h * 0.08
        out.append(f'<path d="M{lx:.1f},{ly:.1f} C{lx + w * 0.1:.1f},{ly - h * 0.3:.1f} {lx + w * 0.34:.1f},{ly - h * 0.2:.1f} {lx + w * 0.3:.1f},{ly + h * 0.04:.1f} C{lx + w * 0.2:.1f},{ly + h * 0.1:.1f} {lx + w * 0.06:.1f},{ly + h * 0.06:.1f} {lx:.1f},{ly:.1f} Z" fill="#7FA43E"/>'
                   f'<path d="M{lx:.1f},{ly:.1f} L{lx + w * 0.26:.1f},{ly - h * 0.06:.1f}" stroke="#C9E08A" stroke-width="0.9" opacity="0.7"/>')
    return defs, "".join(out)


def pumpkins():
    """120 x 80 units (60 x 40 px): a carved pumpkin and a small plain one, standing on the card's top edge at y = 76."""
    defs = blur("ps", 2)
    body = ['<ellipse cx="60" cy="76" rx="54" ry="3.5" fill="#1A0E06" opacity="0.35" filter="url(#ps)"/>',
]
    for uid, (cx, w, carved) in (("b", (48, 74, True)), ("s", (94, 40, False))):
        d, b = pumpkin(uid, cx, 76, w, carved)
        defs += d
        body.append(b)
    art.still("pumpkins", ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="60" height="40">\n'
                           f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


bat()
sweet("sweet-orange", "#FFD9A0", "#F2801E", "#B5450A")
sweet("sweet-purple", "#D7BDFF", "#8A4FE0", "#4E2A9A")
lollipop()
cobweb()
pumpkins()
art.finish()

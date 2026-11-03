"""Mother's Day's art (RFC-020 §3.3), and Father's Day's: flowers that bloom
up from the bottom of the screen, each a head on a short stem with a leaf.
Mother's Day flies the rose, the tulip, the carnation and the daisy;
Father's Day (kits/fathers-day.ts, which borrows this folder) the
sunflower, the cornflower, the daisy and forget-me-nots.

    python3 webapp/scripts/festival-art/mothers-day.py

Every flower is drawn in 64 x 92 units, its head round (32, 32), the pivot: the `rise`
archetype blooms it in from nothing about that point and sways it there.
"""
import math, random, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad

art = Art("mothers-day")

W, H, PIVOT = 64, 92, (32, 32)
# Drawn in 64 x 92 units and stored 1.4 times that, so a flower is as crisp as
# it is big on a wall (56px across on a 1080p screen).
BIG = 1.4
STEM_DEFS = (lin("stem", [(0, "#7FCB5A", None), (1, "#3E8A3A", None)], 0, 0, 1, 0) +
             lin("leaf", [(0, "#A8E07A", None), (0.6, "#5DB04A", None), (1, "#3A7F34", None)], 0, 0, 1, 1))


def stem(rnd, top=48, side=1):
    """A short curved stem from under the head, one leaf off it."""
    bend = rnd.uniform(-5, 5)
    ly = rnd.uniform(64, 74)
    return (f'<path d="M32,{top} C{32 + bend},{(top + 90) / 2:.1f} {32 - bend * 0.6:.1f},80 {32 + bend * 0.3:.1f},90" stroke="url(#stem)" stroke-width="3.4" fill="none" stroke-linecap="round"/>'
            f'<g transform="translate({32 + bend * 0.3:.1f} {ly:.1f}) scale({side} 1)">'
            '<path d="M0,0 C6,-10 18,-12 24,-8 C18,-2 8,2 0,0 Z" fill="url(#leaf)"/>'
            '<path d="M1,-0.5 C8,-5 15,-7 21,-7.5" stroke="#2F6B2A" stroke-width="0.7" fill="none" opacity="0.5"/>'
            '<path d="M5,-5 C9,-8 14,-9.5 18,-9.5" stroke="#FFFFFF" stroke-width="0.9" fill="none" opacity="0.5" stroke-linecap="round"/>'
            "</g>")


def write(name, head, defs, rnd, side=1, top=48):
    art.part(name, round(W * BIG), round(H * BIG), (PIVOT[0] * BIG, PIVOT[1] * BIG), f'<g transform="scale({BIG})">' + stem(rnd, top, side) + head + "</g>",
             STEM_DEFS + defs, "pivot at the head's middle: it blooms in and sways there")


def rose():
    rnd = random.Random(81)
    defs = (rad("p", [(0, "#FFD0DC", None), (0.55, "#FF7FA0", None), (1, "#D93F68", None)], cx=0.38, cy=0.3, r=0.85) +
            rad("p2", [(0, "#FFB3C6", None), (1, "#E0587E", None)], cx=0.4, cy=0.35) +
            lin("sepal", [(0, "#7FCB5A", None), (1, "#3E8A3A", None)]))
    head = ['<path d="M24,46 L32,40 L40,46 L36,50 L28,50 Z" fill="url(#sepal)"/>',
            # Outer petals, a cup.
            '<path d="M10,30 C8,16 20,8 32,10 C44,8 56,16 54,30 C54,42 44,50 32,50 C20,50 10,42 10,30 Z" fill="url(#p)"/>',
            '<path d="M12,32 C14,44 24,50 32,50 C26,46 18,40 16,30 Z" fill="#C93560" opacity="0.35"/>',
            # The swirl of inner petals.
            '<path d="M20,26 C20,16 34,12 42,18 C48,24 44,34 36,36 C28,38 22,34 22,28" fill="url(#p2)"/>',
            '<path d="M26,26 C26,20 36,18 39,23 C42,28 36,32 32,31 C28,30 27,27 29,25" stroke="#C93560" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
            '<path d="M20,28 C20,36 28,42 38,40" stroke="#C93560" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.6"/>',
            '<path d="M14,22 C18,14 26,11 32,11" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>',
            '<ellipse cx="34" cy="21" rx="4" ry="2" fill="#FFFFFF" opacity="0.5" transform="rotate(-20 34 21)"/>']
    write("rose", "".join(head), defs, rnd, side=-1)


def tulip():
    rnd = random.Random(82)
    defs = (lin("t", [(0, "#FFB0A0", None), (0.5, "#FF5A6E", None), (1, "#C9233F", None)], 0.2, 0, 0.8, 1) +
            lin("t2", [(0, "#FF8C8C", None), (1, "#B81C38", None)], 0, 0, 1, 1))
    head = ['<path d="M14,18 C12,32 18,48 32,50 C46,48 52,32 50,18 C44,24 40,22 38,14 C36,20 28,20 26,14 C24,22 20,24 14,18 Z" fill="url(#t)"/>',
            '<path d="M26,14 C24,26 26,40 32,50 C38,40 40,26 38,14 C36,20 28,20 26,14 Z" fill="url(#t2)"/>',
            '<path d="M18,24 C18,34 22,42 28,46" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>',
            '<path d="M30,18 C29,28 30,38 32,46" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.35" stroke-linecap="round"/>']
    write("tulip", "".join(head), defs, rnd, side=1)


def carnation():
    rnd = random.Random(83)
    defs = (rad("c", [(0, "#FFE0EA", None), (0.6, "#FF9FBC", None), (1, "#E8648C", None)], cx=0.4, cy=0.3, r=0.85) +
            lin("cal", [(0, "#8FD06A", None), (1, "#3E8A3A", None)]))
    head = ['<path d="M26,40 C26,48 28,54 32,56 C36,54 38,48 38,40 Z" fill="url(#cal)"/>']
    # Frilled petals, ring by ring from the back, each edge pinked.
    for ring, (r, n, y0) in enumerate(((20, 11, 30), (15, 9, 26), (9, 7, 22))):
        for k in range(n):
            a = math.pi + (k + 0.5) / n * math.pi + rnd.uniform(-0.05, 0.05)
            x, y = 32 + math.cos(a) * r * 0.55, y0 + math.sin(a) * r * 0.45
            tip = 32 + math.cos(a) * r, y0 + math.sin(a) * r * 0.8
            teeth = " ".join(f"L{tip[0] + math.cos(a + d) * 3:.1f},{tip[1] + math.sin(a + d) * 3:.1f}" for d in (-0.9, -0.3, 0.3, 0.9))
            head.append(f'<path d="M{32 + math.cos(a - 0.4) * 2:.1f},{y0 + 10:.1f} L{tip[0] + math.cos(a - 1.3) * 5:.1f},{tip[1] + math.sin(a - 1.3) * 5:.1f} {teeth} '
                        f'L{tip[0] + math.cos(a + 1.3) * 5:.1f},{tip[1] + math.sin(a + 1.3) * 5:.1f} Z" fill="url(#c)" opacity="{0.92 + ring * 0.04:.2f}"/>')
    head += ['<path d="M18,22 C22,14 28,12 34,12" stroke="#FFFFFF" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.65"/>']
    write("carnation", "".join(head), defs, rnd, side=-1, top=54)


def daisy():
    rnd = random.Random(84)
    defs = (lin("pt", [(0, "#FFFFFF", None), (1, "#E8E4F4", None)], 0, 0, 0, 1) +
            rad("ctr", [(0, "#FFE680", None), (0.6, "#F7B924", None), (1, "#D98A0A", None)], cx=0.38, cy=0.32))
    head = []
    for k in range(16):
        a = k / 16 * 2 * math.pi + 0.1
        head.append(f'<ellipse cx="{32 + math.cos(a) * 12:.1f}" cy="{32 + math.sin(a) * 12:.1f}" rx="10" ry="3.6" fill="url(#pt)" transform="rotate({math.degrees(a):.1f} {32 + math.cos(a) * 12:.1f} {32 + math.sin(a) * 12:.1f})"/>')
    head += ['<circle cx="32" cy="32" r="8" fill="url(#ctr)"/>',
             "".join(f'<circle cx="{32 + rnd.uniform(-5, 5):.1f}" cy="{32 + rnd.uniform(-5, 5):.1f}" r="0.8" fill="#B8700A" opacity="0.6"/>' for _ in range(12)),
             '<ellipse cx="29.5" cy="29" rx="3" ry="1.8" fill="#FFFFFF" opacity="0.6" transform="rotate(-30 29.5 29)"/>']
    write("daisy", "".join(head), defs, rnd, side=1)


def sunflower():
    rnd = random.Random(85)
    defs = (lin("sp", [(0, "#FFE066", None), (1, "#F2A60F", None)], 0, 0, 0, 1) +
            rad("seed", [(0, "#8A5A2E", None), (0.7, "#5E3A1A", None), (1, "#3E240E", None)], cx=0.38, cy=0.32))
    head = []
    for ring, (n, l, off) in enumerate(((18, 13, 0.0), (18, 11, 0.17))):
        for k in range(n):
            a = (k + off) / n * 2 * math.pi
            x, y = 32 + math.cos(a) * (10 + l * 0.5), 32 + math.sin(a) * (10 + l * 0.5)
            head.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{l * 0.55:.1f}" ry="2.9" fill="url(#sp)" opacity="{0.85 + 0.15 * ring:.2f}" transform="rotate({math.degrees(a):.1f} {x:.1f} {y:.1f})"/>')
    head += ['<circle cx="32" cy="32" r="11" fill="url(#seed)"/>',
             "".join(f'<circle cx="{32 + math.cos(k * 2.39996) * math.sqrt(k) * 1.5:.1f}" cy="{32 + math.sin(k * 2.39996) * math.sqrt(k) * 1.5:.1f}" r="0.7" fill="#C98F4A" opacity="0.7"/>' for k in range(1, 46)),
             '<ellipse cx="28.5" cy="28" rx="3.5" ry="2" fill="#FFFFFF" opacity="0.3" transform="rotate(-30 28.5 28)"/>']
    write("sunflower", "".join(head), defs, rnd, side=-1)


def cornflower():
    rnd = random.Random(86)
    defs = (lin("cf", [(0, "#9CC8FF", None), (0.5, "#4D86F0", None), (1, "#2A55C4", None)], 0, 0, 0, 1) +
            rad("cc", [(0, "#8A6BE0", None), (1, "#3E2A9E", None)]) +
            lin("cal", [(0, "#8FD06A", None), (1, "#3E8A3A", None)]))
    head = ['<path d="M26,40 C26,46 29,50 32,50 C35,50 38,46 38,40 Z" fill="url(#cal)"/>']
    for k in range(11):
        a = math.pi * (0.95 + k / 10 * 1.1)
        tx, ty = 32 + math.cos(a) * 22, 34 + math.sin(a) * 20
        # Each floret a little trumpet with a toothed mouth.
        p1, p2 = a - 0.22, a + 0.22
        head.append(f'<path d="M32,36 L{32 + math.cos(p1) * 22:.1f},{34 + math.sin(p1) * 20:.1f} '
                    f'L{tx + math.cos(a - 0.9) * 2:.1f},{ty + math.sin(a - 0.9) * 2:.1f} L{tx + math.cos(a) * 3:.1f},{ty + math.sin(a) * 3:.1f} '
                    f'L{tx + math.cos(a + 0.9) * 2:.1f},{ty + math.sin(a + 0.9) * 2:.1f} L{32 + math.cos(p2) * 22:.1f},{34 + math.sin(p2) * 20:.1f} Z" fill="url(#cf)"/>')
    head += ['<circle cx="32" cy="31" r="6" fill="url(#cc)"/>',
             "".join(f'<path d="M32,31 L{32 + math.cos(a) * 7:.1f},{31 + math.sin(a) * 7:.1f}" stroke="#2A1E6E" stroke-width="0.9"/>' for a in [math.pi * (1 + i / 6) for i in range(7)]),
             '<path d="M14,30 C16,22 22,16 28,14" stroke="#FFFFFF" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.5"/>']
    write("cornflower", "".join(head), defs, rnd, side=1)


def forget_me_not():
    rnd = random.Random(87)
    defs = (rad("fm", [(0, "#D6ECFF", None), (0.6, "#7DB8FF", None), (1, "#4A8BE6", None)], cx=0.4, cy=0.35) +
            lin("stem2", [(0, "#7FCB5A", None), (1, "#3E8A3A", None)]))
    head = ['<path d="M32,40 C28,36 22,34 18,30 M32,40 C36,36 42,34 46,28 M32,40 L32,24" stroke="url(#stem2)" stroke-width="1.6" fill="none" stroke-linecap="round"/>']
    for (cx, cy, r) in ((32, 22, 8), (18, 30, 7), (46, 28, 7.5), (25, 40, 6), (40, 42, 6.2)):
        for k in range(5):
            a = k / 5 * 2 * math.pi - math.pi / 2 + rnd.uniform(-0.1, 0.1)
            head.append(f'<circle cx="{cx + math.cos(a) * r * 0.55:.1f}" cy="{cy + math.sin(a) * r * 0.55:.1f}" r="{r * 0.45:.1f}" fill="url(#fm)"/>')
        head.append(f'<circle cx="{cx}" cy="{cy}" r="{r * 0.24:.1f}" fill="#FFE066"/><circle cx="{cx}" cy="{cy}" r="{r * 0.1:.1f}" fill="#F2A60F"/>')
        head.append(f'<ellipse cx="{cx - r * 0.45:.1f}" cy="{cy - r * 0.5:.1f}" rx="{r * 0.18:.1f}" ry="{r * 0.1:.1f}" fill="#FFFFFF" opacity="0.7" transform="rotate(-35 {cx - r * 0.45:.1f} {cy - r * 0.5:.1f})"/>')
    write("forget-me-not", "".join(head), defs, rnd, side=-1, top=40)


rose(); tulip(); carnation(); daisy(); sunflower(); cornflower(); forget_me_not()
art.finish()

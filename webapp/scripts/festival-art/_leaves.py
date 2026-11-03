"""Autumn leaves, drawn once for every festival that has them (RFC-020 §3.3):
Sukkot's leaves drifting down and hanging from the cards, Thanksgiving's
blowing across and lying round the pie. Not a festival's script itself: the
scripts import it, so a leaf is drawn by one function wherever it shows.

    from _leaves import leaf, LEAF_COLOURS
    defs, body = leaf("maple", "red", "m1", cx=32, cy=32, size=56, turn=-10)

A leaf is a gradient lit from the top left, darker on the right of its
midrib, with lighter veins, a few darker speckles of autumn, a soft sheen
and its stem; no outline (§5.1).
"""
import math, random

# Each colour: light (where the light falls), base, shade, and the veins.
LEAF_COLOURS = {
    "red": ("#FF8A6B", "#D9433A", "#8E1F26", "#FFB49C"),
    "orange": ("#FFC46B", "#F28C28", "#B5501E", "#FFD9A0"),
    "gold": ("#FFE58A", "#F2C23A", "#B07A12", "#FFF3C2"),
    "brown": ("#D9A774", "#A8642E", "#6B3B1A", "#E9C79B"),
    "green": ("#C9E08A", "#8DB542", "#4E7A22", "#E2F0B8"),
}


def _outline(kind, size):
    """The leaf's edge as points round (0, 0), its stem end at the bottom and its tip at the top, `size` long."""
    pts = []
    R = size / 2
    if kind == "maple":
        # Five lobes, pointed and toothed, on a polar curve; the stem's notch at the bottom.
        # Five broad lobes on a polar curve, each pointed at its tip with a
        # smaller point either side; the stem's notch at the bottom.
        lobes = [(-90, 1.0), (-90 - 56, 0.92), (-90 + 56, 0.92), (-90 - 112, 0.66), (-90 + 112, 0.66)]
        for i in range(300):
            th = 2 * math.pi * i / 300
            deg = math.degrees(th)
            f = 0.0
            for a, L in lobes:
                d = abs(math.radians(((deg - a + 180) % 360) - 180))
                lobe = 0.5 + (L - 0.5) * max(0.0, 1 - d / 0.5) ** 1.5
                side = 0.16 * max(0.0, 1 - abs(d - 0.3) / 0.09) * (L / 1.0)
                f = max(f, lobe + side)
            f *= 1 + 0.035 * max(0.0, math.sin(th * 36))
            near_stem = abs(((deg - 90 + 180) % 360) - 180)
            if near_stem < 34:
                f = min(f, 0.3 + near_stem / 34 * 0.22)
            pts.append((math.cos(th) * f * R, math.sin(th) * f * R * 0.95 + R * 0.08))
        return pts
    # Oak, elm: a half-width along the midrib from the stem (s = 0) to the tip (s = 1).
    n = 60
    if kind == "oak":
        L, W = size * 0.92, size * 0.27

        def half(s):
            return W * math.sin(math.pi * s) ** 0.6 * (0.55 + 0.45 * abs(math.cos(math.pi * s * 3.5 + 0.3)))
    else:  # elm: an oval, pointed at the tip, finely toothed
        L, W = size * 0.92, size * 0.28

        def half(s):
            return W * math.sin(math.pi * s ** 0.8) ** 0.85 * (1 + 0.06 * abs(math.sin(s * 44)))
    y0 = L / 2
    right = [(half(i / n), y0 - L * i / n) for i in range(n + 1)]
    left = [(-x * (0.94 if kind == "elm" else 1.0), y) for x, y in reversed(right)]
    return right + left


def _path(pts):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"


def leaf(kind, colour, uid, cx, cy, size, turn=0.0, seed=0, sheen=True):
    """One leaf at (cx, cy), `size` long, turned `turn` degrees: (defs, body)."""
    light, base, shade, vein = LEAF_COLOURS[colour]
    rnd = random.Random(f"{kind}{colour}{seed}")
    pts = _outline(kind, size)
    d = _path(pts)
    R = size / 2
    defs = (f'<radialGradient id="{uid}g" cx="0.32" cy="0.26" r="0.85"><stop offset="0" stop-color="{light}"/>'
            f'<stop offset="0.5" stop-color="{base}"/><stop offset="1" stop-color="{shade}"/></radialGradient>'
            f'<clipPath id="{uid}c"><path d="{d}"/></clipPath>')
    tip_y = -R * (0.92 if kind != "maple" else 0.95)
    stem_y = R * (0.46 if kind != "maple" else 0.25)
    out = [f'<path d="{d}" fill="url(#{uid}g)"/>']
    # The far side of the midrib, away from the light.
    out.append(f'<g clip-path="url(#{uid}c)"><rect x="0" y="{-R:.1f}" width="{R:.1f}" height="{2 * R:.1f}" fill="{shade}" opacity="0.18"/>')
    # Speckles of autumn.
    for _ in range(7):
        x, y = rnd.uniform(-R * 0.6, R * 0.6), rnd.uniform(-R * 0.6, R * 0.5)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rnd.uniform(0.6, 1.6) * size / 56:.1f}" fill="{shade}" opacity="{rnd.uniform(0.2, 0.4):.2f}"/>')
    # Veins: the midrib, and side veins to the lobes or along the blade.
    w = max(0.6, size / 56 * 1.4)
    if kind == "maple":
        veins = [f"M0,{stem_y:.1f} L0,{tip_y:.1f}"]
        for a, L in ((-140, 0.8), (-40, 0.8), (-194, 0.52), (14, 0.52)):
            r = math.radians(a)
            veins.append(f"M0,{stem_y * 0.6:.1f} Q{math.cos(r) * R * L * 0.4:.1f},{math.sin(r) * R * L * 0.5:.1f} {math.cos(r) * R * L * 0.9:.1f},{math.sin(r) * R * L * 0.9 + R * 0.08:.1f}")
    else:
        veins = [f"M0,{stem_y:.1f} L0,{tip_y * 0.95:.1f}"]
        for i in range(1, 6):
            y = stem_y - (stem_y - tip_y) * i / 6.5
            reach = R * 0.5 * math.sin(math.pi * (i / 6.5)) ** 0.7
            veins.append(f"M0,{y:.1f} Q{reach * 0.5:.1f},{y - size * 0.04:.1f} {reach:.1f},{y - size * 0.11:.1f}")
            veins.append(f"M0,{y:.1f} Q{-reach * 0.5:.1f},{y - size * 0.04:.1f} {-reach:.1f},{y - size * 0.11:.1f}")
    out.append(f'<path d="{" ".join(veins)}" stroke="{vein}" stroke-width="{w:.2f}" fill="none" stroke-linecap="round" opacity="0.75"/>')
    out.append(f'<path d="{" ".join(veins)}" stroke="{shade}" stroke-width="{w * 0.6:.2f}" fill="none" stroke-linecap="round" opacity="0.25" transform="translate({w * 0.6:.2f},{w * 0.6:.2f})"/>')
    if sheen:
        out.append(f'<ellipse cx="{-R * 0.28:.1f}" cy="{-R * 0.3:.1f}" rx="{R * 0.32:.1f}" ry="{R * 0.14:.1f}" fill="#FFFFFF" opacity="0.28" transform="rotate(-35 {-R * 0.28:.1f} {-R * 0.3:.1f})"/>')
    out.append("</g>")
    # The stem.
    out.append(f'<path d="M0,{stem_y - 1:.1f} q{size * 0.02:.1f},{size * 0.12:.1f} {size * 0.07:.1f},{size * 0.2:.1f}" stroke="{shade}" stroke-width="{w * 1.4:.2f}" fill="none" stroke-linecap="round"/>')
    body = f'<g transform="translate({cx:.1f} {cy:.1f}) rotate({turn:.1f})">' + "".join(out) + "</g>"
    return defs, body


# The leaves that fly: a size and a pivot (the leaf's middle) for every one.
FLYING = [("maple", "red"), ("maple", "orange"), ("maple", "gold"), ("oak", "brown"), ("oak", "orange"), ("elm", "gold"), ("elm", "green")]


def flying_leaves(art, kinds=FLYING, size=60):
    """Draw each flying leaf as a part, `leaf-<kind>-<colour>`, 64 x 64 with its pivot in the middle; the names."""
    names = []
    for i, (kind, colour) in enumerate(kinds):
        name = f"leaf-{kind}-{colour}"
        defs, body = leaf(kind, colour, f"l{i}", 32, 32, size, seed=i)
        art.part(name, 64, 64, (32, 32), body, defs)
        names.append(name)
    return names

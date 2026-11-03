"""Marigolds, drawn once for every festival that has them (RFC-020 §3.3):
Diwali's garlands and Día de Muertos's petals and papel picado. Not a
festival's script itself: the scripts import it.

    from _marigold import marigold, petal, MARIGOLD
    defs, body = marigold("m1", cx=20, cy=20, r=12, seed=1)

A marigold is rings of ruffled petals, the outer ones deep orange and the
inner ones golden, each ring over the last, lit from the top left (§5.1).
"""
import math, random

# Deep orange, orange, gold, light gold: the outer ring to the heart.
MARIGOLD = ("#D9590F", "#F2801E", "#FFA62B", "#FFC94A", "#FFE27A")
YELLOW = ("#E0960F", "#F5B321", "#FFCB33", "#FFDD5C", "#FFF0A0")


def marigold(uid, cx, cy, r, seed=0, colours=MARIGOLD):
    """A marigold head at (cx, cy), radius r: (defs, body)."""
    rnd = random.Random(f"marigold{seed}{r}")
    defs = (f'<radialGradient id="{uid}s" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/>'
            f'<stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#7A2A00" stop-opacity="0.35"/></radialGradient>')
    out = [f'<circle cx="{cx}" cy="{cy}" r="{r * 0.98:.2f}" fill="{colours[0]}"/>']
    # A small one (a garland's) has fewer petals and no creases: the same look at its size, a tenth of the file.
    small = r < 8
    rings = [(1.0, 11), (0.7, 8), (0.4, 5)] if small else [(1.0, 16), (0.78, 13), (0.56, 10), (0.36, 7)]
    for k, (f, n) in enumerate(rings):
        off = rnd.uniform(0, math.pi)
        for i in range(n):
            a = off + 2 * math.pi * i / n + rnd.uniform(-0.08, 0.08)
            pr = r * f * 0.74
            x, y = cx + math.cos(a) * pr, cy + math.sin(a) * pr
            rx, ry = r * (0.3 - k * 0.03), r * (0.22 - k * 0.02)
            col = colours[min(len(colours) - 1, k + (i % 3 == 0))]
            deg = math.degrees(a)
            out.append(f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" fill="{col}" transform="rotate({deg:.0f} {x:.2f} {y:.2f})"/>')
            # The ruffle: a crease along the petal.
            if not small:
                out.append(f'<path d="M{x - math.sin(a) * rx * 0.6:.2f},{y + math.cos(a) * rx * 0.6:.2f} L{x + math.sin(a) * rx * 0.6:.2f},{y - math.cos(a) * rx * 0.6:.2f}" '
                           f'stroke="{colours[0]}" stroke-width="{r * 0.03:.2f}" opacity="0.35" stroke-linecap="round"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r * 0.18:.2f}" fill="{colours[-1]}"/>')
    for _ in range(0 if small else 5):
        a, d = rnd.uniform(0, 2 * math.pi), rnd.uniform(0, r * 0.12)
        out.append(f'<circle cx="{cx + math.cos(a) * d:.2f}" cy="{cy + math.sin(a) * d:.2f}" r="{r * 0.05:.2f}" fill="{colours[1]}"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r:.2f}" fill="url(#{uid}s)"/>')
    return defs, "".join(out)


def petal(uid, colour_light, colour, colour_dark):
    """One ruffled marigold petal in a 32 x 28 box, its pivot (16, 14): a fan, scalloped at its wide end."""
    defs = (f'<radialGradient id="{uid}" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="{colour_light}"/>'
            f'<stop offset="0.55" stop-color="{colour}"/><stop offset="1" stop-color="{colour_dark}"/></radialGradient>')
    body = (f'<path d="M16,26 C10,22 4,16 4,10 C4,6 6,4 8,5 C9,2 12,2 13,4 C14,1.5 18,1.5 19,4 C20,2 23,2 24,5 C26,4 28,6 28,10 C28,16 22,22 16,26 Z" fill="url(#{uid})"/>'
            f'<path d="M16,25 L16,8 M16,22 L10,9 M16,22 L22,9" stroke="{colour_dark}" stroke-width="0.9" fill="none" opacity="0.35" stroke-linecap="round"/>'
            f'<ellipse cx="11" cy="9" rx="3.5" ry="1.8" fill="#FFFFFF" opacity="0.4" transform="rotate(-30 11 9)"/>')
    return defs, body

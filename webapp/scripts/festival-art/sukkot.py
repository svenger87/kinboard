"""Sukkot's art (RFC-020 §3.3): autumn leaves drifting down, and fruit and
leaves hanging from the cards on a string, as they hang in a sukkah.

    python3 webapp/scripts/festival-art/sukkot.py

The flying leaves are _leaves.py's, drawn here once as parts: Thanksgiving's
leaves blowing across are these same files (its kit borrows this folder,
`art: "sukkot"`). Fruit, leaves and the harvest only: festive, never
devotional (§7), so no ritual objects.
"""
import math, sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art, lin, rad
from _leaves import leaf, flying_leaves

art = Art("sukkot")


def grapes(uid, x, y):
    """A bunch of grapes hanging from (x, y): a vine leaf at the top, a dozen grapes lit from the top left."""
    defs = (rad(f"{uid}g", [(0, "#C9A2FF", None), (0.45, "#7B4FC4", None), (1, "#3E2470", None)], fx=0.32, fy=0.28) +
            rad(f"{uid}h", [(0, "#B98CF0", None), (0.5, "#6A3FB0", None), (1, "#33195E", None)], fx=0.32, fy=0.28))
    out = [f'<path d="M{x},{y} q1,4 0,7" stroke="#6B4A2A" stroke-width="1.6" fill="none" stroke-linecap="round"/>']
    rows = [4, 3, 3, 2, 1]
    r = 4.2
    cy = y + 10
    spots = []
    for i, n in enumerate(rows):
        for j in range(n):
            gx = x + (j - (n - 1) / 2) * r * 1.75 + (0.8 if i % 2 else -0.4)
            spots.append((gx, cy + i * r * 1.45))
    # Back row first, so the front ones overlap it.
    for k, (gx, gy) in enumerate(sorted(spots, key=lambda p: p[1])):
        out.append(f'<circle cx="{gx:.1f}" cy="{gy:.1f}" r="{r}" fill="url(#{uid}{"g" if k % 3 else "h"})"/>'
                   f'<circle cx="{gx - 1.4:.1f}" cy="{gy - 1.5:.1f}" r="1.1" fill="#FFFFFF" opacity="0.6"/>')
    ld, lb = leaf("maple", "green", f"{uid}l", x + 7, y + 7, 15, turn=60, seed=3, sheen=False)
    return defs + ld, "".join(out) + lb


def pomegranate(uid, x, y):
    """A pomegranate hanging from its stem at (x, y), its crown at the bottom."""
    defs = rad(f"{uid}p", [(0, "#FF9A8A", None), (0.4, "#D9333F", None), (1, "#7A1424", None)], fx=0.32, fy=0.3)
    cx, cy, r = x, y + 17, 12
    crown = (f'<path d="M{cx - 4.5},{cy + r - 2} L{cx - 5.5},{cy + r + 4} L{cx - 2},{cy + r + 1.5} L{cx},{cy + r + 5} '
             f'L{cx + 2},{cy + r + 1.5} L{cx + 5.5},{cy + r + 4} L{cx + 4.5},{cy + r - 2} Z" fill="#9E2230"/>')
    return defs, (f'<path d="M{x},{y} L{x},{y + 6}" stroke="#6B4A2A" stroke-width="1.6" stroke-linecap="round"/>'
                  f'{crown}<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{uid}p)"/>'
                  f'<path d="M{cx + 3},{cy - r + 3} C{cx + 9},{cy - 4} {cx + 9},{cy + 4} {cx + 4},{cy + r - 3}" stroke="#7A1424" stroke-width="1.2" fill="none" opacity="0.35"/>'
                  f'<ellipse cx="{cx - 4.5}" cy="{cy - 5}" rx="4" ry="2.4" fill="#FFFFFF" opacity="0.45" transform="rotate(-35 {cx - 4.5} {cy - 5})"/>')


def apple(uid, x, y):
    """A red and gold apple hanging from (x, y), a leaf on its stem."""
    defs = rad(f"{uid}a", [(0, "#FFE27A", None), (0.35, "#F2913A", None), (0.7, "#D9433A", None), (1, "#8E1F26", None)], fx=0.3, fy=0.28)
    cx, cy = x, y + 16
    body = (f'<path d="M{cx},{cy - 7} C{cx - 4},{cy - 11} {cx - 13},{cy - 10} {cx - 13},{cy} C{cx - 13},{cy + 9} {cx - 6},{cy + 13} {cx - 2},{cy + 11} '
            f'C{cx},{cy + 12} {cx},{cy + 12} {cx + 2},{cy + 11} C{cx + 6},{cy + 13} {cx + 13},{cy + 9} {cx + 13},{cy} C{cx + 13},{cy - 10} {cx + 4},{cy - 11} {cx},{cy - 7} Z" fill="url(#{uid}a)"/>')
    ld, lb = leaf("elm", "green", f"{uid}l", x + 6, y + 5, 11, turn=70, seed=5, sheen=False)
    return defs + ld, (f'<path d="M{x},{y} q-1,5 0,10" stroke="#6B4A2A" stroke-width="1.6" fill="none" stroke-linecap="round"/>{body}{lb}'
                       f'<ellipse cx="{cx - 6}" cy="{cy - 3}" rx="3.2" ry="2" fill="#FFFFFF" opacity="0.5" transform="rotate(-40 {cx - 6} {cy - 3})"/>')


def hanging():
    """A 220 x 60 string, 110 x 30 on the card: a sagging twine with grapes, a pomegranate, an apple and leaves hanging from it."""
    W, H = 220, 60

    def sag(x):
        # Where the string is at x: a quadratic from (4,4) through (110,22) to (216,4).
        t = (x - 4) / 212
        return (1 - t) ** 2 * 4 + 2 * (1 - t) * t * 22 + t * t * 4

    defs = lin("twine", [(0, "#C9A46E", None), (1, "#8A6236", None)], 0, 0, 0, 1)
    body = ['<path d="M4,4 Q110,22 216,4" stroke="url(#twine)" stroke-width="2.2" fill="none" stroke-linecap="round"/>']
    items = []
    for fn, x in ((grapes, 50), (pomegranate, 104), (apple, 158)):
        d, b = fn(f"f{x}", x, round(sag(x), 1))
        defs += d
        items.append(b)
    # Leaves tied along the string, and one hanging at either end.
    for i, (kind, colour, x, dy, turn, size) in enumerate((("maple", "red", 18, 9, 200, 22), ("oak", "orange", 78, 8, 170, 18),
                                                          ("maple", "gold", 132, 9, 190, 18), ("elm", "orange", 190, 9, 160, 19))):
        d, b = leaf(kind, colour, f"s{i}", x, sag(x) + dy, size, turn=turn, seed=10 + i, sheen=False)
        defs += d
        body.append(b)
    body += items
    art.still("fruit-hanging", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 2}" height="{H // 2}">\n'
                                f"<defs>{defs}</defs>\n" + "\n".join(body) + "\n</svg>\n"))


LEAVES = flying_leaves(art)
hanging()
art.finish()

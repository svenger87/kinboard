"""Lanterns and sparkles shared by Ramadan and both Eids (RFC-020 §3.3).

A fanous: a pierced metal lantern with coloured glass panes, a domed cap
and a ring to hang it by, lit from inside. Drawn in its own coordinates
(width 60, height 100, the ring's top at (30, 0)), so a caller scales and
places it: a rising visitor part, a lantern hanging from a card.

Every gradient id is prefixed by the caller's `key`, so several lanterns
can sit in one SVG.
"""
import math
from _common import lin, rad, blur

# Glass and metal, by name: (glass light, glass deep, metal light, metal shade).
GLASS = {
    "amber": ("#FFF1B8", "#F2A23A"),
    "rose": ("#FFD3DC", "#E0557A"),
    "emerald": ("#C9F5DC", "#2FA36B"),
    "turquoise": ("#CFF4F4", "#2BA3B5"),
    "violet": ("#E6D7FF", "#8A63D2"),
}
GOLD = ("#FFE9A3", "#E3B04B", "#A8741F")


def lantern_defs(key, glass, glow=True):
    light, deep = GLASS[glass]
    d = (rad(f"{key}g", [(0, "#FFFFFF", None), (0.35, light, None), (1, deep, None)], cx=0.42, cy=0.45, r=0.65, fx=0.4, fy=0.42)
         + lin(f"{key}m", [(0, GOLD[0], None), (0.45, GOLD[1], None), (1, GOLD[2], None)], 0, 0, 1, 0.4)
         + lin(f"{key}c", [(0, GOLD[0], None), (1, GOLD[2], None)], 0, 0, 0.6, 1))
    if glow:
        d += rad(f"{key}h", [(0, light, 0.85), (0.45, deep, 0.35), (1, deep, 0)]) + blur(f"{key}b", 5)
    return d


def lantern(key, glow=True):
    """The fanous body, 60 x 100, ring top at (30, 0). Needs lantern_defs(key, ...)."""
    out = []
    if glow:
        out.append(f'<ellipse cx="30" cy="58" rx="34" ry="38" fill="url(#{key}h)" filter="url(#{key}b)"/>')
    # The ring and the finial.
    out.append(f'<circle cx="30" cy="6" r="4.6" fill="none" stroke="url(#{key}c)" stroke-width="2.4"/>')
    out.append(f'<path d="M27,10 L33,10 L32,18 L28,18 Z" fill="url(#{key}m)"/>')
    # The dome cap, layered.
    out.append(f'<path d="M30,16 C40,17 47,24 48,32 L12,32 C13,24 20,17 30,16 Z" fill="url(#{key}c)"/>')
    out.append('<path d="M18,28 C21,22 26,19 30,19" stroke="#FFF6D6" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7"/>')
    out.append(f'<rect x="8" y="31" width="44" height="5" rx="2.5" fill="url(#{key}m)"/>')
    # The glass, in three panes seen front on: a tall middle pane and two narrower side panes.
    out.append(f'<path d="M12,36 L48,36 L44,74 L16,74 Z" fill="url(#{key}g)"/>')
    # The pierced metal frame over the glass: ribs and a pointed-arch window in each pane.
    out.append(f'<path d="M22,36 L24,74 M38,36 L36,74" stroke="url(#{key}m)" stroke-width="2.6"/>')
    for x0, x1 in ((13.5, 22.5), (24, 36), (37.5, 46.5)):
        cx = (x0 + x1) / 2
        hw = (x1 - x0) / 2 - 1.6
        out.append(f'<path d="M{cx - hw:.1f},66 L{cx - hw:.1f},50 Q{cx - hw:.1f},43 {cx:.1f},40 Q{cx + hw:.1f},43 {cx + hw:.1f},50 L{cx + hw:.1f},66" '
                   f'fill="none" stroke="url(#{key}m)" stroke-width="1.3" opacity="0.85"/>')
    # Little pierced dots along the band.
    out.append("".join(f'<circle cx="{x}" cy="33.5" r="0.9" fill="#7A5214" opacity="0.6"/>' for x in range(13, 49, 4)))
    # The flame, a warm core.
    out.append('<ellipse cx="30" cy="58" rx="4" ry="7" fill="#FFF6D0" opacity="0.95"/><ellipse cx="30" cy="60" rx="2" ry="3.6" fill="#FFFFFF"/>')
    # The base, a stepped foot and a drop finial.
    out.append(f'<rect x="14" y="73" width="32" height="5" rx="2.5" fill="url(#{key}m)"/>')
    out.append(f'<path d="M18,78 L42,78 C40,85 35,88 30,88 C25,88 20,85 18,78 Z" fill="url(#{key}c)"/>')
    out.append(f'<path d="M28,88 L32,88 L30,97 Z" fill="url(#{key}m)"/><circle cx="30" cy="97" r="2.2" fill="url(#{key}c)"/>')
    # Light from the top left: a sheen on the glass and the dome.
    out.append('<path d="M16,40 L19,40 L20,68 L18,68 Z" fill="#FFFFFF" opacity="0.45"/>')
    out.append('<ellipse cx="22" cy="25" rx="4" ry="2" fill="#FFFFFF" opacity="0.5" transform="rotate(-30 22 25)"/>')
    return "\n".join(out)


def sparkle_defs(key, colour="#FFE27A", deep="#E0A419"):
    return (rad(f"{key}s", [(0, "#FFFFFF", 1), (0.25, colour, 0.85), (0.6, colour, 0.25), (1, colour, 0)])
            + rad(f"{key}p", [(0, "#FFFFFF", None), (0.3, colour, None), (1, deep, None)], cx=0.45, cy=0.45, r=0.6))


def sparkle(key, cx, cy, s, colour="#FFE27A"):
    """A four-pointed sparkle in a soft glow, `s` to its points."""
    a, b = s * 0.16, s * 0.16
    return (f'<circle cx="{cx}" cy="{cy}" r="{s * 0.95:.2f}" fill="url(#{key}s)"/>'
            f'<path d="M{cx},{cy - s} Q{cx + a:.2f},{cy - b:.2f} {cx + s},{cy} Q{cx + a:.2f},{cy + b:.2f} {cx},{cy + s} '
            f'Q{cx - a:.2f},{cy + b:.2f} {cx - s},{cy} Q{cx - a:.2f},{cy - b:.2f} {cx},{cy - s} Z" fill="url(#{key}p)"/>'
            f'<path d="M{cx},{cy - s * 0.55} L{cx + s * 0.08:.2f},{cy} L{cx},{cy + s * 0.55} L{cx - s * 0.08:.2f},{cy} Z" fill="#FFFFFF" opacity="0.8" '
            f'transform="rotate(45 {cx} {cy})"/>')


def bulb(cx, cy, r, colour, key):
    """A warm string-light bulb hanging from (cx, cy - r*1.3): a socket and a glowing round glass."""
    return (f'<circle cx="{cx}" cy="{cy}" r="{r * 2.2:.2f}" fill="url(#{key})" opacity="0.7"/>'
            f'<rect x="{cx - r * 0.45:.2f}" y="{cy - r * 1.55:.2f}" width="{r * 0.9:.2f}" height="{r * 0.7:.2f}" rx="{r * 0.2:.2f}" fill="#2F5D4A"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 0.85:.2f}" ry="{r:.2f}" fill="{colour}"/>'
            f'<ellipse cx="{cx - r * 0.3:.2f}" cy="{cy - r * 0.35:.2f}" rx="{r * 0.28:.2f}" ry="{r * 0.4:.2f}" fill="#FFFFFF" opacity="0.75"/>')


def wire(x0, x1, y, sag, n):
    """A drooping wire between n + 1 posts: the path, and where each span's lowest point is."""
    step = (x1 - x0) / n
    d = f"M{x0},{y}"
    lows = []
    for i in range(n):
        a = x0 + i * step
        d += f" Q{a + step / 2:.1f},{y + sag * 2:.1f} {a + step:.1f},{y}"
        lows.append((a + step / 2, y + sag))
    return d, lows


def side_lantern(glass, chain, chain_colour="#C9973A"):
    """
    A 15 x (chain + 25) still: one lantern on a chain, hung beside a card in
    the gap at its side (at 320px the gap above and below a card is only
    16px, too short to hang a lantern in). The chain starts at the top.
    """
    k = 0.25
    h = chain + 25
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 {h}" width="15" height="{h}">\n'
            f'<defs>{lantern_defs("s", glass)}</defs>\n'
            f'<path d="M7.5,0 L7.5,{chain + 1}" stroke="{chain_colour}" stroke-width="0.9" stroke-dasharray="1.2 0.6"/>\n'
            f'<g transform="translate({7.5 - 30 * k} {chain}) scale({k})">{lantern("s")}</g>\n</svg>\n')

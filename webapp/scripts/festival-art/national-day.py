"""National day's art (RFC-020 §3.3): bunting in the flag's colours along
the cards' top edges, one tile per set of flag colours.

    python3 webapp/scripts/festival-art/national-day.py

The fireworks over the clock need no art: their sparks are glows the engine
draws in the kit's colours. Flags that share their colours share a tile
(France's and the United States' red, white and blue; Austria's and
Poland's red and white), so the kit's stages are these colour sets, not the
countries: kits/national-day.ts maps each country to one. Colour only, no
emblems or coats of arms.

Each tile is 360 x 44 units (180 x 22 px): twelve pennants on a cord, so a
set of two, three, four or six colours repeats seamlessly.
"""
import sys, os
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import Art

art = Art("national-day")

# Each colour: light (the top left of a pennant) and its own.
RED, WHITE, BLUE, NAVY = ("#FF7A7A", "#D9333F"), ("#FFFFFF", "#E2DCD2"), ("#7FB2FF", "#2A5DB0"), ("#6F8FE8", "#22409A")
GREEN, GOLD, YELLOW, BLACK = ("#7FD69A", "#2E9A52"), ("#FFE58A", "#F2B21E"), ("#FFF0A0", "#FFCE3A"), ("#6A6A78", "#2A2A32")
SKY, SWEDISH = ("#BFE2FF", "#6FB4E8"), ("#7FB8FF", "#2A6FC4")

PALETTES = {
    "red-white": [RED, WHITE],
    "red-white-blue": [RED, WHITE, BLUE],
    "blue-yellow-red": [NAVY, YELLOW, RED],
    "green-white-red": [GREEN, WHITE, RED],
    "black-red-gold": [BLACK, RED, GOLD],
    "red-gold": [RED, GOLD],
    "blue-yellow": [SWEDISH, YELLOW],
    "green-yellow-blue": [GREEN, YELLOW, NAVY],
    "yellow-green-red": [YELLOW, GREEN, RED],
    "red-green": [RED, GREEN],
    "blue-black-white": [SWEDISH, BLACK, WHITE],
    "red-black": [RED, BLACK],
    "blue-red": [NAVY, RED],
    "white-blue": [WHITE, SKY],
    "yellow-white": [YELLOW, WHITE],
    "green-gold-red-blue": [GREEN, GOLD, RED, NAVY, BLACK, WHITE],
}


def bunting(name, colours):
    W, H, n = 360, 44, 12
    pw = W / n
    defs, body = [], []

    def cord(x):
        return 5 + 1.5 * (1 - ((x % (W / 2)) / (W / 4) - 1) ** 2)

    body.append('<path d="M0,5 Q90,8 180,5 Q270,8 360,5" stroke="#8A6236" stroke-width="1.8" fill="none"/>')
    for i, (light, base) in enumerate(colours):
        defs.append(f'<linearGradient id="p{i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{light}"/><stop offset="0.55" stop-color="{base}"/>'
                    f'<stop offset="1" stop-color="{base}"/></linearGradient>')
    for k in range(n):
        c = k % len(colours)
        x0, x1 = k * pw + 2, (k + 1) * pw - 2
        mid = (x0 + x1) / 2
        y0 = cord(mid)
        tip = y0 + 32 + (2 if k % 2 else 0)
        # A pennant with a rounded tip, its top folded over the cord; a crease of shade down its right half.
        body.append(f'<path d="M{x0:.1f},{y0:.1f} L{x1:.1f},{y0:.1f} L{mid + 2:.1f},{tip - 2:.1f} Q{mid:.1f},{tip + 1:.1f} {mid - 2:.1f},{tip - 2:.1f} Z" fill="url(#p{c})"/>')
        body.append(f'<path d="M{mid:.1f},{y0 + 2:.1f} L{x1 - 1:.1f},{y0 + 1:.1f} L{mid + 1.5:.1f},{tip - 3:.1f} Z" fill="#000000" opacity="0.1"/>')
        body.append(f'<rect x="{x0:.1f}" y="{y0 - 2:.1f}" width="{x1 - x0:.1f}" height="4" rx="1.2" fill="{colours[c][1]}"/>')
        body.append(f'<rect x="{x0:.1f}" y="{y0 + 2:.1f}" width="{x1 - x0:.1f}" height="1.4" fill="#000000" opacity="0.15"/>')
        body.append(f'<path d="M{x0 + 4:.1f},{y0 + 5:.1f} L{mid - 1:.1f},{tip - 8:.1f}" stroke="#FFFFFF" stroke-width="1.6" opacity="0.35" stroke-linecap="round"/>')
    art.still(f"bunting-{name}", (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 2}" height="{H // 2}">\n'
                                  f'<defs>{"".join(defs)}</defs>\n' + "\n".join(body) + "\n</svg>\n"))


for name, colours in PALETTES.items():
    bunting(name, colours)
art.finish()

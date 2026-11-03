"""What every festival's art script shares (RFC-020 §5.1), ported from the
groundwork's docs/rfc/020/art.py.

A visitor is drawn as detailed SVG, part by part, each part in its own
coordinates with a pivot (the point it turns about), so the canvas can rig
it: a reindeer's legs rotate at the hip, a lantern swings from its stick.
The app rasterises each part once and only moves it per frame.

    from _common import Art, lin, rad, blur, fur
    art = Art("halloween")
    art.part("bat", 80, 50, (40, 25), body, defs)    # public/festivals/halloween/bat.svg
    art.still("cobweb", svg)                          # a dressing drawing, used by CSS
    art.finish(rig={...})                             # src/lib/festivals/kits/halloween.art.json

Style (§5.1): the creatures' palette and roundness (RFC-016), Storybook's
gradients, soft shadows and highlights for depth, light from the top left,
no outlines (so the art reads the same on dark and light themes), glows drawn
into the art (canvas blur is slow on a Pi). Festive, never devotional.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
WEBAPP = os.path.normpath(os.path.join(HERE, "..", ".."))


class Art:
    """One festival's art: its parts (for the visitor) and stills (for the dressing)."""

    def __init__(self, festival):
        self.festival = festival
        self.out = os.path.join(WEBAPP, "public", "festivals", festival)
        os.makedirs(self.out, exist_ok=True)
        self.parts = {}

    def part(self, name, w, h, pivot, body, defs="", note=""):
        """A part of a visitor: a w x h drawing whose pivot (rotation centre, in its own units) is `pivot`."""
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
               f'data-pivot="{pivot[0]} {pivot[1]}">\n<defs>{defs}</defs>\n{body}\n</svg>\n')
        self._write(name, svg)
        self.parts[name] = {"w": w, "h": h, "pivot": list(pivot)}
        return svg

    def still(self, name, svg):
        """A still drawing, whole: the dressing's, which CSS places (url("/festivals/<id>/<name>.svg"))."""
        assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"'), name
        self._write(name, svg if svg.endswith("\n") else svg + "\n")

    def finish(self, rig=None):
        """`<id>.art.json` next to the kit: every part's size and pivot, and the rig, if the visitor has one."""
        if not self.parts and rig is None:
            return
        data = {"parts": self.parts}
        if rig is not None:
            data["rig"] = rig
        path = os.path.join(WEBAPP, "src", "lib", "festivals", "kits", f"{self.festival}.art.json")
        with open(path, "w") as f:
            json.dump(data, f, indent=1)
            f.write("\n")

    def _write(self, name, svg):
        with open(os.path.join(self.out, f"{name}.svg"), "w") as f:
            f.write(svg)


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

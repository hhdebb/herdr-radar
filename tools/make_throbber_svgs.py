#!/usr/bin/env python3
"""Generate the working spinner in tools/svg/: a twelve-spoke throbber.

One glyph per frame, the whole set rotated one spoke further in each. A
throbber is the one rotating shape a terminal can animate well: its spokes ARE
the frames, so a step per redraw reads as motion rather than as the stagger a
turning continuous shape shows at the handful of frames a second a sidebar
token can be rewritten.

Every spoke reaches the same radius; only the width tapers along the tail. The
head-to-tail gradient a real throbber draws in opacity cannot be drawn here at
all -- a glyph is one colour -- and length would have been the obvious
substitute, except that a frame whose ink reaches less far has a smaller
bounding box, and build_font.py scales each glyph to ITS box. The throbber
would have swelled and shrunk as it turned. With a constant outer radius the
box is the same circle in every frame.

Curves are polygons for the same reason as the state marks: at terminal sizes
the facets are invisible, and it keeps the output inside the `svg`/`path`
subset build_font.py accepts.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG_DIR = ROOT / "tools" / "svg"

BOX = 600
CENTER = BOX / 2
SPOKES = 12
# The spokes live between these radii; both are constant across frames.
OUTER = 280.0
INNER = 128.0
# The tail: full width at the head, a thread at the far end.
HEAD_WIDTH = 52.0
TAIL_WIDTH = 13.0


def spoke(angle_degrees: float, age: int) -> str:
    """One spoke, `age` steps behind the head (0 = the head itself)."""
    share = age / (SPOKES - 1)
    width = HEAD_WIDTH + (TAIL_WIDTH - HEAD_WIDTH) * share
    radians = math.radians(angle_degrees)
    dx, dy = math.cos(radians), math.sin(radians)
    # Half-width offset, perpendicular to the spoke.
    ox, oy = -dy * width / 2, dx * width / 2
    corner = lambda radius, side: (
        CENTER + dx * radius + ox * side,
        CENTER + dy * radius + oy * side,
    )
    points = [corner(INNER, 1), corner(OUTER, 1), corner(OUTER, -1), corner(INNER, -1)]
    head = "M{:.1f},{:.1f}".format(*points[0])
    body = "".join("L{:.1f},{:.1f}".format(*point) for point in points[1:])
    return f"{head}{body}Z"


def frame(index: int) -> str:
    paths = []
    for age in range(SPOKES):
        # The head sits on spoke `index`; ages count backwards from it.
        angle = -90 + ((index - age) % SPOKES) * (360 / SPOKES)
        paths.append(spoke(angle, age))
    return "".join(f'<path d="{d}"/>' for d in paths)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", dest="out_dir")
    args = parser.parse_args()
    out = Path(args.out_dir) if args.out_dir else SVG_DIR
    out.mkdir(parents=True, exist_ok=True)
    for index in range(SPOKES):
        (out / f"throb_{index}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}">{frame(index)}</svg>\n',
            encoding="utf-8",
        )
    print(f"wrote {SPOKES} throbber frames in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

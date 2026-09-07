#!/usr/bin/env python3
"""Generate the lifecycle-state marks in tools/svg/.

The four state marks are ours, not borrowed Unicode: `✓ ○ ◌ ?` are absent from
plenty of monospace fonts, and when the terminal falls back to a CJK face it
picks up that face's full-width geometry -- a circle drawn to match a Han
character, twice the size of the text beside it.

Curves are emitted as polygons rather than SVG arcs: at terminal sizes the
facets are invisible, and it keeps the marks inside the `svg`/`path`-only
subset build_font.py accepts.
"""
from __future__ import annotations

import math
from pathlib import Path

SVG_DIR = Path(__file__).resolve().parent.parent / "tools" / "svg"
BOX = 600
STEP_DEGREES = 3  # polygon facet size


def signed_area(points):
    total = 0.0
    for i, (x, y) in enumerate(points):
        nx, ny = points[(i + 1) % len(points)]
        total += x * ny - nx * y
    return total / 2


def orient(points, solid=True):
    """Force a contour's winding. TrueType fills by the non-zero rule, so a
    round cap wound against its own stroke body punches a hole through it
    instead of joining it."""
    return points if (signed_area(points) > 0) == solid else list(reversed(points))


def arc_points(cx, cy, radius, start, end, reverse=False):
    """Points along an arc. Angles in degrees, SVG axes (y grows downward)."""
    span = abs(end - start)
    count = max(2, int(span / STEP_DEGREES) + 1)
    values = [start + (end - start) * i / (count - 1) for i in range(count)]
    if reverse:
        values.reverse()
    return [
        (cx + radius * math.cos(math.radians(a)), cy + radius * math.sin(math.radians(a)))
        for a in values
    ]


def ring(cx, cy, outer, inner, start=0.0, end=360.0):
    """One annular sector, closed. A full ring needs two contours, not one."""
    if end - start >= 360.0:
        return [
            orient(arc_points(cx, cy, outer, 0, 359.999), solid=True),
            orient(arc_points(cx, cy, inner, 0, 359.999), solid=False),
        ]
    return [orient(arc_points(cx, cy, outer, start, end)
                   + arc_points(cx, cy, inner, start, end, reverse=True), solid=True)]


def stroke(points, width, cap_round=True):
    """Outline a polyline of the given width, mitred at the joins."""
    half = width / 2
    left, right = [], []
    for index, (x, y) in enumerate(points):
        before = points[index - 1] if index > 0 else None
        after = points[index + 1] if index < len(points) - 1 else None
        normals = []
        for a, b in ((before, (x, y)), ((x, y), after)):
            if a is None or b is None:
                continue
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy) or 1.0
            normals.append((-dy / length, dx / length))
        nx = sum(n[0] for n in normals) / len(normals)
        ny = sum(n[1] for n in normals) / len(normals)
        scale = math.hypot(nx, ny) or 1.0
        # Mitre: lengthen the averaged normal so the join keeps its width.
        nx, ny = nx / scale**2, ny / scale**2
        left.append((x + nx * half, y + ny * half))
        right.append((x - nx * half, y - ny * half))
    if cap_round:
        start_cap = arc_points(*points[0], half, 0, 359.999)
        end_cap = arc_points(*points[-1], half, 0, 359.999)
        return [orient(left + list(reversed(right))), orient(start_cap), orient(end_cap)]
    return [orient(left + list(reversed(right)))]


def to_path(contours):
    parts = []
    for contour in contours:
        head = f"M{contour[0][0]:.1f},{contour[0][1]:.1f}"
        body = "".join(f"L{x:.1f},{y:.1f}" for x, y in contour[1:])
        parts.append(head + body + "Z")
    return "".join(parts)


def write(name, contours):
    path = SVG_DIR / f"{name}.svg"
    body = to_path(contours)
    path.write_text(f'<svg viewBox="0 0 {BOX} {BOX}">\n  <path d="{body}" />\n</svg>\n')
    print(f"wrote {path.name} ({len(body)} bytes of path data)")


C = BOX / 2

# idle: a plain ring. Parked, nothing wrong.
write("state_idle", ring(C, C, 230, 158))

# unknown: the same ring, broken into eight dashes -- reads as "could not tell"
# at a glance without needing colour to separate it from idle.
dashes = []
for i in range(8):
    start = i * 45 + 8
    dashes.extend(ring(C, C, 230, 158, start, start + 29))
write("state_unknown", dashes)

# done: a tick, drawn thick enough to stay legible at 17px.
write("state_done", stroke([(122, 306), (248, 432), (486, 168)], 86))

# idle_fresh: a filled disc. Idle split three ways by recency (lib/activity.js),
# and weight is the axis: this one carries the most ink, so the sessions you
# were just in are the ones the eye lands on first.
write("state_idle_fresh", [orient(arc_points(C, C, 230, 0, 359.999), solid=True)])

# idle_stale: a small dot. Same family, least ink — a session nobody has
# touched in hours should recede rather than compete. Shape carries this
# distinction rather than colour alone, because a colour's meaning flips with
# the background: light-on-dark reads as prominent, the same value on a light
# terminal reads as faded.
write("state_idle_stale", [orient(arc_points(C, C, 92, 0, 359.999), solid=True)])

# blocked: a question mark -- it is asking you something, not merely stuck.
# Angles grow clockwise here because SVG's y axis points down, so the top of
# the hook is 270 degrees and the arc has to climb past it, not fall short.
hook = arc_points(C, 208, 112, 186, 378)
tail = [hook[-1], (C + 26, 300), (C, 344), (C, 382)]
write(
    "state_blocked",
    stroke(hook, 82, cap_round=True)
    + stroke(tail, 82, cap_round=True)
    + [orient(arc_points(C, 470, 52, 0, 359.999))],
)

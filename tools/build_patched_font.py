#!/usr/bin/env python3
"""Patch our icon glyphs into a full JetBrains Mono, for hosts that take one
font file and no fallback config — a mobile terminal (Moshi) being the case in
point: our icon-only face would leave it with no Latin at all.

Zero rescaling: the icon font's metrics were copied from JetBrains Mono in the
first place (UPM 1000, advance 600, ascent 1020), so glyphs transplant as-is.

Usage: build_patched_font.py <JetBrainsMono-Regular.ttf> [output.ttf]
"""
import hashlib
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "dist" / "HerdrAgentIconsMax-Regular.ttf"
FAMILY = "JetBrains Mono Herdr"


def quantise(value: float) -> float:
    """Snap to the 16.16 grid head.fontRevision is stored on."""
    return round(value * 65536) / 65536


def stamp_of(font: TTFont) -> str | None:
    """The icon stamp a previous build recorded in nameID 3, if any."""
    for record in font["name"].names:
        if record.nameID == 3:
            return record.toUnicode().rsplit("; ", 1)[-1]
    return None


def main() -> None:
    base_path = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "dist" / "JetBrainsMonoHerdr-Regular.ttf"

    base = TTFont(base_path)
    icons = TTFont(ICONS)
    assert base["head"].unitsPerEm == icons["head"].unitsPerEm, "UPM mismatch"

    icon_cmap = icons.getBestCmap()
    glyf_src, glyf_dst = icons["glyf"], base["glyf"]
    hmtx_src, hmtx_dst = icons["hmtx"], base["hmtx"]

    for codepoint, name in sorted(icon_cmap.items()):
        new_name = f"herdr.{name}"
        # glyf's __setitem__ appends to the shared glyph order itself; adding
        # the name a second time by hand double-counts it and trips the
        # glyphs-vs-order assertion at save time.
        glyf_dst[new_name] = glyf_src[name]
        hmtx_dst[new_name] = hmtx_src[name]
        for table in base["cmap"].tables:
            if table.isUnicode():
                table.cmap[codepoint] = new_name

    # A distinct identity: the stock JetBrains Mono may also be installed, and
    # two faces with one name means the font cache decides which one you get.
    #
    # nameID 3 (unique identifier) and the version must also change whenever the
    # icon set does. They used to be constants, which is a spec violation and had
    # a concrete cost: iOS refuses to import a font it already has at the same
    # identity and version, so a rebuild that added glyphs was rejected outright
    # ("import failed") with nothing wrong with the file. The stamp is derived
    # from the icon font's bytes rather than a clock, so the build stays
    # reproducible — same inputs, same output.
    stamp = hashlib.sha256(ICONS.read_bytes()).hexdigest()[:8]
    icon_count = len(icon_cmap)
    revision = quantise(base["head"].fontRevision + icon_count / 1000)

    # iOS keys on the VERSION, not just the identifier: a rebuild that changed
    # glyph shapes without changing their count kept fontRevision at 2.328 and
    # was rejected on import, even though nameID 3 carried a fresh hash. So the
    # revision has to move whenever the icons move.
    #
    # It also has to keep moving FORWARD, which a content hash cannot do on its
    # own — hashes have no order. The previous build is the fixed point that
    # gives us both: it ships in dist/ and is tracked in git, so this reads
    # repo state rather than introducing any.
    #
    #   same stamp as last build -> same revision (a rebuild stays idempotent)
    #   new stamp                -> strictly greater than last build
    #
    # The step is one unit of the 16.16 fixed-point grid fontRevision is stored
    # on. Anything finer than 1/65536 does not survive the save.
    previous = TTFont(out) if out.exists() else None
    if previous is not None:
        was = quantise(previous["head"].fontRevision)
        if stamp_of(previous) == stamp:
            revision = was
        elif revision <= was:
            revision = quantise(was + 1 / 65536)

    base["head"].fontRevision = revision
    unique = f"{FAMILY}; {icon_count} icons; {stamp}"

    for record in base["name"].names:
        if record.nameID in (1, 16):
            record.string = FAMILY
        elif record.nameID == 3:
            record.string = unique
        elif record.nameID == 4:
            record.string = FAMILY
        elif record.nameID == 5:
            record.string = f"Version {revision:.5f}; herdr icons {icon_count} ({stamp})"
        elif record.nameID == 6:
            record.string = FAMILY.replace(" ", "") + "-Regular"

    base.save(out)
    check = TTFont(out)
    cmap = check.getBestCmap()
    for probe in (0x41, 0x4E2D, 0xE1A0, 0xE1C2, 0xE1C5):
        state = "ok" if probe in cmap else ("(cjk absent, host fallback covers it)" if probe == 0x4E2D else "MISSING")
        print(f"  U+{probe:04X} {state}")
    print(f"Built: {out} ({out.stat().st_size // 1024} KB, {len(check.getGlyphOrder())} glyphs)")


if __name__ == "__main__":
    main()

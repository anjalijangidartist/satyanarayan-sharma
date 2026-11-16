#!/usr/bin/env python3
"""Generate abstract placeholder artworks with ffmpeg.

Replace the generated files in assets/work with the artist's real images,
then run tools/build-manifest.py to rebuild works.json.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "assets" / "work"
ART.mkdir(parents=True, exist_ok=True)

PALETTES = [
    ["#22303f", "#b8794f", "#ece2cf", "#7d2e2e"],
    ["#1d2b36", "#c9a227", "#e9e1cc", "#8a4b2a"],
    ["#2a2e2c", "#6f7f5a", "#d9d2bd", "#a35638"],
    ["#20262d", "#8d6e63", "#e8dcc8", "#345d5a"],
    ["#2b2433", "#a44a5b", "#efe4d4", "#c9a26b"],
    ["#171a1f", "#3f5e78", "#dfd6c4", "#b24a33"],
    ["#30302a", "#7f8b6f", "#e2d8c3", "#9c5b3c"],
    ["#232a2f", "#5f7d88", "#efe7d6", "#a63b2d"],
    ["#2d1f26", "#8a3a4a", "#e9d9c6", "#c98a4b"],
    ["#1f2420", "#4e6b4f", "#ded5be", "#b06a3b"],
    ["#25242c", "#6a4f7a", "#e6dbc9", "#bf7a4b"],
    ["#1b2229", "#385f6b", "#e5ddca", "#d09a4a"],
    ["#2c241d", "#9a6a3f", "#efe6d2", "#5c3d2e"],
    ["#202a33", "#4f6d8f", "#e3d9c6", "#b15438"],
    ["#2a2620", "#7a6b4f", "#e8dfcb", "#93503f"],
    ["#23262b", "#5d5f72", "#ded3bf", "#a8513a"],
    ["#1e2824", "#4a6b5e", "#e7decb", "#b57d45"],
    ["#2b211f", "#7d3f3a", "#eadfcd", "#c79a5a"],
    ["#1d252c", "#48647a", "#e9e0cd", "#b05a3c"],
    ["#2a2b26", "#71754f", "#e4dbc8", "#9d4b3a"],
    ["#241f2b", "#6b5a86", "#eae0cd", "#b57345"],
    ["#1c2529", "#3f6166", "#e2d9c5", "#ad6b3f"],
    ["#2f2721", "#8c5b3c", "#f0e6d2", "#5b6b5a"],
    ["#20202a", "#4d4f78", "#e6dcc9", "#b15c3f"],
    ["#27231e", "#7f6a45", "#eae1ce", "#8f3c34"],
    ["#1a2428", "#36616b", "#e7decb", "#c08a4e"],
    ["#2c2229", "#8a4a63", "#ece2d0", "#c69a5c"],
    ["#212521", "#526a4a", "#e9e0cd", "#a55e3c"],
    ["#191f26", "#3e5570", "#e4dbc8", "#b2763f"],
    ["#2b2620", "#806a4a", "#eee4d1", "#96402f"],
    ["#202b2a", "#456b63", "#e8dfcc", "#ba7c42"],
    ["#2a1f22", "#7d3c45", "#ebdfcc", "#bd8b52"],
    ["#1e222c", "#474f72", "#e5dbc8", "#ac5a3b"],
    ["#262a24", "#5e7048", "#e7decb", "#9a4d38"],
    ["#1d262b", "#3b6470", "#e6ddca", "#c28a4c"],
    ["#2d2521", "#8f6141", "#f0e7d4", "#5e5c4a"],
]

SIZES = [
    (1200, 1500), (1200, 1600), (1200, 1200), (1500, 1000),
    (1000, 1500), (1400, 1750), (1600, 1100), (1200, 1350),
]
TYPES = ["radial", "linear", "circular", "spiral", "square"]
NUMERALS = [
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
    "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX",
    "XXXI", "XXXII", "XXXIII", "XXXIV", "XXXV", "XXXVI",
]


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    items = []
    for i, palette in enumerate(PALETTES):
        w, h = SIZES[i % len(SIZES)]
        kind = TYPES[i % len(TYPES)]
        seed = 1000 + i * 37
        title = f"Untitled Study {NUMERALS[i]}"
        name = f"study-{i + 1:02d}.jpg"
        out = ART / name

        c = palette
        if kind == "linear":
            geometry = f"x0=0:y0=0:x1={w}:y1={h}"
        elif kind == "radial":
            geometry = f"x0={w // 2}:y0={h // 2}:x1={w}:y1={h // 2}"
        else:
            geometry = f"x0={w // 3}:y0={h // 3}:x1={w}:y1={h}"

        src = (
            f"gradients=s={w}x{h}:c0={c[0]}:c1={c[1]}:c2={c[2]}:c3={c[3]}"
            f":n=4:{geometry}:t={kind}:speed=0:d=1:seed={seed}"
        )
        vf = "noise=alls=7:allf=t+u,vignette=PI/6.5,gblur=sigma=0.4"
        run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", src, "-frames:v", "1",
            "-vf", vf, "-q:v", "4", str(out),
        ])

        items.append({
            "src": f"assets/work/{name}",
            "title": title,
            "width": w,
            "height": h,
            "color": c[2],
        })

    (ART / ".placeholders.json").write_text(json.dumps(items, indent=2) + "\n")
    print(f"wrote {len(items)} placeholder artworks to {ART}")


if __name__ == "__main__":
    main()

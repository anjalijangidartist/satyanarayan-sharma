#!/usr/bin/env python3
"""Rebuild works.json from the images in assets/work.

Drop image files (jpg, jpeg, png, webp, gif) into assets/work, then run:

    python3 tools/build-manifest.py

Titles come from the filename. To set a custom title, add a "titles" map
in tools/titles.json, for example: {"study-01.jpg": "Monsoon Field"}.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "assets" / "work"
OUT = ROOT / "works.json"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ARTIST = "Satyanarayan Sharma"


def probe(path: Path):
    raw = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    stream = json.loads(raw)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def average_color(path: Path) -> str:
    try:
        raw = subprocess.run(
            [
                "ffmpeg", "-v", "error", "-i", str(path),
                "-vf", "scale=1:1", "-frames:v", "1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ],
            capture_output=True, check=True,
        ).stdout
        if len(raw) >= 3:
            return "#%02x%02x%02x" % (raw[0], raw[1], raw[2])
    except subprocess.CalledProcessError:
        pass
    return "#8a8a8a"


def humanize(stem: str) -> str:
    words = re.split(r"[-_\s]+", stem)
    return " ".join(w[:1].upper() + w[1:] for w in words if w)


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def main():
    placeholders = {
        item["src"].split("/")[-1].split("?")[0]: item
        for item in load_json(ART / ".placeholders.json", [])
    }
    titles = load_json(ROOT / "tools" / "titles.json", {})

    files = sorted(
        p for p in ART.iterdir()
        if p.is_file() and p.suffix.lower() in EXTENSIONS
    )
    sample_names = set(placeholders)
    real = [p for p in files if p.name not in sample_names]
    if real:
        files = real
    if not files:
        raise SystemExit("No images found in assets/work")

    items = []
    for path in files:
        width, height = probe(path)
        meta = placeholders.get(path.name, {})
        title = titles.get(path.name) or meta.get("title") or humanize(path.stem)
        items.append({
            "src": f"assets/work/{path.name}",
            "title": title,
            "width": width,
            "height": height,
            "color": meta.get("color") or average_color(path),
            "alt": f"{title}, artwork by {ARTIST}",
        })

    OUT.write_text(json.dumps(items, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} with {len(items)} works")


if __name__ == "__main__":
    main()

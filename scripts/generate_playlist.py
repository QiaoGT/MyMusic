from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def list_names(folder: str) -> list[str]:
    path = ROOT / folder
    if not path.exists():
        return []
    return sorted(
        p.name
        for p in path.iterdir()
        if p.is_file() and p.name != ".gitkeep"
    )


def main() -> None:
    manifest = {
        "music": list_names("mus"),
        "lyrics": list_names("lrc"),
        "covers": list_names("img"),
    }
    out = ROOT / "playlist.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated: {out}")


if __name__ == "__main__":
    main()

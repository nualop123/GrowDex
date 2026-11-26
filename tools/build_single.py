#!/usr/bin/env python3
"""Bundle the site into one HTML file you can open offline or send to someone.

Usage (from the project root):
  python tools/build_single.py                 -> dist/growdex.html (drawn seeds, safe to share)
  python tools/build_single.py --icons         -> dist/growdex-personal.html (includes js/icons.js, personal use only)
"""
import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--icons", action="store_true", help="include js/icons.js (personal use only)")
    args = ap.parse_args()

    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css">', f"<style>\n{css}</style>")

    icons = ROOT / "js" / "icons.js"
    if args.icons and not icons.exists():
        raise SystemExit("js/icons.js not found - run tools/make_icons.py first")

    def inline(m):
        src = m.group(1)
        if src == "js/icons.js":
            return f"<script>\n{icons.read_text(encoding='utf-8')}</script>" if args.icons else ""
        return f"<script>\n{(ROOT / src).read_text(encoding='utf-8')}</script>"

    html = re.sub(r'<script src="([^"]+)"[^>]*></script>', inline, html)
    html = re.sub(r"\s*<!-- Optional: js/icons.js[^>]*-->", "", html)
    out = ROOT / "dist" / ("growdex-personal.html" if args.icons else "growdex.html")
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"-> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

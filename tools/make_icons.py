#!/usr/bin/env python3
"""Make js/icons.js from YOUR OWN Growtopia install, for personal use.

The icons are Growtopia's game art. js/icons.js is listed in .gitignore:
do not commit or publish it. Without it the site shows drawn seeds instead.

Usage (from the project root):
  python tools/make_icons.py --game "<Growtopia>/game" --items "<Growtopia>/cache/items.dat"

On Windows the folders are usually:
  %LOCALAPPDATA%\\Growtopia\\game          (the .rttex textures)
  %LOCALAPPDATA%\\Growtopia\\cache\\items.dat
The game keeps updated textures in cache\\game; that folder is used first automatically.
Needs: Pillow (pip install pillow)

How an icon is chosen, the way the game does it:
  * clothing sheets have a matching *_icon.rttex with inventory icons; it is used when present
  * shoes sit in 32x64 cells and long hand items in 64x32 cells; a mount may run into the next cell
  * seeds are drawn from seed.rttex with the item's own seed colours
  * some items share one white sprite that the game tints (crystals, silk, superhero colours);
    those get the colour named in the item's name
"""
import argparse
import base64
import io
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from items_dat import parse  # noqa: E402
from rttex import load_rttex  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TILE = 32
SEED_ACTION = 19

# The game tints one shared white sprite for these colour variants.
TINTS = {
    "red": (235, 60, 60), "green": (80, 205, 85), "blue": (70, 125, 245), "black": (72, 72, 84),
    "aqua": (80, 225, 235), "cyan": (80, 225, 235), "teal": (40, 170, 170),
    "grey": (165, 165, 172), "gray": (165, 165, 172), "silver": (205, 210, 220),
    "purple": (165, 95, 230), "violet": (165, 95, 230), "pink": (255, 135, 195), "magenta": (230, 70, 200),
    "yellow": (255, 225, 60), "orange": (255, 150, 45), "brown": (165, 105, 60),
    "gold": (255, 205, 70), "golden": (255, 205, 70), "emerald": (40, 185, 110),
    "autumn": (225, 120, 45), "pineapple": (245, 220, 70), "lime": (170, 240, 60),
    "white": None,
}
COLOR_RE = re.compile(r"\b(" + "|".join(TINTS) + r")\b", re.I)


def recipe_names():
    """Every item name GrowDex shows (from js/data.js)."""
    text = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))["names"]


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def find_item(name, by_name, by_norm):
    """Exact name first, then the same name spelled differently ('Love Potion 8' / 'Love Potion #8'),
    then the game's variant name (e.g. 'Card Block - Spade', 'Wizard Hat')."""
    if name in by_name:
        return by_name[name]
    if _norm(name) in by_norm:
        return by_norm[_norm(name)]
    cands = [k for k in by_name
             if (k.startswith(name + " ") or k.startswith(name + "-") or k == name.rstrip("s") or k == "Red " + name)
             and not k.endswith(" Seed")]
    cands.sort(key=lambda k: by_name[k]["id"])
    return by_name[cands[0]] if cands else None


class Sheets:
    """Loads textures once; folders listed first win (so cache/game beats the install's game folder)."""

    def __init__(self, folders):
        self.files = {}
        for folder in reversed(folders):
            for d, _, fs in os.walk(folder):
                for f in fs:
                    if f.lower().endswith(".rttex"):
                        self.files[f.lower()] = os.path.join(d, f)
        self.cache = {}

    def get(self, name):
        path = self.files.get(name.lower())
        if not path:
            return None
        if path not in self.cache:
            self.cache[path] = load_rttex(path).convert("RGBA")
        return self.cache[path]


def cell_size(texture, icon_sheet):
    t = texture.lower()
    if t.startswith("player_feet"):
        return 32, 64                     # two walking frames stacked (the icon sheet keeps that layout)
    if t.startswith("player_longhanditem") and not icon_sheet:
        return 64, 32                     # its icon sheet has upright 32x32 icons instead
    return TILE, TILE


def components(img, own):
    """Opaque pixels of img that belong to blobs touching the box `own` (x0, y0, x1, y1)."""
    w, h = img.size
    a = img.getchannel("A").load()
    seen = bytearray(w * h)
    keep = []
    for sy in range(own[1], min(own[3], h)):
        for sx in range(own[0], min(own[2], w)):
            if a[sx, sy] == 0 or seen[sy * w + sx]:
                continue
            stack, blob = [(sx, sy)], []
            seen[sy * w + sx] = 1
            while stack:
                x, y = stack.pop()
                blob.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and a[nx, ny]:
                            seen[ny * w + nx] = 1
                            stack.append((nx, ny))
            keep.extend(blob)
    return keep


def square(img):
    """Trim a sprite, blow tiny worn-clothing sprites up a whole number of times, centre it on a square."""
    box = img.getchannel("A").getbbox()
    if box is None:
        return None
    img = img.crop(box)
    k = max(1, min(3, 24 // max(img.width, img.height)))
    if k > 1:
        img = img.resize((img.width * k, img.height * k), Image.NEAREST)
    side = max(TILE, img.width, img.height)
    out = Image.new("RGBA", (side, side))
    out.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return out


def clothing_icon(sheets, it):
    tex = it["texture"]
    icon_name = tex[:-6] + "_icon.rttex" if tex.lower().endswith(".rttex") else None
    base = sheets.get(tex)
    sheet = base
    alt = icon_name and sheets.get(icon_name)
    if alt is not None:
        if alt.size == (TILE, TILE):            # a one-icon file for this texture
            return square(alt)
        if base is None or alt.size == base.size:
            sheet = alt
    if sheet is None:
        return None
    cw, ch = cell_size(tex, sheet is alt)
    x0, y0 = it["x"] * cw, it["y"] * ch
    if x0 + cw > sheet.width or y0 + ch > sheet.height:
        return None
    if ch == 64:
        # shoes: the icon is the top half of the cell; a mount may run on into the next column
        win = sheet.crop((x0, y0, min(sheet.width, x0 + 64), y0 + 32))
        pix = components(win, (0, 0, 32, 32))
        if not pix:
            return None
        out = Image.new("RGBA", win.size)
        src, dst = win.load(), out.load()
        for p in pix:
            dst[p] = src[p]
        return square(out)
    cell = sheet.crop((x0, y0, x0 + cw, y0 + ch))
    if cell.getchannel("A").getbbox() is None:
        return None
    return square(cell)


def tile_icon(sheets, it):
    sheet = sheets.get(it["texture"])
    if sheet is None:
        return None
    x, y = it["x"] * TILE, it["y"] * TILE
    if x + TILE > sheet.width or y + TILE > sheet.height:
        return None
    tile = sheet.crop((x, y, x + TILE, y + TILE))
    return tile if tile.getchannel("A").getbbox() else None


def tint(img, rgb):
    """Multiply a (white) sprite by a colour, the way the game tints it."""
    r, g, b, a = img.split()
    r = r.point(lambda v: v * rgb[0] // 255)
    g = g.point(lambda v: v * rgb[1] // 255)
    b = b.point(lambda v: v * rgb[2] // 255)
    return Image.merge("RGBA", (r, g, b, a))


def _main_hue_mask(img):
    """Pixels that carry the sprite's own colour (its main hue), or None for a white/grey sprite."""
    hsv = img.convert("RGB").convert("HSV").load()
    alpha = img.getchannel("A").load()
    w, h = img.size
    opaque = [(x, y) for y in range(h) for x in range(w) if alpha[x, y] > 40]
    sat = [(x, y) for x, y in opaque if hsv[x, y][1] > 64 and hsv[x, y][2] > 40]
    if not opaque or len(sat) < 0.3 * len(opaque):
        return None
    bins = [0] * 12
    for x, y in sat:
        bins[hsv[x, y][0] * 12 // 256] += 1
    top = max(range(12), key=bins.__getitem__)
    near = {(top - 1) % 12, top, (top + 1) % 12}
    return [(x, y) for x, y in sat if hsv[x, y][0] * 12 // 256 in near]


def recolour(img, colours):
    """Give a shared sprite the colour(s) its name says."""
    mask = _main_hue_mask(img)
    if mask is None:                       # white sprite: tint it all (two colours = stripes)
        if len(colours) == 1:
            return tint(img, colours[0])
        out = img.copy()
        for i, rgb in enumerate(colours):
            band = Image.new("L", img.size, 0)
            for x in range(i * 4, img.width, 4 * len(colours)):
                band.paste(255, (x, 0, x + 4, img.height))
            out.paste(tint(img, rgb), (0, 0), band)
        return out
    # coloured sprite: swap only its main colour, keep eyes, outlines and details
    rgb = colours[0]
    src = img.load()
    lum = {p: (src[p][0] * 299 + src[p][1] * 587 + src[p][2] * 114) / 1000 for p in mask}
    top = max(lum.values()) or 1
    out = img.copy()
    dst = out.load()
    for p in mask:
        k = min(1.0, lum[p] / top)
        dst[p] = (int(rgb[0] * k), int(rgb[1] * k), int(rgb[2] * k), src[p][3])
    return out


def seed_icon(sheets, it):
    """Seeds are drawn from seed.rttex: a base shape and an overlay, each in the item's colours."""
    sheet = sheets.get("seed.rttex")
    if sheet is None:
        return None
    base, overlay, c1, c2 = it["seed"]
    out = Image.new("RGBA", (16, 16))
    for idx, row, col in ((base, 0, c1), (overlay, 1, c2)):
        part = sheet.crop((idx * 16, row * 16, idx * 16 + 16, row * 16 + 16))
        out.alpha_composite(tint(part, col[1:4]))
    canvas = Image.new("RGBA", (TILE, TILE))
    canvas.paste(out.resize((24, 24), Image.NEAREST), (4, 4))
    return canvas


def make_icon(sheets, it):
    if it.get("action") == SEED_ACTION and it["name"].endswith(" Seed"):
        return seed_icon(sheets, it)
    tex = it["texture"]
    one = tex.lower().endswith(".rttex") and sheets.get(tex[:-6] + "_icon.rttex")
    if one is not None and one is not False and one.size == (TILE, TILE):
        return square(one)                  # a texture with its own single inventory icon
    if it["texture"].lower().startswith("player_"):
        return clothing_icon(sheets, it)
    return tile_icon(sheets, it)


def colour_variants(images):
    """Items whose sprites are identical but whose names name different colours get those colours."""
    groups = {}
    for name, img in images.items():
        groups.setdefault(img.tobytes() + bytes(img.size), []).append(name)
    tinted = 0
    for names in groups.values():
        words = {n: tuple(w.lower() for w in COLOR_RE.findall(n)) for n in names}
        words = {n: c for n, c in words.items() if c and len(c) <= 2}
        if len(set(words.values())) < 2:
            continue
        base = images[names[0]]
        lit = base.convert("L").tobytes()
        alpha = base.getchannel("A").tobytes()
        shown = [v for v, a in zip(lit, alpha) if a > 40]
        if shown and sum(shown) / len(shown) < 60:
            continue                       # a dark placeholder sprite: leave it as the game shows it
        for n, c in words.items():
            rgbs = [TINTS[w] or (255, 255, 255) for w in c]
            if all(TINTS[w] is None for w in c) and _main_hue_mask(base) is None:
                continue                   # "White" on a white sprite: already right
            images[n] = recolour(images[n], rgbs)
            tinted += 1
    return tinted


def png_data(img):
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True, action="append",
                    help="folder with the .rttex texture files (repeat to add more; earlier wins)")
    ap.add_argument("--items", required=True, help="path to items.dat")
    ap.add_argument("--out", default=str(ROOT / "js" / "icons.js"))
    args = ap.parse_args()

    folders = list(args.game)
    cache_game = Path(args.items).resolve().parent / "game"
    if cache_game.is_dir() and str(cache_game) not in folders:
        folders.insert(0, str(cache_game))       # updated textures the game downloaded

    _ver, items = parse(args.items)
    by_name, by_norm = {}, {}
    for it in items:
        by_name.setdefault(it["name"], it)
        if not it["name"].endswith(" Seed"):
            by_norm.setdefault(_norm(it["name"]), it)
    sheets = Sheets(folders)

    images, missing = {}, []
    for name in recipe_names():
        it = find_item(name, by_name, by_norm)
        img = it and make_icon(sheets, it)
        if img is None:
            missing.append(name)
        else:
            images[name] = img
    tinted = colour_variants(images)

    icons = {name: png_data(img) for name, img in images.items()}
    js = "/* Personal icons made by tools/make_icons.py from your own game files. Do not publish. */\n"
    js += "window.GS_ICONS=" + json.dumps(icons, separators=(",", ":")) + ";\n"
    Path(args.out).write_text(js, encoding="utf-8")
    print(f"{len(icons)} icons ({tinted} colour variants tinted) -> {args.out}")
    if missing:
        print(f"{len(missing)} items use the drawn seed instead" + (": " + ", ".join(missing[:30]) + (" …" if len(missing) > 30 else "")))


if __name__ == "__main__":
    main()

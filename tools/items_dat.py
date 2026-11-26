#!/usr/bin/env python3
"""Minimal reader for Growtopia's items.dat.

Only the fields this project needs are kept: id, name, action type, texture file, texture x/y
(in cells of the texture sheet), and the seed look (base/overlay sprite and their ARGB colours).
Fields added in newer file versions are skipped by re-syncing on the next item's id and name,
so the reader keeps working when the game adds bytes at the end of each item.

Usage:
  python tools/items_dat.py <items.dat> [out.json]
"""
import json
import struct
import sys

KEY = b"PBG892FXX982ABC*"


class Reader:
    def __init__(self, data):
        self.b, self.p = data, 0

    def u8(self):
        v = self.b[self.p]; self.p += 1; return v

    def u16(self):
        v = struct.unpack_from("<H", self.b, self.p)[0]; self.p += 2; return v

    def u32(self):
        v = struct.unpack_from("<I", self.b, self.p)[0]; self.p += 4; return v

    def skip(self, n):
        self.p += n

    def text(self, item_id=None):
        n = self.u16()
        raw = self.b[self.p:self.p + n]
        self.p += n
        if item_id is not None:  # item names are xor-encoded with a key offset by the item id
            raw = bytes(c ^ KEY[(i + item_id) % len(KEY)] for i, c in enumerate(raw))
        return raw.decode("latin1")


def _looks_like_item(b, pos, item_id):
    if pos + 10 > len(b) or struct.unpack_from("<I", b, pos)[0] != item_id:
        return False
    n = struct.unpack_from("<H", b, pos + 8)[0]
    if not 0 < n < 120:
        return False
    name = bytes(c ^ KEY[(i + item_id) % len(KEY)] for i, c in enumerate(b[pos + 10:pos + 10 + n]))
    return all(32 <= c < 127 for c in name)


def parse(path):
    with open(path, "rb") as f:
        r = Reader(f.read())
    version, count = r.u16(), r.u32()
    items = []
    for idx in range(count):
        item_id = r.u32()
        r.skip(2)                        # editable type, category
        action = r.u8()                  # 19 = seed, 20 = clothing, ...
        r.skip(1)                        # hit sound
        name = r.text(item_id)
        texture = r.text()
        r.skip(4); r.skip(1); r.skip(4)  # texture hash, item kind, val1
        tex_x, tex_y = r.u8(), r.u8()
        r.skip(3 + 1 + 4 + 1 + 2 + 1)    # spread, stripey, collision, break hits, drop chance, clothing, rarity, max amount
        r.text(); r.skip(8)              # extra file, hash, audio volume
        for _ in range(4):
            r.text()                     # pet name / prefix / suffix / ability
        seed_base, seed_overlay = r.u8(), r.u8()
        r.skip(2)                        # tree base / leaves
        seed_color = tuple(r.b[r.p:r.p + 4]); r.skip(4)      # stored as A, R, G, B
        overlay_color = tuple(r.b[r.p:r.p + 4]); r.skip(4)
        r.skip(4 + 4 + 2 + 2)            # ingredient, grow time, val2, rayman
        r.text(); r.text(); r.text()     # extra options, texture2, extra options 2
        r.skip(80)
        if version >= 11: r.text()
        if version >= 12: r.skip(13)
        if version >= 13: r.skip(4)
        if version >= 14: r.skip(4)
        if version >= 15: r.skip(25); r.text()
        if version >= 16: r.text()
        if version >= 17: r.skip(4)
        if version >= 18: r.skip(4)
        if version >= 19: r.skip(9)
        if version >= 21: r.skip(2)
        if version >= 22: r.text()
        if version >= 23: r.skip(4)
        if version >= 24: r.skip(1)
        items.append({"id": item_id, "name": name, "action": action, "texture": texture, "x": tex_x, "y": tex_y,
                      "seed": [seed_base, seed_overlay, list(seed_color), list(overlay_color)]})
        if idx < count - 1:              # skip unknown newer fields until the next item starts
            for extra in range(600):
                if _looks_like_item(r.b, r.p + extra, item_id + 1):
                    r.skip(extra)
                    break
            else:
                raise ValueError(f"lost track after item {item_id} ({name})")
    return version, items


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ver, items = parse(sys.argv[1])
    print(f"items.dat version {ver}: {len(items)} items")
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False)

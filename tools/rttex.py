#!/usr/bin/env python3
"""Read Growtopia .rttex textures (Proton SDK format) and convert them to PNG.

Layout:
  optional RTPACK header (32 bytes) followed by zlib data, which holds:
  RTTXTR header (124 bytes): height@8, width@12, format@16 (5121 = 8-bit), orig height@20, orig width@24
  first mip header at 100: height, width, data size; pixel data starts at 124, stored bottom-up.

Usage:
  python tools/rttex.py <folder or file> <output folder>
Needs: Pillow (pip install pillow)
"""
import os
import struct
import sys
import zlib

from PIL import Image


def load_rttex(path):
    """Return a PIL RGBA/RGB image for an .rttex file."""
    with open(path, "rb") as f:
        b = f.read()
    if b[:6] == b"RTPACK":
        b = zlib.decompress(b[32:])
    if b[:6] != b"RTTXTR":
        raise ValueError(f"{path}: not an RTTXTR texture")
    _h, _w, fmt, orig_h, orig_w = struct.unpack_from("<5i", b, 8)
    mip_h, mip_w, size = struct.unpack_from("<3i", b, 100)
    data = b[124:124 + size]
    pixels = mip_w * mip_h
    if fmt != 5121:
        raise ValueError(f"{path}: unsupported pixel format {fmt}")
    mode = "RGBA" if size >= pixels * 4 else "RGB" if size >= pixels * 3 else None
    if not mode:
        raise ValueError(f"{path}: unexpected data size {size} for {mip_w}x{mip_h}")
    img = Image.frombytes(mode, (mip_w, mip_h), data[:pixels * len(mode)]).transpose(Image.FLIP_TOP_BOTTOM)
    if 0 < orig_w <= mip_w and 0 < orig_h <= mip_h:
        img = img.crop((0, 0, orig_w, orig_h))
    return img


def convert(src, dst):
    files = [src] if os.path.isfile(src) else [
        os.path.join(root, f) for root, _, fs in os.walk(src) for f in fs if f.lower().endswith(".rttex")]
    base = os.path.dirname(src) if os.path.isfile(src) else src
    ok = 0
    for path in files:
        try:
            out = os.path.join(dst, os.path.relpath(path, base))[:-6] + ".png"
            os.makedirs(os.path.dirname(out), exist_ok=True)
            load_rttex(path).save(out)
            ok += 1
        except Exception as e:  # keep going on a bad file
            print("skip:", e)
    print(f"converted {ok}/{len(files)} files -> {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])

# -*- coding: utf-8 -*-
"""把 48px 图集里几行放大 7 倍拼一张。"""
import json
import os
import sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ATLAS = os.path.join(ROOT, "demo", "pet-atlas48.png")
META = os.path.join(ROOT, "demo", "pet-atlas48.json")

rows = sys.argv[1:] or ["idle", "flap", "stretch", "turn"]
meta = json.load(open(META, encoding="utf-8"))
sheet = Image.open(ATLAS)
S = meta["frame"]["w"]
F = max(st["frames"] for st in meta["states"].values())
SCALE = 7

W = S * F * SCALE
H = S * SCALE * len(rows)
out = Image.new("RGBA", (W + 120, H), (250, 248, 242, 255))
d = ImageDraw.Draw(out)
for i, key in enumerate(rows):
    row = meta["states"][key]["row"]
    crop = sheet.crop((0, row * S, S * F, row * S + S))
    out.alpha_composite(crop.resize((S * F * SCALE, S * SCALE), Image.NEAREST), (120, i * S * SCALE))
    d.text((6, i * S * SCALE + 10), key, fill=(30, 30, 30, 255))
p = os.path.join(HERE, "zoom-check.png")
out.save(p)
print("ok", p, out.size)

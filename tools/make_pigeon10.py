# -*- coding: utf-8 -*-
"""
「小鸽」像素精灵 v9 —— 48x48 / 14 帧 / 侧身信鸽版

为什么是这个配色：鸽子最认得出的几处，按辨识度从高到低
  1. 石板蓝灰的身子（不是白鸭子）
  2. 收着的翅膀上两条黑杠（一眼就是鸽）
  3. 脖子上一圈绿紫光泽（虹彩颈羽）
  4. 小尖喙 + 白色的鼻瘤（cere）—— 这条几乎是鸽形目的身份证
  5. 橙红眼 + 粉红脚 + 信鸽脚环（一块 lime，顺带接上站点主色）

动作：14 帧，最后 2 帧是收尾帧（f13 与 idle 第 0 帧同一姿势）；
      侧身朝右，look_l / look_r 用整幅镜像在渲染层做（meta.mirror）。

运行: <python> tools/make_pigeon9.py
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw

S = 48
FRAMES = 26          # 12 主帧 ×2 补间 = 24 主帧 + 2 收尾帧
BASE = 12
RESAMPLE = 2
SETTLE = 2
TICK = 45            # 一拍 45ms：总时长不变，画面更新率翻倍
STATES = [
    "idle", "alert", "happy", "sad", "sleepy", "celebrate", "focus", "pat",
    "wave", "groom", "stretch", "look_l", "look_r", "flap", "turn", "wag",
]
NUM = ["dy", "st", "head_dx", "head_dy", "neck", "lean", "wing", "wing_up",
       "tail", "beak", "lift", "squash"]

C = {
    # 调色板取自 Pigeon (Blue Bird Rework)：冷灰 + 黑杠 + 绿紫颈 + 红眼 + 橙脚
    "outline": (26, 28, 34, 255),      # #1A1C22
    "line":    (85, 85, 85, 255),      # #555555 羽缝
    "body":    (196, 196, 196, 255),   # #C4C4C4
    "body_hi": (221, 221, 221, 255),   # #DDDDDD 胸腹亮面
    "belly":   (232, 232, 232, 255),
    "body_sh": (176, 176, 176, 255),   # #B0B0B0 背/头暗面
    "body_dk": (133, 133, 133, 255),   # #858585
    "head":    (176, 176, 176, 255),
    "head_hi": (196, 196, 196, 255),
    "head_sh": (159, 159, 159, 255),
    "wing":    (159, 159, 159, 255),
    "wing_dk": (133, 133, 133, 255),
    "wing_hi": (196, 196, 196, 255),
    "wing_far": (168, 168, 168, 255),
    "bar":     (26, 28, 34, 255),      # 黑杠
    "neck":    (11, 173, 125, 255),    # #0BAD7D
    "neck_hi": (12, 196, 142, 255),    # #0CC48E
    "neck2":   (128, 115, 147, 255),   # #807393 紫
    "beak":    (221, 221, 221, 255),   # 鼻瘤/喙的亮面
    "beak_dk": (60, 60, 60, 255),
    "cere":    (238, 238, 238, 255),
    "mouth":   (128, 66, 66, 255),
    "tongue":  (214, 126, 126, 255),
    "eye":     (170, 43, 43, 255),     # #AA2B2B
    "eye_dk":  (40, 30, 30, 255),
    "hi":      (255, 255, 255, 255),
    "feet":    (221, 115, 62, 255),    # #DD733E
    "feet_dk": (198, 80, 51, 255),     # #C65033
    "lime":    (217, 242, 107, 255),
    "lime_dk": (166, 196, 48, 255),
    "red":     (216, 85, 60, 255),
    "amber":   (240, 190, 80, 255),
    "tear":    (128, 190, 240, 255),
    "zzz":     (150, 176, 204, 255),
}

YY, XX = np.mgrid[0:S, 0:S].astype(np.float64)


# ------------------------------------------------------------------ 基础
def sup(cx, cy, rx, ry, n=2.2):
    return (np.abs((XX + 0.5 - cx) / rx) ** n + np.abs((YY + 0.5 - cy) / ry) ** n) <= 1.0


def ell(cx, cy, rx, ry):
    return ((XX + 0.5 - cx) / rx) ** 2 + ((YY + 0.5 - cy) / ry) ** 2 <= 1.0


def dil(mask, r=1):
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:, :] |= out[:-1, :]
        m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        out = m
    return out


def put(img, mask, color):
    img[mask] = color


def rect(img, x, y, w, h, color):
    m = np.zeros((S, S), bool)
    m[max(0, y):max(0, y + h), max(0, x):max(0, x + w)] = True
    put(img, m, color)
    return m


def px(img, x, y, color):
    if 0 <= x < S and 0 <= y < S:
        img[int(y), int(x)] = color


def chain(ax, ay, tx, ty, w0, n=14):
    m = np.zeros((S, S), bool)
    for t in np.linspace(0.0, 1.0, n):
        x = ax + (tx - ax) * t
        y = ay + (ty - ay) * t
        m |= ell(x, y, 4.2 * (1 - t) + 1.2, 3.4 * (1 - t) + 1.0)
    return m


# ------------------------------------------------------------------ 动作表
def tables(state):
    a = lambda: [0] * BASE
    p = dict(dy=a(), st=a(), head_dx=a(), head_dy=a(), neck=a(), lean=a(),
             wing=a(), wing_up=a(), tail=a(), beak=a(), lift=a(), squash=a())
    p["eye"] = ["open"] * BASE
    p["dir"] = [1] * BASE

    if state == "idle":                     # 呼吸 + 鸽子式点头 + 眨眼 + 扫尾巴
        p["dy"] = [0, 0, -1, -1, -2, -2, -2, -1, -1, 0, 0, 0]
        p["st"] = [0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 0, 0]
        p["head_dx"] = [0, 1, 2, 2, 1, 0, 0, 1, 2, 1, 0, 0]
        p["head_dy"] = [0, 0, 0, 0, -1, -1, -1, 0, 0, 0, 0, 0]
        p["neck"] = [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
        p["tail"] = [0, 0, 1, 1, 0, 0, 0, -1, -1, 0, 0, 0]
        p["eye"] = ["blink" if f in (9, 10) else "open" for f in range(BASE)]

    elif state == "alert":                  # 左右张望 + 张嘴叫 + 翅膀半张
        p["dy"] = [0, -1, -1, -1, 0, 0, -1, -1, -1, 0, 0, 0]
        p["head_dx"] = [0, 2, 3, 4, 2, -2, -3, -3, -2, 0, 0, 0]
        p["head_dy"] = [-1, -2, -2, -2, -1, -2, -2, -2, -1, 0, 0, 0]
        p["neck"] = [1] * 9 + [0, 0, 0]
        p["beak"] = [1, 3, 3, 2, 2, 3, 3, 2, 1, 0, 0, 0]
        p["wing"] = [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]
        p["tail"] = [0, -1, -2, -2, -1, 1, 2, 2, 1, 0, 0, 0]
        p["eye"] = ["wide"] * BASE

    elif state == "happy":                  # 连蹦两下，翅膀扇起来
        p["dy"] = [1, 0, -4, -8, -4, 1, -3, -7, -3, 1, 0, 0]
        p["st"] = [-1, 1, 3, 4, 1, -2, 2, 3, 1, -1, 0, 0]
        p["lift"] = [0, 1, 4, 7, 3, 0, 2, 6, 2, 0, 0, 0]
        p["wing"] = [0, 2, 3, 4, 3, 0, 2, 4, 2, 0, 0, 0]
        p["wing_up"] = [0, 0, 1, 2, 1, 0, 0, 2, 1, 0, 0, 0]
        p["beak"] = [0, 3, 3, 3, 2, 0, 3, 3, 2, 0, 0, 0]
        p["tail"] = [0, 1, 1, 0, -1, 0, 1, 1, 0, 0, 0, 0]
        p["eye"] = ["happy"] * BASE

    elif state == "sad":                    # 塌下去，眼睛垂下来
        p["dy"] = [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0]
        p["st"] = [0, -1, -2, -3, -3, -3, -3, -3, -3, -2, -1, 0]
        p["head_dy"] = [1, 2, 4, 5, 6, 5, 6, 6, 5, 3, 2, 1]
        p["head_dx"] = [0, -1, -2, -2, -3, -2, -3, -3, -2, -1, 0, 0]
        p["beak"] = [0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0]
        p["tail"] = [0, -1, -1, -2, -2, -1, -2, -2, -1, 0, 0, 0]
        p["eye"] = ["sad"] * BASE

    elif state == "sleepy":                 # 打盹，头和身体一起慢慢晃
        p["dy"] = [1, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1, 1]
        p["st"] = [-1, -2, -2, -2, -1, -1, -2, -2, -2, -1, -1, -1]
        p["head_dx"] = [0, 1, 2, 3, 2, 0, -1, -2, -3, -2, 0, 0]
        p["head_dy"] = [2, 3, 4, 4, 3, 2, 3, 4, 4, 3, 2, 2]
        p["tail"] = [0, 1, 2, 2, 1, 0, -1, -2, -2, -1, 0, 0]
        p["beak"] = [1] * BASE
        p["eye"] = ["closed"] * BASE

    elif state == "celebrate":              # 大跳 + 张开双翅 + 撒彩屑
        p["dy"] = [2, 1, -3, -7, -8, -6, -3, 1, 4, 1, 0, 0]
        p["st"] = [-2, 1, 2, 3, 3, 3, 2, 1, -3, -1, 0, 0]
        p["lift"] = [0, 2, 5, 8, 8, 6, 3, 0, 0, 0, 0, 0]
        p["wing"] = [0, 2, 3, 4, 4, 4, 3, 1, 0, 0, 0, 0]
        p["wing_up"] = [0, 1, 2, 2, 2, 1, 1, 0, 0, 0, 0, 0]
        p["beak"] = [0, 3, 3, 3, 3, 3, 2, 0, 0, 0, 0, 0]
        p["tail"] = [0, 1, 1, 1, 0, 0, 0, -1, -1, 0, 0, 0]
        p["eye"] = ["happy"] * BASE

    elif state == "focus":                  # 低头看书 + 单眼镜
        p["dy"] = [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0]
        p["st"] = [0, 0, 0, -1, -1, -1, -1, -1, 0, 0, 0, 0]
        p["head_dx"] = [1, 2, 3, 4, 4, 4, 4, 3, 2, 1, 1, 1]
        p["head_dy"] = [1, 2, 3, 4, 5, 5, 4, 4, 2, 1, 1, 1]
        p["neck"] = [1] * 9 + [0, 0, 0]
        p["beak"] = [0] * 9 + [1, 0, 0]
        p["eye"] = ["focus"] * BASE

    elif state == "pat":                    # 被摸：压扁 → 弹两下
        p["dy"] = [2, 4, 4, 3, 0, -1, 0, -1, 0, 0, 0, 0]
        p["st"] = [-2, -4, -5, -3, 1, 2, 1, 1, 0, 0, 0, 0]
        p["head_dy"] = [2, 3, 4, 3, 0, -1, 0, 0, 0, 0, 0, 0]
        p["head_dx"] = [0, 1, 2, 1, 0, 0, 1, 0, 0, 0, 0, 0]
        p["beak"] = [3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]
        p["tail"] = [0, 1, 2, 1, 0, -1, 0, 0, 0, 0, 0, 0]
        p["eye"] = ["happy"] * BASE

    elif state == "wave":                   # 打招呼：抬头 + 扇两下
        p["dy"] = [0, -1, -2, -3, -2, -1, -2, -3, -2, -1, 0, 0]
        p["st"] = [0, 1, 1, 2, 1, 0, 1, 2, 1, 0, 0, 0]
        p["head_dy"] = [-1, -2, -4, -5, -4, -3, -4, -5, -4, -2, 0, 0]
        p["neck"] = [1, 2, 2, 3, 2, 2, 2, 3, 2, 1, 0, 0]
        p["wing"] = [1, 3, 4, 4, 3, 2, 3, 4, 3, 1, 0, 0]
        p["wing_up"] = [0, 1, 2, 2, 1, 0, 1, 2, 1, 0, 0, 0]
        p["beak"] = [1, 3, 3, 2, 1, 3, 3, 2, 1, 0, 0, 0]
        p["eye"] = ["happy"] * BASE

    elif state == "groom":                  # 理毛：脑袋扎下去蹭翅膀
        p["dy"] = [0, 0, 1, 2, 1, 0, 1, 2, 1, 0, 0, 0]
        p["head_dx"] = [-1, -3, -5, -6, -4, 1, 4, 5, 2, 0, 0, 0]
        p["head_dy"] = [1, 3, 6, 7, 6, 5, 6, 7, 5, 2, 1, 0]
        p["beak"] = [1, 3, 3, 2, 1, 2, 3, 3, 2, 0, 0, 0]
        p["wing"] = [0, 0, 1, 2, 1, 0, 0, 1, 0, 0, 0, 0]
        p["eye"] = ["closed"] * BASE

    elif state == "stretch":                # 伸懒腰：脖子拔出来 + 张翅
        p["dy"] = [0, 0, -1, -2, -3, -3, -2, 0, 1, 1, 0, 0]
        p["st"] = [0, 1, 2, 3, 4, 4, 3, 1, -1, -1, 0, 0]
        p["head_dy"] = [1, -1, -4, -7, -9, -9, -7, -4, -1, 0, 0, 0]
        p["head_dx"] = [0, 1, 1, 2, 2, 2, 2, 1, 0, 0, 0, 0]
        p["neck"] = [1, 2, 3, 4, 5, 5, 4, 3, 1, 0, 0, 0]
        p["wing"] = [0, 1, 2, 3, 4, 4, 3, 1, 0, 0, 0, 0]
        p["beak"] = [1, 3, 3, 3, 3, 3, 3, 2, 0, 0, 0, 0]
        p["eye"] = ["closed"] * 6 + ["open"] * 6

    elif state in ("look_l", "look_r"):     # 扭头看鼠标（整幅镜像在渲染层做）
        sd = 1 if state == "look_r" else -1
        p["dy"] = [0, 0, -1, -1, -1, 0, 0, -1, -1, 0, 0, 0]
        p["head_dx"] = [0, 2 * sd, 3 * sd, 4 * sd, 3 * sd, 2 * sd,
                        2 * sd, 3 * sd, 3 * sd, 2 * sd, 1 * sd, 0]
        p["head_dy"] = [0, 0, -1, -1, -1, 0, 0, 0, -1, 0, 0, 0]
        p["neck"] = [0, 1, 1, 2, 1, 1, 0, 0, 1, 0, 0, 0]
        p["dir"] = [sd] * BASE
        p["eye"] = ["side"] * BASE

    elif state == "flap":                   # 扇翅膀：连着扇两轮
        p["dy"] = [0, -1, -2, -2, -1, 0, 1, 1, 0, -1, -2, -1]
        p["st"] = [0, 1, 2, 2, 1, 0, -1, -1, 0, 1, 2, 1]
        p["head_dy"] = [0, 0, -1, -1, 0, 0, 1, 1, 0, 0, -1, 0]
        p["wing"] = [0, 2, 4, 4, 3, 1, 0, 0, 1, 3, 4, 2]
        p["wing_up"] = [0, 1, 2, 2, 1, 0, 0, 0, 0, 1, 2, 1]
        p["beak"] = [0, 1, 3, 3, 1, 0, 0, 0, 0, 1, 3, 1]
        p["tail"] = [0, -1, -2, -2, -1, 0, 1, 2, 1, -1, -2, -1]
        p["eye"] = ["open", "open", "happy", "happy", "open", "open",
                    "open", "blink", "open", "happy", "happy", "open"]

    elif state == "turn":                   # 回头：把脑袋扭到肩膀后面看一眼，再转回来
        p["dy"] = [0, 1, 1, 2, 2, 2, 2, 1, 1, 0, 0, 0]
        p["st"] = [0, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0]
        p["head_dx"] = [0, -2, -3, -4, -4, -4, -4, -3, -2, -1, 0, 0]
        p["head_dy"] = [0, -1, -1, 0, 1, 1, 1, 1, 0, 0, 0, 0]
        p["neck"] = [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]
        p["tail"] = [0, 1, 2, 3, 3, 2, 2, 1, 0, 0, 0, 0]
        p["wing"] = [0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
        p["eye"] = ["open", "side", "side", "back", "back", "back",
                    "back", "back", "side", "side", "open", "open"]
        p["dir"] = [-1] * 8 + [1] * 4

    elif state == "wag":                    # 摇尾巴：屁股跟着摆
        p["dy"] = [0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0]
        p["st"] = [0, 0, -1, -1, -1, 0, 0, -1, -1, -1, 0, 0]
        p["tail"] = [0, 3, 4, 4, 3, 0, -3, -4, -4, -3, 0, 0]
        p["head_dx"] = [0, 0, 1, 1, 0, 0, -1, -1, 0, 0, 0, 0]
        p["beak"] = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0]
        p["eye"] = ["happy"] * BASE

    return with_settle(resample2(p))


def resample2(p):
    """12 主帧 → 24 主帧：在每两帧之间插一个姿势中点。
    时长不变（每帧停的拍数也翻倍、tick 减半），但画面更新率翻倍。"""
    q = {}
    for key in NUM:
        v = p[key]
        nv = []
        for i in range(len(v)):
            nv.append(v[i])
            nv.append(int(round((v[i] + v[i + 1]) / 2.0)) if i + 1 < len(v) else v[i])
        q[key] = nv
    for key in ("eye", "dir"):
        nv = []
        for x in p[key]:
            nv.extend([x, x])
        q[key] = nv
    return q


def with_settle(p):
    for k in NUM:
        last = p[k][-1]
        p[k] = p[k][:] + [int(round(last * 0.4)), 0]
    p["eye"] = p["eye"][:]
    p["dir"] = p["dir"][:] + [1, 1]
    tail_eye = p["eye"][BASE - 1]
    p["eye"].append("half" if tail_eye in ("closed", "sad", "focus", "back") else "open")
    p["eye"].append("open")
    return p


# ------------------------------------------------------------------ 部件
def parts(p, f):
    dy, st = p["dy"][f], p["st"][f]
    lift = p["lift"][f]
    neck = p["neck"][f]
    hdx, hdy = p["head_dx"][f], p["head_dy"][f]

    cy = 31.0 + dy
    ry = 8.6 + st * 1.05
    rx = 11.0 - st * 0.55
    body = sup(23.2, cy, rx, ry, 2.2)

    hy = 17.4 + dy + hdy + 0.55 * neck
    hx = 28.4 + hdx
    hrx = 7.5 + st * 0.12
    hry = 7.2 - st * 0.28
    head = ell(hx, hy, hrx, hry)

    nk = None
    top = cy - ry + 3.0
    if hy + hry - 3.0 < top + 1.0:
        w = 6.8 - min(2.2, neck * 0.3)
        y0, y1 = int(round(hy + hry - 3.6)), int(round(top + 1.0))
        if y1 > y0:
            m = np.zeros((S, S), bool)
            m[y0:y1, int(round(hx - 2.2 - w / 2)):int(round(hx - 2.2 + w / 2))] = True
            nk = m
    return dict(body=body, head=head, nk=nk, hx=hx, hy=hy, cy=cy, rx=rx, ry=ry,
                hrx=hrx, hry=hry, lift=lift, dy=dy, st=st)


def paint_tail(img, P, sway):
    """尾巴：深色长尾羽向后下方甩出去，sway -4..4。"""
    cy, rx = P["cy"], P["rx"]
    fan = np.zeros((S, S), bool)
    base_x = 23.2 - rx * 0.62
    for i, (dx, dy, rxx, ryy) in enumerate(((-0.4, 3.0, 6.0, 2.2),
                                            (-4.2, 4.6, 5.2, 1.9),
                                            (-7.8, 6.0, 4.0, 1.5))):
        fan |= ell(base_x + dx, cy + dy + sway * (0.55 + 0.15 * i), rxx, ryy)
    put(img, dil(fan) & ~fan, C["outline"])
    put(img, fan, C["line"])                                  # #555 尾羽
    put(img, fan & ~ell(base_x - 1.2, cy + 1.0 + sway * 0.5, 4.6, 2.8), C["body_dk"])
    for i in range(3):                                        # 尾羽分缝
        x = int(base_x - 8.0 + i * 2.6)
        y = int(cy + 6.2 + sway * 0.85 + i * 0.5)
        if 0 <= x < S and 0 <= y < S and fan[y, x]:
            px(img, x, y, C["outline"])
            px(img, x + 1, y + 1, C["outline"])


def wing_fan(ax, ay, span, up, bend=0.62, drop=0.20, wide=4.4, tipw=2.6):
    """一片展开的翅膀：沿一条外凸的贝塞尔曲线堆椭圆，比三根尖羽片更像翅膀。"""
    tx = ax - span * 1.00
    ty = ay - span * 0.92 - up * 0.8
    cx = ax - span * bend
    cy = ay - span * drop
    m = np.zeros((S, S), bool)
    for t in np.linspace(0.0, 1.0, 18):
        x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * tx
        y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * ty
        r = wide * (1 - t) ** 0.7 + tipw * t
        m |= ell(x, y, r, r * 0.94)
    # 后缘轻轻咬两个缺口，做出羽片的感觉（别咬穿）
    for t in (0.64, 0.84):
        x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * tx
        y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * ty
        r = wide * (1 - t) ** 0.7 + tipw * t
        m &= ~ell(x + r * 0.30, y + r * 1.02, 1.1, 1.0)
    return m


def paint_far_wing(img, P, mode, up):
    if mode < 2:
        return
    span = {2: 4.6, 3: 7.4, 4: 9.6}.get(mode, 9.6)
    m = wing_fan(24.6, P["cy"] - 5.0 - up * 0.4, span, up, wide=3.8, tipw=2.2)
    put(img, m, C["wing_dk"])


def paint_body(img, P):
    body, head, nk = P["body"], P["head"], P["nk"]
    fill = body | head
    if nk is not None:
        fill = fill | nk
    put(img, dil(fill) & ~fill, C["outline"])
    if nk is not None:
        put(img, nk & ~body & ~head, C["body"])
        put(img, nk & ~body & ~head & (XX + 0.5 > P["hx"] - 1.0), C["neck"])
    put(img, body, C["body"])
    # 参考图的光照：背/上缘压暗，胸腹最亮
    put(img, body & ~ell(23.2, P["cy"] + 1.6, P["rx"] - 0.2, P["ry"] - 0.2), C["body_sh"])
    put(img, body & ell(25.6, P["cy"] + 2.4, P["rx"] - 3.4, P["ry"] - 2.4), C["body_hi"])
    put(img, body & ell(26.2, P["cy"] + 4.4, 4.8, 2.6), C["belly"])
    put(img, head, C["head"])
    put(img, head & (XX + 0.5 < P["hx"] - 1.2), C["head_sh"])
    put(img, head & ell(P["hx"] - 0.8, P["hy"] + 1.4, 4.6, 3.2), C["head_hi"])
    # 头和身子的接触影，不然脖子会糊在一起
    put(img, dil(head) & body & ~head, C["body_sh"])


def paint_neck_sheen(img, P):
    """脖子上的虹彩：前下方是绿松石，后上方一点紫——参考图里最抓眼的一块颜色。"""
    hx, hy = P["hx"], P["hy"]
    base = P["body"] | P["head"]
    if P["nk"] is not None:
        base = base | P["nk"]
    mask = dil(base, 0)
    green = ell(hx - 3.2, hy + 4.6, 3.8, 2.6) & mask
    put(img, green, C["neck"])
    put(img, green & ell(hx - 3.6, hy + 3.8, 2.4, 1.2), C["neck_hi"])
    purple = ell(hx - 5.2, hy + 1.4, 2.2, 1.5) & mask
    put(img, purple, C["neck2"])
    put(img, green & (YY + 0.5 > hy + 6.4), C["body"])


def paint_wing(img, P, mode, up, far=False):
    """收着的翅膀：一块压暗羽片 + 两条黑杠；张开：三根羽片扇出去。"""
    cy = P["cy"]
    ax, ay = 21.0, cy - 0.2 - up * 0.6
    if mode <= 1:
        ax, ay = 21.0, cy - 0.2 - up * 0.6
        w = sup(ax, ay + 1.6, 5.0, 4.6, 2.4) & dil(P["body"], 1)
        put(img, w, C["wing"])
        put(img, w & ~np.roll(w, 1, axis=0), C["wing_hi"])          # 上缘受光
        put(img, w & (YY + 0.5 > ay + 5.6), C["wing_dk"])           # 下缘暗
        # 两道短黑杠：只占翅膀中间六成，太长会像嘴
        for oy in (2.2, 3.8):
            y = int(round(ay + oy))
            xs = np.where(w[y, :])[0]
            if len(xs) >= 7:
                x0 = int(xs.min()) + 1
                x1 = x0 + int((xs.max() - xs.min()) * 0.60)
                for x in range(x0, x1 + 1):
                    px(img, x, y, C["bar"])
        put(img, dil(w) & ~w & dil(P["body"], 0), C["line"])        # 翅膀边线
        return
    span = {2: 6.4, 3: 10.4, 4: 13.6}.get(mode, 13.6)
    ax, ay = 18.8, cy - 3.2 - up * 0.5
    fan = wing_fan(ax, ay, span, up)
    put(img, dil(fan) & ~fan, C["outline"])
    put(img, fan, C["wing"])
    put(img, fan & (YY + 0.5 > ay - 2.0), C["wing_dk"])
    put(img, fan & ell(ax - 2.6, ay - 3.0, 3.2, 2.2), C["wing_hi"])
    # 外侧飞羽压黑：按到肩点的距离分段
    rr = np.sqrt((XX + 0.5 - ax) ** 2 + (YY + 0.5 - ay) ** 2)
    put(img, fan & (rr > span * 0.60), C["bar"])
    put(img, fan & (rr > span * 0.88), C["line"])


def paint_feet(img, P, lift):
    y = int(round(P["cy"] + P["ry"] - 1.0)) - lift
    # 远脚：先画、浅一档
    rect(img, 26, y - 2, 1, 3, C["feet_dk"])
    rect(img, 25, y + 1, 3, 1, C["feet_dk"])
    px(img, 27, y + 1, C["outline"])
    # 近脚：细腿 + 橙色脚掌，脚上一圈 lime 脚环（信鸽）
    rect(img, 21, y - 2, 1, 3, C["feet"])
    rect(img, 21, y - 2, 1, 1, C["lime"])
    rect(img, 20, y + 1, 3, 1, C["feet"])
    px(img, 20, y + 1, C["feet_dk"])
    px(img, 22, y + 1, C["feet_dk"])


def paint_ahoge(img, P):
    hx, hy, hry = P["hx"], P["hy"], P["hry"]
    top = int(round(hy - hry - 0.6))
    if top < 4:                      # 跳太高时呆毛不画，别顶到画布外
        return
    lean = -1 if P["st"] > 0 else 1
    for i, (ox, oy) in enumerate(((-0.4, 0.0), (0.2, -1.0), (lean, -2.0))):
        px(img, hx + ox, top + oy, C["head_hi"])
        if i < 2:
            px(img, hx + ox - 1, top + oy + 1, C["head"])


# ------------------------------------------------------------------ 脸（侧脸一只眼）
def face(img, style, hx, hy, beak_open, d=1):
    ex = int(round(hx - 0.8))
    ey = int(round(hy - 2.2))

    if style == "open":
        rect(img, ex, ey, 3, 3, C["eye"])          # 红眼
        px(img, ex + 1, ey + 1, C["eye_dk"])       # 瞳
        px(img, ex, ey, C["hi"])                   # 高光
    elif style == "half":
        rect(img, ex, ey + 1, 3, 2, C["eye"])
        px(img, ex + 1, ey + 2, C["eye_dk"])
        px(img, ex, ey + 1, C["hi"])
    elif style == "blink":
        rect(img, ex, ey + 2, 3, 1, C["eye_dk"])
        px(img, ex - 1, ey + 1, C["eye_dk"])
    elif style == "wide":
        rect(img, ex, ey - 1, 3, 4, C["eye"])
        rect(img, ex + 1, ey, 1, 2, C["eye_dk"])
        px(img, ex, ey - 1, C["hi"])
        px(img, ex - 1, ey - 2, C["eye_dk"])
        px(img, ex + 2, ey - 2, C["eye_dk"])
    elif style == "side":
        rect(img, ex, ey, 3, 3, C["eye"])
        px(img, ex + 1 + d, ey + 1, C["eye_dk"])
        px(img, ex + d, ey, C["hi"])
    elif style == "closed":
        rect(img, ex, ey + 2, 3, 1, C["eye_dk"])
        px(img, ex - 1, ey + 1, C["eye_dk"])
        px(img, ex + 3, ey + 1, C["eye_dk"])
    elif style == "happy":
        px(img, ex, ey + 2, C["eye_dk"])
        px(img, ex + 1, ey + 1, C["eye_dk"])
        px(img, ex + 2, ey + 2, C["eye_dk"])
    elif style == "sad":
        rect(img, ex, ey + 1, 3, 2, C["eye"])
        px(img, ex + 1, ey + 2, C["eye_dk"])
        px(img, ex, ey + 1, C["hi"])
        px(img, ex, ey - 1, C["eye_dk"])
        px(img, ex + 1, ey - 2, C["eye_dk"])
    elif style == "focus":
        cx, cyy = ex + 1.2, ey + 1.2
        ring = ell(cx, cyy, 3.6, 3.4) & ~ell(cx, cyy, 2.4, 2.2)
        put(img, ring, C["eye_dk"])
        rect(img, ex, ey + 1, 2, 2, C["eye"])
        px(img, ex, ey + 1, C["eye_dk"])
        px(img, ex + 3, ey - 2, C["hi"])
    elif style == "back":
        pass

    if style == "back":
        put(img, ell(hx - 1.4, hy + 0.8, 5.2, 5.0) & ~ell(hx - 3.2, hy + 0.4, 4.0, 4.2), C["head_sh"])
        for ox, oy, w, h in ((0.4, -3.4, 3, 1), (1.2, -1.6, 4, 1), (1.6, 0.6, 3, 1)):
            rect(img, int(hx + ox), int(hy + oy), w, h, C["head"])
        px(img, hx - 5.6, hy + 1.6, C["wing_dk"])
        return

    # 喙：参考图那种亮灰短喙 + 喙根一颗深色鼻孔，比黑喙更像鸽子
    bx = int(round(hx + 5.6))
    by = int(round(hy + 0.8))
    rect(img, bx - 1, by - 1, 2, 1, C["cere"])       # 鼻瘤
    px(img, bx - 1, by, C["beak_dk"])                # 鼻孔
    rect(img, bx, by, 3, 1, C["beak"])               # 上喙
    px(img, bx + 3, by, C["beak_dk"])                # 喙尖
    rect(img, bx, by + 1, 3, 1, C["beak_dk"])        # 下喙
    px(img, bx, by + 1, C["beak"])
    if beak_open >= 1:
        rect(img, bx + 1, by + 1, 3, 1, C["mouth"])
        px(img, bx + 3, by + 1, C["beak_dk"])
    if beak_open >= 3:
        rect(img, bx, by + 1, 3, 2, C["mouth"])
        rect(img, bx + 1, by + 2, 1, 1, C["tongue"])
        px(img, bx, by + 1, C["beak"])


# ------------------------------------------------------------------ 特效
def fx(img, state, f, hx, hy):
    """特效也按 12 主帧的节奏走：26 帧里 fi = f // 2，收尾帧沿用最后一格。"""
    fi = f // RESAMPLE if f < BASE * RESAMPLE else BASE - 1
    if state == "alert":
        bob = [0, -1, -1, -2, -2, -1, 0, -1, -1, 0, 0, 0][fi]
        ex, ey = int(round(hx - 8.0)), max(1, int(round(hy - 13.0 + bob)))
        rect(img, ex, ey, 3, 6, C["red"])
        rect(img, ex, ey + 8, 3, 3, C["red"])
    elif state == "sad":
        ty = int(hy + 4.0) + [0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 4, 2][fi]
        rect(img, int(hx + 5.0), ty, 2, 3, C["tear"])
    elif state == "sleepy":
        rise = [0, 0, -1, -1, -2, -2, -1, 0, 0, -1, -1, 0][fi]
        for zx, zy, big in [(36, 9 + rise, True), (41, 5 + rise, False)]:
            if big:
                rect(img, zx, zy, 5, 1, C["zzz"])
                px(img, zx + 3, zy + 2, C["zzz"])
                px(img, zx + 2, zy + 3, C["zzz"])
                px(img, zx + 1, zy + 4, C["zzz"])
                rect(img, zx, zy + 5, 5, 1, C["zzz"])
            else:
                rect(img, zx, zy, 3, 1, C["zzz"])
                px(img, zx + 2, zy + 2, C["zzz"])
                rect(img, zx, zy + 3, 3, 1, C["zzz"])
    elif state == "celebrate":
        pos = [(4, 6), (36, 8), (9, 13), (40, 17), (3, 22), (42, 26), (14, 4)]
        for i, (x, y) in enumerate(pos):
            if (fi + i) % 3 != 0:
                px(img, x + (fi % 3), y + ((fi + i) % 5), (C["amber"], C["lime"], C["red"])[i % 3])
                px(img, x + 1 + (fi % 3), y + ((fi + i) % 5), (C["amber"], C["lime"], C["red"])[i % 3])
    elif state == "happy" and fi % 2 == 0:
        for sx, sy in ((38, 15), (7, 18), (41, 25)):
            px(img, sx, sy, C["amber"])
    elif state == "wave" and fi % 2 == 0:
        px(img, 38, 7, C["amber"])
        px(img, 41, 4, C["lime"])
        px(img, 35, 4, C["amber"])
    elif state == "flap" and fi in (2, 3, 9):
        for sx, sy in ((3, 28), (44, 25), (4, 13)):
            px(img, sx, sy, C["amber"])
    elif state == "turn" and fi in (3, 4, 5):
        px(img, 41, 12, C["amber"])
        px(img, 43, 14, C["amber"])
    elif state == "wag" and fi in (2, 3, 6, 7):
        px(img, 3, 30, C["amber"])


# ------------------------------------------------------------------ 单帧
def draw_state(state, f):
    p = tables(state)
    img = np.zeros((S, S, 4), np.uint8)
    P = parts(p, f)
    d = p["dir"][f]
    lift = p["lift"][f]
    air = lift + max(0, -P["dy"])

    put(img, ell(23.0, 45.0, max(3.4, 10.4 - air * 0.9), max(1.0, 1.9 - air * 0.1)),
        (40, 55, 80, int(max(10, 34 - air * 4))))

    paint_tail(img, P, p["tail"][f])
    paint_far_wing(img, P, p["wing"][f], p["wing_up"][f])
    if p["wing"][f] >= 2:
        paint_wing(img, P, p["wing"][f], p["wing_up"][f])
    paint_body(img, P)
    paint_neck_sheen(img, P)
    if p["wing"][f] < 2:
        paint_wing(img, P, p["wing"][f], p["wing_up"][f])
    paint_ahoge(img, P)
    paint_feet(img, P, lift)
    face(img, p["eye"][f], P["hx"], P["hy"], p["beak"][f], d)
    fx(img, state, f, P["hx"], P["hy"])
    return img


# ------------------------------------------------------------------ 节拍
HOLDS = {
    "idle":      [3, 2, 2, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2],
    "alert":     [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    "happy":     [2, 2, 2, 3, 2, 3, 2, 3, 2, 2, 2, 2, 2, 2],
    "sad":       [3, 3, 3, 4, 4, 3, 3, 4, 3, 3, 3, 3, 2, 2],
    "sleepy":    [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    "celebrate": [2, 2, 2, 3, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2],
    "focus":     [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    "pat":       [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    "wave":      [2, 2, 2, 3, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2],
    "groom":     [2, 2, 3, 3, 3, 2, 3, 3, 2, 2, 2, 2, 2, 2],
    "stretch":   [2, 3, 3, 3, 4, 4, 3, 3, 2, 2, 2, 2, 2, 2],
    "look_l":    [2, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    "look_r":    [2, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    "flap":      [2, 2, 3, 3, 2, 2, 2, 2, 2, 3, 3, 2, 2, 2],
    "turn":      [2, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
    "wag":       [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
}

MEANING = {
    "idle": ("待机", True, False, False),
    "alert": ("临近截止", True, False, False),
    "happy": ("任务完成", False, False, True),
    "sad": ("刚逾期", False, False, True),
    "sleepy": ("久未互动 / 深夜", True, False, False),
    "celebrate": ("今日清三件", False, False, True),
    "focus": ("正在输入", True, False, False),
    "pat": ("被摸头", False, False, True),
    "wave": ("打招呼", False, False, True),
    "groom": ("理毛", False, True, True),
    "stretch": ("伸懒腰", False, True, True),
    "look_l": ("看左边", True, False, False),
    "look_r": ("看右边", True, False, False),
    "flap": ("扇翅膀", True, True, True),
    "turn": ("回头", False, True, True),
    "wag": ("摇尾巴", True, True, True),
}


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    demo = os.path.join(root, "demo")
    os.makedirs(demo, exist_ok=True)

    # 12 主帧的拍数 → 26 帧：每拍复制成两份（tick 减半，时长不变），收尾帧拍数×2
    expanded = {}
    for k, h in HOLDS.items():
        assert len(h) >= BASE, (k, len(h))
        expanded[k] = [x for t in h[:BASE] for x in (t, t)] + [h[BASE] * 2, h[BASE + 1] * 2]
        assert len(expanded[k]) == FRAMES, (k, len(expanded[k]))

    sheet = Image.new("RGBA", (S * FRAMES, S * len(STATES)), (0, 0, 0, 0))
    for r, st in enumerate(STATES):
        for f in range(FRAMES):
            sheet.paste(Image.fromarray(draw_state(st, f), "RGBA"), (f * S, r * S))
    sheet.save(os.path.join(demo, "pet-atlas48.png"))

    meta = {
        "name": "小鸽 · 不鸽的鸽子",
        "image": "pet-atlas48.png",
        "frame": {"w": S, "h": S},
        "tick": TICK,
        "resample": RESAMPLE,
        "settle": SETTLE,
        "order": STATES,
        "states": {},
    }
    for row, key in enumerate(STATES):
        label, looped, flourish, hold = MEANING[key]
        holds = expanded[key]
        dur = sum(holds) * TICK
        info = {
            "row": row, "frames": FRAMES, "tick": TICK,
            "holds": holds,
            "fps": round(1000.0 / (TICK * (sum(holds) / float(FRAMES))), 1),
            "loop": looped,
            "loopEnd": (FRAMES - SETTLE) if looped else FRAMES,
            "settle": SETTLE,
            "dur": dur,
            "meaning": label,
            "look": key.startswith("look_"),
        }
        if flourish:
            info["flourish"] = True
        if hold:
            info["hold"] = True
        if key == "look_l":
            info["mirror"] = True       # 整幅镜像 → 面朝左
        meta["states"][key] = info
    with open(os.path.join(demo, "pet-atlas48.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    scale = 4
    prev = Image.new("RGBA", (S * FRAMES * scale + 120, S * len(STATES) * scale), (250, 248, 242, 255))
    prev.alpha_composite(sheet.resize((S * FRAMES * scale, S * len(STATES) * scale), Image.NEAREST), (120, 0))
    d = ImageDraw.Draw(prev)
    for r, st in enumerate(STATES):
        d.text((8, r * S * scale + 8), st, fill=(40, 40, 40, 255))
        d.line([(120, r * S * scale), (prev.width, r * S * scale)], fill=(232, 228, 220, 255))
    prev.save(os.path.join(here, "preview-pigeon48.png"))
    print("ok", FRAMES, "frames x", len(STATES), "states @", S)


if __name__ == "__main__":
    main()

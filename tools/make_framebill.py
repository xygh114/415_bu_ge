# -*- coding: utf-8 -*-
"""从 pet-atlas48.json 生成《动作帧数表》，数字全部来自真实的 holds。"""
import io
import json
import os

ROOT = r"D:\dsh文件\deadline-pet"
meta = json.load(io.open(os.path.join(ROOT, "demo", "pet-atlas48.json"), encoding="utf-8"))
tick = meta["states"]["idle"]["tick"]
frames = meta["states"]["idle"]["frames"]
settle = meta.get("settle", 0)

LABEL = {
    "idle": "待机", "alert": "盯紧", "happy": "开心", "sad": "惦记", "sleepy": "犯困",
    "celebrate": "庆祝", "focus": "认真", "pat": "被摸", "wave": "打招呼",
    "groom": "理毛", "stretch": "伸懒腰", "look_l": "看左", "look_r": "看右",
    "flap": "扇翅膀", "turn": "回头", "wag": "摇尾巴",
}
KIND = {
    "idle": "环境", "alert": "环境（事件驱动）", "sleepy": "环境", "focus": "环境",
    "look_l": "环境（悬停·镜像）", "look_r": "环境（悬停）",
    "happy": "反应", "sad": "反应", "celebrate": "反应", "pat": "互动", "wave": "互动（每日首次）",
    "groom": "待机小动作", "stretch": "待机小动作", "flap": "待机小动作", "turn": "待机小动作", "wag": "待机小动作",
}

rows = []
for key, st in meta["states"].items():
    holds = st["holds"]
    total = sum(holds) * st.get("tick", tick)
    loop = st.get("loopEnd", st["frames"]) if st["loop"] else None
    rows.append((LABEL.get(key, key), key, KIND.get(key, ""), st["frames"],
                 ("前 %d 帧" % loop) if loop else "否",
                 "/".join(str(h) for h in holds), f"{total} ms", f"{total / 1000:.2f} s"))

head = (
    "# 小鸽 · 动作帧数表\n\n"
    f"> 由 `tools/make_framebill.py` 从 `demo/pet-atlas48.json` 自动生成，数字即运行时真实值。\n"
    f"> 规格：{meta['frame']['w']}×{meta['frame']['h']} 像素 / 每状态 {frames} 帧"
    f"（{frames - settle} 主帧 + {settle} 收尾帧）/ 一拍 {tick} ms（约 {round(1000 / tick)} tick/秒）。\n\n"
    "## 一、一拍为什么从 90ms 降到 45ms\n\n"
    "像素动画的「手感」几乎全由**帧时长**决定，而不是帧数。参考业界经验值：\n\n"
    "| 段落 | 常见区间 | 我们的取值 |\n|---|---|---|\n"
    "| 待机呼吸 | 120–180 ms/帧 | 90 ms 一帧（2 拍）+ 关键帧停 6–8 拍 |\n"
    "| 预备（anticipation） | 100–170 ms | 4–8 拍 ≈ 180–360 ms |\n"
    "| 主体动作 | 40–60 ms/帧（快打） | 4–6 拍 ≈ 180–270 ms |\n"
    "| 收尾 / 跟随 | 100–130 ms | 6–12 拍 ≈ 270–540 ms |\n\n"
    "我们把「一拍」固定成 45 ms，靠 **每帧停几拍** 来调节节奏——\n"
    "换帧率只需要改 `tick` 一个数，所有动作的相对轻重不会跑掉。\n\n"
    "**这一版把 12 主帧补间成 24 主帧**（每两帧之间插一个姿势中点），tick 从 90ms 降到 45ms，\n"
    "动作总时长没变，但画面更新率翻了一倍（约 4.3 → 8.5 张/秒）。\n\n"
    "## 二、逐条清单\n\n"
    "| 动作 | key | 类型 | 帧数 | 循环 | 每帧停留（拍） | 一轮时长 | 秒 |\n"
    "|---|---|---|---|---|---|---|---|\n"
)
body = "".join("| " + " | ".join(map(str, r)) + " |\n" for r in rows)

tail = """
## 三、收尾帧：每个动作怎么回到待机

| 帧 | 内容 | 谁在播 |
|---|---|---|
| f0–f23 | 动作主体（24 主帧 = 12 帧 × 2 补间） | 环境态循环播、反应态顺序播 |
| f24 | 收 40%：姿势往待机方向退一半 | 只有反应态播 |
| f25 | **和待机 f0 是同一张图** | 只有反应态播，播完停在这里 |

- 环境态：`loopEnd = 24`，永远不播 f24/f25；
- 反应态：`hold: true`，播满 26 帧，停在 f25（= 待机姿势），然后 `HOLD = sum(holds)×45 + 160ms` 到点回落；
- 换状态时画布做 130ms 交叉淡入，硬切不刺眼。

## 四、三段式：按住「摸摸」不尴尬

| 段 | 帧 | 作用 | 触发 |
|---|---|---|---|
| A 开始 | 0–5 | 被摸到的一抖 | 按下 220 ms 后进入 |
| B 循环 | 6–17 | 眯眼、蹭手，可以一直循环 | 按住期间 |
| C 收尾 | 18–25 | 回神、抬头、回到待机姿势 | 松手 |

判定逻辑在 `pet.js` 的 `frameAtHold()` / `frameAtRelease()`；
没有 `seg` 字段的动作照常整段播一次。

## 五、动作幅度（48px 网格上的像素位移）

| 动作 | 位移 | 说明 |
|---|---|---|
| 待机 | 上下 2 px + 压扁 1 px | 呼吸 + 鸽子式点头；第 10–11 帧眨眼 |
| 盯紧 | 左右 ±4 px + "!" 上下 1 px | 张望 |
| 开心 | 起跳 8 px，连续两下 | 落地压扁 2 px |
| 惦记 | 下沉 3 px + 泪滴下坠 | 收尾停得久，故意慢 |
| 庆祝 | 腾空 8 px + 撒星 | 滞空帧停 3–4 拍 |
| 犯困 | 摇摆 ±3 px + Zzz 上飘 | Zzz 每帧升 1 px |
| 扇翅膀 | 翅展 6 → 13.6 px | 内侧飞羽压黑，肩点不动 |
| 回头 | 头甩 -4 px + 后脑勺 4 帧 | 不镜像翻面，靠“背过身”读 |
| 摇尾巴 | 尾羽 ±4 px | 身体几乎不动，只有尾巴甩 |
| 伸懒腰 | 头抬 9 px + 脖子拉长 5 px | 翅膀同时展开 |

## 六、成长与动作的绑定

| 等级 | 解锁的待机小动作 |
|---|---|
| Lv.1 | 理毛 |
| Lv.2 | + 伸懒腰 |
| Lv.3 | + 摇尾巴 |
| Lv.4 | + 扇翅膀 |
| Lv.5 | + 回头 |

**多久做一次**由「干劲」决定：≥72 时四五秒来一次、动作偏大；
<22 时拖到七八秒、只做理毛和摇尾；此时也更容易打盹。
"""

p = os.path.join(ROOT, "动作帧数表.md")
io.open(p, "w", encoding="utf-8").write(head + body + tail)
print("ok", p, len(head + body + tail))

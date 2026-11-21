# -*- coding: utf-8 -*-
"""
把「小鸽」宠物打包成可以直接放进 buge/ 的补丁包。

输入:
  tools/pet.template.js      宠物模块模板（__ATLAS__ / __META__ 两个占位符）
  demo/pet-atlas-pigeon.png  9 状态 x 4 帧，32x32
  demo/pet-atlas48.json 动画元数据

输出:
  buge-patch/assets/pet.js   单文件模块（图集 base64 内联，零依赖）
  buge-patch/preview.html    独立预览页（不用仓库也能双击看效果）

运行: <python> tools/build_pet_module.py
"""
import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "buge-patch")

TITLE = "小鸽"
SUBTITLE = "DEADLINE PIGEON"


def load_meta():
    p = os.path.join(ROOT, "demo", "pet-atlas48.json")
    with open(p, "r", encoding="utf-8") as f:
        meta = json.load(f)
    return meta


def build_js():
    with open(os.path.join(HERE, "pet.template.js"), "r", encoding="utf-8") as f:
        tpl = f.read()
    with open(os.path.join(ROOT, "demo", "pet-atlas48.png"), "rb") as f:
        png = f.read()
    b64 = base64.b64encode(png).decode("ascii")
    meta = load_meta()

    # 三段式：pat 分成 A 开始(0-5) / B 循环(6-17) / C 收尾(18-25)（26 帧制）
    for _k, _v in {"pat": [6, 18]}.items():
        if _k in meta.get("states", {}):
            meta["states"][_k]["seg"] = _v
            meta["states"][_k]["segNote"] = "A/开始 · B/循环 · C/收尾"

    if "__META__" not in tpl or "__ATLAS__" not in tpl:
        raise SystemExit("模板里找不到 __META__ / __ATLAS__ 占位符")

    js = tpl.replace("__META__", json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    js = js.replace("__ATLAS__", "data:image/png;base64," + b64)
    return js, len(png), len(b64)


PREVIEW = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>小鸽 · 右栏预览</title>
<style>
  :root{
    --paper:#F4F1E9; --paper-2:#EDE9DE; --card:#fff; --rail-bg:#FAF8F2;
    --ink:#16191D; --ink-2:#2B3036; --muted:#6C7076; --muted-2:#9A9D9F;
    --line:#E5DFD1; --line-soft:#EFEAE0; --dark:#14171A; --lime:#D9F26B;
    --red:#BF452D; --amber:#B8761B; --green:#2A6B54; --blue:#33538C;
    --r-sm:8px; --r-md:12px; --r-lg:18px; --r-xl:26px;
    --num:"Bahnschrift","DIN Alternate","Segoe UI Variable",system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:var(--paper); color:var(--ink);
    font:14px/1.6 "PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; padding:28px 24px 60px;
  }
  .note{max-width:1040px;margin:0 auto 20px;color:var(--muted);font-size:12.5px}
  .note b{color:var(--ink-2)}
  .note code{background:#fff;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-family:var(--num);font-size:11.5px}
  .wrap{max-width:1040px;margin:0 auto;display:grid;grid-template-columns:1fr 352px;gap:26px;align-items:start}
  @media (max-width:860px){ .wrap{grid-template-columns:1fr} }

  /* —— 左边：假装是主区，用来核对配色是否打架 —— */
  .fake-main{background:var(--card);border:1px solid var(--line);border-radius:var(--r-xl);padding:22px 24px}
  .fake-main h1{font-size:20px;margin:0 0 4px;letter-spacing:-.2px}
  .fake-main p{color:var(--muted);font-size:12.5px;margin:0 0 18px}
  .fake-task{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line-soft);font-size:13px}
  .fake-task:first-of-type{border-top:0}
  .fake-task .tick{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line);flex:0 0 auto}
  .fake-task .meta{margin-left:auto;color:var(--muted-2);font-family:var(--num);font-size:11px;letter-spacing:.3px}
  .fake-task.hot .meta{color:var(--red)}

  /* —— 右边：真正的 .rail —— */
  .rail{display:flex;flex-direction:column;gap:18px;background:var(--rail-bg);
        border-radius:var(--r-xl);padding:18px 16px}
  .rail-card{display:flex;flex-direction:column;gap:9px}
  .rail-head{display:flex;align-items:center;justify-content:space-between}
  .rail-head h3{font-size:12px;font-weight:600;margin:0;color:var(--ink-2);display:flex;align-items:center;gap:6px}
  .pill{font-size:10px;letter-spacing:.4px;padding:2px 8px;border-radius:99px;background:var(--dark);color:#fff}
  .pill.subtle{background:#fff;color:var(--muted);border:1px solid var(--line)}
  .mini-btn{font:inherit;font-size:11px;padding:4px 10px;border-radius:99px;background:#fff;
            border:1px solid var(--line);color:var(--muted);cursor:pointer}
  .mini-btn:hover{color:var(--ink);border-color:var(--muted-2)}
  .row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2)}
  .row .k{margin-left:auto;font-family:var(--num);font-size:11.5px;color:var(--muted)}
  .bar{height:5px;border-radius:99px;background:var(--line-soft);overflow:hidden}
  .bar i{display:block;height:100%;background:var(--dark);border-radius:99px}
  .row.dim{color:var(--muted-2);font-size:11.5px}

  /* —— 演示开关 —— */
  .dock{max-width:1040px;margin:22px auto 0;display:flex;flex-wrap:wrap;gap:7px;align-items:center}
  .dock span{font-size:11.5px;color:var(--muted-2);margin-right:2px}
  .dock button{font:inherit;font-size:11.5px;padding:5px 11px;border-radius:99px;background:#fff;
               border:1px solid var(--line);color:var(--ink-2);cursor:pointer}
  .dock button:hover{border-color:var(--ink)}
</style>
</head>
<body>
<div class="note">
  <b>小鸽 · 右栏预览</b>　这是把 <code>assets/pet.js</code> 挂进 <code>.rail</code> 之后的样子（右栏 352px，站点配色）。
  左边是模拟主区，用来看「宠物卡片 + 页面」是否打架。下面的按钮只在这个预览页里存在：点一下就能看每个动作怎么收尾回到待机。
</div>

<div class="wrap">
  <main class="fake-main">
    <h1>这周还剩 3 件要交的</h1>
    <p>主区只是占位。宠物卡片在本页右栏最上方，和「今日作战计划」同列。</p>
    <div class="fake-task"><i class="tick"></i><span>数据库课程设计 · 中期报告</span><span class="meta">14:00 截止</span></div>
    <div class="fake-task hot"><i class="tick"></i><span>操作系统 · 实验四</span><span class="meta">还有 5 小时</span></div>
    <div class="fake-task"><i class="tick"></i><span>英语写作 · 第 6 单元</span><span class="meta">周五</span></div>
  </main>

  <aside class="rail">
    <section class="rail-card">
      <div class="rail-head"><h3>今日作战计划</h3><span class="pill">锁定 2 件</span></div>
      <div class="row"><span>可用时长</span><span class="k">4.5 h</span></div>
      <div class="bar"><i style="width:62%"></i></div>
      <div class="row dim"><span>预计 2.8 h · 留 1.7 h 缓冲</span></div>
    </section>
    <section class="rail-card">
      <div class="rail-head"><h3>提醒节点</h3></div>
      <div class="row"><span>提前 24 小时</span><span class="k">已就绪</span></div>
      <div class="row"><span>提前 6 小时</span><span class="k">已就绪</span></div>
    </section>
  </aside>
</div>

<div class="dock">
  <span>演示：</span>
  <button data-s="idle">待机</button>
  <button data-s="alert">盯紧</button>
  <button data-s="happy">开心</button>
  <button data-s="sad">惦记</button>
  <button data-s="celebrate">庆祝</button>
  <button data-s="sleepy">犯困</button>
  <button data-s="focus">认真</button>
  <button data-s="pat">被摸</button>
  <button data-s="wave">打招呼</button>
      <button data-s="groom">理毛</button>
    <button data-s="stretch">伸懒腰</button>
    <button data-s="look_l">看左</button>
    <button data-s="look_r">看右</button>
    <button data-s="flap">扇翅膀</button>
    <button data-s="turn">回头</button>
    <button data-s="wag">摇尾巴</button>
</div>

<script src="assets/pet.js"></script>
<script>
  /* 预览页专用的状态按钮：真正的站点里不需要这段 */
  document.querySelector('.dock').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-s]');
    if (!b || !window.BG_PET) return;
    window.BG_PET.force(b.dataset.s);
  });
</script>
</body>
</html>
"""


def main():
    js, png_len, b64_len = build_js()
    os.makedirs(os.path.join(OUT, "assets"), exist_ok=True)

    p = os.path.join(OUT, "assets", "pet.js")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    print("ok", p, f"{len(js)} chars, atlas {b64_len} b64")

    p = os.path.join(OUT, "preview.html")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(PREVIEW)
    print("ok", p)

    # 自检：占位符必须全部被替换
    for bad in ("__ATLAS__", "__META__", "undefined"):
        if bad in js and bad != "undefined":
            raise SystemExit("占位符没替换干净: " + bad)
    print("ok 占位符已全部替换")


if __name__ == "__main__":
    main()

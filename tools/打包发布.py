# -*- coding: utf-8 -*-
"""重新打包发布 zip，并解压到 _verify 复核"""
import os, sys, zipfile, shutil, subprocess

BASE = r"D:\dsh文件\不鸽"
SRC = r"D:\dsh文件\不鸽-Deadline-Radar-最终版-带小鸽"
ZIP = os.path.join(BASE, "不鸽-Deadline-Radar-最终版-带小鸽.zip")
VERIFY = os.path.join(BASE, "_verify")
ROOT_IN_ZIP = "不鸽-Deadline-Radar-最终版-带小鸽"
NODE = r"C:\Users\hcc\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if os.path.exists(ZIP):
    os.remove(ZIP)

count = 0
with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in ("_verify", "__pycache__", ".git")]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, SRC).replace("\\", "/")
            z.write(full, ROOT_IN_ZIP + "/" + rel)
            count += 1
print("zip: %s  条目 %d  字节 %d" % (os.path.basename(ZIP), count, os.path.getsize(ZIP)))

if os.path.exists(VERIFY):
    shutil.rmtree(VERIFY)
os.makedirs(VERIFY)
with zipfile.ZipFile(ZIP) as z:
    z.extractall(VERIFY)

site = os.path.join(VERIFY, ROOT_IN_ZIP, "buge")
ok = True
for name in ("parser", "plan", "profile", "pet", "hardening", "dom", "motion"):
    p = subprocess.run([NODE, os.path.join(site, "tests", name + ".test.js")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = [l for l in (p.stdout or "").splitlines() if ("结果" in l or "PASS" in l or "FAIL" in l)]
    line = tail[-1].strip() if tail else "(no output)"
    print("%-10s %s  exit=%d" % (name, line, p.returncode))
    if p.returncode != 0:
        ok = False
        print((p.stdout or "")[-800:])
        print((p.stderr or "")[-800:])
print("复核：" + ("全部通过" if ok else "有失败"))
sys.exit(0 if ok else 1)

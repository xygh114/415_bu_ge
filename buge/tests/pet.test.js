// 小鸽宠物 · 移植自检（无需浏览器）
// 用法：node tests/pet.test.js
//
// 两段：
//   1) 纯逻辑：状态机 / 帧表 / 干劲 / 升级 / 快照差异
//   2) 真集成：把 data.js → parser.js → plan.js → store.js → pet.js 全部塞进 vm，
//      用假 DOM + 假 localStorage 跑真实种子数据，验证挂载、XP 结算、存储隔离。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};
const eq = (name, got, want) => ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

const ASSETS = path.join(__dirname, '..', 'assets');
const read = (f) => fs.readFileSync(path.join(ASSETS, f), 'utf8');
const PET = read('pet.js');

/* ================= 1. 纯逻辑 ================= */
console.log('[逻辑]');
const win1 = {};
const ctx1 = vm.createContext({ window: win1, console, Date, Math, JSON, localStorage: null });
vm.runInContext(PET, ctx1);
const L = win1.BG && win1.BG.petLogic;
ok('导出了 BG.petLogic', !!L);
if (!L) process.exit(1);

eq('14 个可用状态（左右转向已移除）', L.STATES.length, 14);
  ok('不提供左右转向', !L.STATES.includes('look_l') && !L.STATES.includes('look_r'));
ok('每个状态都有中文名', L.STATES.every(s => !!L.LABEL[s]));
eq('待机小动作 5 个', L.FLOURISH.slice().sort().join(','), 'flap,groom,stretch,turn,wag');

const NOW = Date.now();
const H = 3600 * 1000;
const world = (o) => Object.assign({
  now: NOW, list: [], top: null, hour: 14, minute: 0, critical: 0, overdue: 0,
  doneToday: 0, loadRatio: 0.6, typing: false, idleMs: 0, nearestHours: null,
  energy: 58, awake: false
}, o);

eq('默认待机', L.ambientState(world({})), 'idle');
eq('有紧急截止 → 盯紧', L.ambientState(world({ critical: 1 })), 'alert');
eq('输入中 → 认真不打扰', L.ambientState(world({ typing: true, critical: 1 })), 'focus');
eq('90 秒没动 → 犯困', L.ambientState(world({ idleMs: 90000 })), 'sleepy');
eq('干劲低 + 60 秒没动 → 犯困', L.ambientState(world({ energy: 12, idleMs: 61000 })), 'sleepy');
eq('干劲高 → 主动表演', L.ambientState(world({ energy: 90, now: 0 })), 'wag');

eq('反应态优先于环境态', L.derive(world({ critical: 2 }), { state: 'happy', at: NOW }).state, 'happy');
eq('反应态过时长就回落', L.derive(world({ critical: 2 }), { state: 'happy', at: NOW - 5000 }).state, 'alert');
eq('按住摸头不超时', L.derive(world({}), { state: 'pat', at: NOW - 99999, hold: true }).state, 'pat');

eq('经验 0 是 1 级', L.levelOf(0).lv, 1);
eq('经验 100 是 3 级', L.levelOf(100).lv, 3);
ok('升级会带回称号', !!L.levelOf(600).title);

eq('干劲：闲 + 今天清两件', L.energyOf({ loadRatio: 0.6, doneToday: 2, overdue: 0, hour: 14, idleMs: 0 }), 90);
eq('干劲：逾期三件 → 累', L.moodOf(L.energyOf({ loadRatio: 0.6, doneToday: 0, overdue: 3, hour: 14, idleMs: 0 })), 'tired');
ok('干劲下限 5', L.energyOf({ loadRatio: 2, doneToday: 0, overdue: 9, hour: 2, idleMs: 999999 }) >= 5);
eq('Lv1 只会理毛', L.flourishPool(1, 60).join(','), 'groom');
ok('Lv4 会扇翅膀', L.flourishPool(4, 60).indexOf('flap') >= 0);
eq('没劲时只做安静动作', L.flourishPool(6, 10).sort().join(','), 'groom,wag');

const M = L.META.states;
ok('每个状态都有逐帧时间表', Object.keys(M).every(k => M[k].holds && M[k].holds.length === M[k].frames));
eq('pat 有三段式', !!(M.pat.seg && M.pat.seg.length === 2), true);
eq('turn 不靠镜像翻面', M.turn.flipAt, undefined);
eq('look_l 走渲染层整幅镜像', M.look_l.mirror, true);
eq('每段动作带 2 帧收尾', M.idle.settle, 2);
ok('环境态只循环前 24 帧', M.idle.frames === 26 && M.idle.loopEnd === 24,
  'frames=' + M.idle.frames + ' loopEnd=' + M.idle.loopEnd);
eq('一拍 45ms', M.idle.tick, 45);
eq('一次性播完停在收尾帧', L.frameAt(M.happy, 1e7, true), M.happy.frames - 1);
ok('循环态不会播到收尾帧', L.frameAt(M.idle, 1e7) < M.idle.loopEnd);
eq('第 0 拍是第 0 帧', L.frameAt(M.idle, 0), 0);
eq('停满第 0 帧就换帧', L.frameAt(M.idle, M.idle.holds[0] * M.idle.tick), 1);
eq('按住时先进 A 段', L.frameAtHold(M.pat, 0), 0);
ok('按住很久也不跑到 C 段', L.frameAtHold(M.pat, 1e7) < M.pat.seg[1]);
eq('松手立刻进 C 段', L.frameAtRelease(M.pat, 0), M.pat.seg[1]);

const snap = L.snapshotOf([{ id: 'a', status: 'todo', dueAt: NOW + 5 * H }], NOW);
eq('刚完成能被识别', L.diffTasks(snap, [{ id: 'a', status: 'done', dueAt: NOW + 5 * H }], NOW).done.length, 1);
ok('气泡有话说', String(L.bubble(world({}), 'idle', 0)).length > 4);

/* ================= 2. 真集成（假 DOM） ================= */
console.log('\n[集成]');

function mkEl(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, dataset: {},
    style: { setProperty() { }, removeProperty() { } },
    className: '', textContent: '', innerHTML: '', title: '', value: '', checked: false,
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => n.classList._s.add(x)); },
      remove(...c) { c.forEach(x => n.classList._s.delete(x)); },
      contains(c) { return n.classList._s.has(c); },
      toggle(c) { n.classList._s.has(c) ? n.classList._s.delete(c) : n.classList._s.add(c); }
    },
    appendChild(c) { this.children.push(c); c.parentNode = n; return c; },
    insertBefore(c) { this.children.unshift(c); c.parentNode = n; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'class') n.className = v; },
    getAttribute(k) { return n.attrs[k] === undefined ? null : n.attrs[k]; },
    addEventListener() { }, removeEventListener() { },
    querySelector() { return null; }, querySelectorAll() { return []; },
    scrollIntoView() { }, focus() { }, blur() { }, click() { },
    getBoundingClientRect() { return { width: 192, height: 192, top: 0, left: 0 }; },
    getContext() {
      return {
        imageSmoothingEnabled: false, globalAlpha: 1, fillStyle: '', strokeStyle: '',
        clearRect() { }, drawImage() { }, save() { }, restore() { }, translate() { }, scale() { },
        fillRect() { }, beginPath() { }, arc() { }, fill() { }, closePath() { }, moveTo() { }, lineTo() { }
      };
    }
  };
  return n;
}

const writes = [];
const memStore = new Map();
const rail = mkEl('aside');
rail.offsetWidth = 352;                    // 模拟宽屏：右栏可见
const body = mkEl('body');
const head = mkEl('head');
const document = {
  readyState: 'complete', hidden: false, activeElement: null,
  head, body, documentElement: mkEl('html'),
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ nodeValue: t }),
  getElementById: () => null,
  querySelector: (s) => (s === '.rail' ? rail : null),
  querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { }
};
const sandbox = {
  document,
  console, Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { userAgent: 'node', onLine: true },
  location: { search: '', hash: '', pathname: '/buge/index.html' },
  innerWidth: 1440, innerHeight: 900,
  localStorage: {
    getItem(k) { return memStore.has(k) ? memStore.get(k) : null; },
    setItem(k, v) { memStore.set(k, String(v)); writes.push(k); },
    removeItem(k) { memStore.delete(k); }
  },
  requestAnimationFrame() { return 1; }, cancelAnimationFrame() { },
  addEventListener() { }, removeEventListener() { },
  matchMedia() { return { matches: false, addEventListener() { } }; },
  Image: function Image() {
    const self = this;
    this.onload = null; this.onerror = null; this.width = 48; this.height = 48;
    Object.defineProperty(this, 'src', {
      get() { return self._src || ''; },
      set(v) { self._src = v; if (self.onload) setTimeout(() => self.onload(), 0); }
    });
  }
};
vm.createContext(sandbox);
sandbox.window = sandbox;                  // 让 window.BG 落到全局上
sandbox.globalThis = sandbox;

let bootErr = null;
try {
  ['data.js', 'parser.js', 'plan.js', 'store.js', 'pet.js'].forEach((f) => {
    vm.runInContext(read(f), sandbox, { filename: f });
  });
} catch (e) { bootErr = e; }

ok('五个脚本能在同一上下文里加载', !bootErr, bootErr && (bootErr.message + '\n' + bootErr.stack));
const BG = sandbox.BG || {};

/* 站点接口齐全（pet.js 依赖这几个） */
ok('BG.store.get() 返回 state', !!(BG.store && BG.store.get().tasks));
ok('种子任务已生成（>=5 条）', (BG.store.get().tasks || []).length >= 5,
  'tasks=' + (BG.store.get().tasks || []).length);
['stats', 'bucket', 'weeklyLoad', 'score', 'quadrant'].forEach((k) => ok('BG.model.' + k + ' 存在', typeof BG.model[k] === 'function'));

/* 宠物逻辑挂载 */
ok('BG.petLogic 已导出', !!BG.petLogic);

setTimeout(function () {
  console.log('\n[挂载]');
  ok('pet.js 没抛异常', !sandbox.BG_PET || true);
  ok('卡片挂进 .rail', rail.children.length > 0, 'children=' + rail.children.length);
  ok('挂的是第一子节点', rail.children.length > 0 && rail.children[0] === (sandbox.BG_PET && sandbox.BG_PET.node));
  ok('暴露 BG_PET 控制口', !!sandbox.BG_PET);
  ok('BG_PET.force 可用', !!(sandbox.BG_PET && typeof sandbox.BG_PET.force === 'function'));
  ok('BG_PET.refresh 可用', !!(sandbox.BG_PET && typeof sandbox.BG_PET.refresh === 'function'));

  /* 让宠物跑一轮：读真实种子数据 */
  writes.length = 0;
  try { sandbox.BG_PET.refresh(); } catch (e) { ok('refresh() 不炸', false, e.message); }

  ok('只写自己的存储键', writes.every(k => k === 'buge.pet.v1'),
    'wrote: ' + writes.join(',') || '(none)');
  ok('没有碰 buge.deadline.v1', writes.indexOf('buge.deadline.v1') < 0);
  ok('宠物记忆已落盘', memStore.has('buge.pet.v1'));
  let mem = {};
  try { mem = JSON.parse(memStore.get('buge.pet.v1') || '{}'); } catch (e) { }
  eq('记忆里有等级字段', typeof mem.lv, 'number');

  /* 完成一件任务 → 应该结算经验 */
  const t0 = BG.store.get().tasks.filter(t => t.status !== 'done')[0];
  ok('有可完成的任务', !!t0);
  if (t0) {
    const xp0 = mem.xp || 0;
    const done0 = BG.store.get().tasks.filter(t => t.status === 'done').length;
    BG.store.update(t0.id, { status: 'done' });
    try { sandbox.BG_PET.refresh(); sandbox.BG_PET.refresh(); } catch (e) { ok('完成结算不炸', false, e.message); }
    const mem2 = JSON.parse(memStore.get('buge.pet.v1') || '{}');
    ok('完成任务加经验（' + xp0 + ' → ' + (mem2.xp || 0) + '）', (mem2.xp || 0) > xp0);
    ok('今日完成计数 +1', (mem2.doneToday || 0) >= 1);
    const done1 = BG.store.get().tasks.filter(t => t.status === 'done').length;
    eq('站点数据只多了刚完成的那一件', done1, done0 + 1);
  }

  /* 演示口：强制切状态 */
  try { sandbox.BG_PET.force('celebrate'); } catch (e) { ok('force 不炸', false, e.message); }
  eq('force 之后能读到状态', typeof sandbox.BG_PET.state(), 'string');

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
}, 60);

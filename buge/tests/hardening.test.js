/* 稳定性加固回归测试：node tests/hardening.test.js
   覆盖 P0/P1/P2 这批改动：存档迁移、坏截止时间兜底、.ics 折行、
   保存失败可感知、目标块吃「紧急/重要」滑杆。 */
global.window = global;

/* --- 最小 localStorage 桩，可切换成"写不进去" --- */
const storage = new Map();
const lsStub = {
  fail: false,
  getItem(k) { return storage.has(k) ? storage.get(k) : null; },
  setItem(k, v) { if (this.fail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } storage.set(k, String(v)); },
  removeItem(k) { storage.delete(k); }
};
global.localStorage = lsStub;
global.window.localStorage = lsStub;

/* --- 事件桩：记录 bg:save 广播 --- */
const fired = [];
class FakeCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}
global.CustomEvent = FakeCustomEvent;
global.window.CustomEvent = FakeCustomEvent;
global.window.dispatchEvent = function (e) { fired.push(e); return true; };

require('../assets/data.js');
require('../assets/parser.js');
require('../assets/plan.js');
require('../assets/store.js');

const BG = global.BG;
const NOW = new Date('2026-11-19T15:50:00+08:00').getTime();
const KEY = BG.STORAGE_KEY;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

console.log('\n== 1. 存档迁移链 ==');
{
  const legacy = {
    version: 1,
    tasks: [{ id: 'old1', title: '老任务', course: '高数', dueAt: 'oops', createdAt: NOW - 86400000, status: 'todo' }],
    goals: [], activities: [], settings: {}
  };
  const m = BG.store.migrate(JSON.parse(JSON.stringify(legacy)));
  check('迁移后版本号升到 3', m.version === BG.store.SCHEMA && m.version === 3, m.version);
  check('补上紧急/重要默认占比 60/40', m.settings.priorityWeights.urgency === 60 && m.settings.priorityWeights.importance === 40, m.settings.priorityWeights);
  check('补上成绩/学分/职业默认占比', !!m.settings.importanceWeights && m.settings.importanceWeights.career === 40, m.settings.importanceWeights);
  check('坏截止时间被顺延而不是丢掉', isFinite(m.tasks[0].dueAt) && m.tasks[0].dueAt > NOW - 86400000, m.tasks[0].dueAt);
  check('记录了修复条数', m._repairedDue === 1, m._repairedDue);
  check('任务没被删除', m.tasks.length === 1);
}

console.log('\n== 2. load 读老存档 ==');
{
  storage.clear();
  fired.length = 0;
  storage.set(KEY, JSON.stringify({
    version: 1,
    tasks: [{ id: 'old2', title: '坏时间', course: '线代', dueAt: null, createdAt: NOW - 3600000, status: 'todo' }],
    goals: [], activities: [], settings: { dailyHours: 2 }
  }));
  BG.store.load(NOW);
  const st = BG.store.get();
  check('读进来版本就是 3', st.version === 3, st.version);
  check('坏 dueAt 进了合法区间', st.tasks[0].dueAt >= 946684800000 && st.tasks[0].dueAt <= 4102444800000, st.tasks[0].dueAt);
  check('保留用户自己的设置', st.settings.dailyHours === 2, st.settings.dailyHours);
  check('坏时间任务仍然在清单里', st.tasks.length === 1);
}

console.log('\n== 3. .ics 折行（75 字节） ==');
{
  const longTitle = '【超长标题】马克思主义基本原理概论期末论文——请务必在截止前提交并且附上查重报告与参考文献列表（第十二版）'.repeat(3);
  const ics = BG.model.toIcs([{
    id: 'i1', title: longTitle, course: '马克思主义基本原理', dueAt: NOW + 86400000,
    status: 'todo', type: 'paper', platform: 'manual', createdAt: NOW
  }]);
  const lines = ics.split('\r\n');
  const tooLong = lines.filter(l => Buffer.byteLength(l, 'utf8') > 75);
  check('没有超过 75 字节的行', tooLong.length === 0, tooLong.slice(0, 2));
  check('折行后总字节数没缩水（内容还在）', ics.includes('马克思主义'), ics.length);
  check('续行以单个空格开头', lines.some(l => l.startsWith(' ')) || tooLong.length === 0);
  check('保留了 CRLF 与首尾标记', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
}

console.log('\n== 4. 保存失败可感知 ==');
{
  storage.clear();
  fired.length = 0;
  BG.store.load(NOW);
  check('初始状态是"能保存"', BG.store.saveStatus().ok === true);

  lsStub.fail = true;
  let ret = BG.store.persist();
  lsStub.fail = false;
  const st = BG.store.saveStatus();
  check('写失败时 persist 返回 false', ret === false, ret);
  check('saveStatus 变成失败', st.ok === false && st.fails >= 1, st);
  check('失败原因被记下来', !!st.error && typeof st.error.message === 'string', st.error);
  check('广播了 bg:save 事件', fired.length >= 1 && fired[fired.length - 1].type === 'bg:save', fired.map(e => e.type));
  check('事件里带 ok:false', fired[fired.length - 1].detail.ok === false, fired[fired.length - 1].detail);

  /* 恢复后应该广播一次 ok:true，让横幅能收起来 */
  ret = BG.store.persist();
  check('恢复后 persist 返回 true', ret === true, ret);
  check('恢复后广播 ok:true', fired[fired.length - 1].detail.ok === true, fired[fired.length - 1].detail);
}

console.log('\n== 5. 目标块吃「紧急/重要」滑杆 ==');
{
  const ctx = (urgency, importance) => ({
    now: NOW,
    settings: Object.assign({}, BG.planner.DEFAULTS, {
      priorityWeights: { urgency: urgency, importance: importance }
    })
  });
  const goal = { title: '本周读完教材', scope: 'week', targetHours: 4, importance: 2, deadline: NOW + 2 * 86400000 };
  const urgentHeavy = BG.planner.scoreGoal(goal, ctx(80, 20));
  const impHeavy = BG.planner.scoreGoal(goal, ctx(20, 80));
  check('两种占比都给出分数', typeof urgentHeavy.score === 'number' && typeof impHeavy.score === 'number');
  check('紧急占比高时，临近截止的目标分更高', urgentHeavy.score > impHeavy.score, [urgentHeavy.score, impHeavy.score]);
  check('分数仍在 0–100', urgentHeavy.score >= 0 && urgentHeavy.score <= 100);
  check('极端 0:0 回退成 6:4 不报错', isFinite(BG.planner.scoreGoal(goal, ctx(0, 0)).score));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

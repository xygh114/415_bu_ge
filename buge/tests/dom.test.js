/* DOM 契约测试：node tests/dom.test.js
   目的：ui.js 只通过 id 找节点，改 HTML 时最容易悄悄失联。
   这里静态比对「ui.js 里 $('#x') 用到的 id」与「index.html 里真正存在的 id」。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'assets', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'styles.css'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* index.html 里声明的 id */
const htmlIds = new Set();
html.replace(/\bid="([^"]+)"/g, (m, id) => { htmlIds.add(id); return m; });

/* 弹层/表单是 ui.js 自己拼字符串插进去的，这些 id 也算"存在" */
const uiIds = new Set();
ui.replace(/\bid="([^"]+)"/g, (m, id) => { uiIds.add(id); return m; });

/* ui.js 里用 $('#x') / $$('#x, #y') 取过的 id */
const used = new Set();
ui.replace(/\$\$?\(\s*'([^']+)'\s*\)/g, (m, sel) => {
  sel.split(',').forEach(part => {
    const s = part.trim();
    if (s.startsWith('#')) used.add(s.slice(1).split(/[\s.\[:]/)[0]);
  });
  return m;
});

/* 运行时才创建、不该在 HTML 里出现的 id */
const RUNTIME = new Set(['saveWarn']);
const missing = [...used].filter(id => id && !htmlIds.has(id) && !uiIds.has(id) && !RUNTIME.has(id));

console.log('\n== 1. ui.js 引用的 id 都在 index.html 里 ==');
check('没有找不到的 id', missing.length === 0, missing);
check('引用的 id 数量合理', used.size > 20, used.size);

console.log('\n== 2. 两个清单容器都在 ==');
['taskList', 'taskList2', 'filters', 'filters2', 'sortSel', 'sortSel2'].forEach(id => {
  check('#' + id + ' 存在', htmlIds.has(id));
});

console.log('\n== 3. 只渲染当前视图那一份（不再双写） ==');
check('有 listMount / filtersMount', /function\s+listMount/.test(ui) && /function\s+filtersMount/.test(ui));
check('renderList 不再往两个容器写', !/el1\.innerHTML|el2\.innerHTML/.test(ui));
check("renderFilters 不再双写", !/\$\('#filters2'\)\.innerHTML\s*=\s*html/.test(ui));

console.log('\n== 4. 新增能力都在位 ==');
check('保存失败横幅函数存在', /function\s+showSaveBanner/.test(ui));
check('样式里有 .save-warn', css.includes('.save-warn'));
check('监听了 bg:save 事件', /addEventListener\('bg:save'/.test(ui));
check('自习室监听 visibilitychange', /addEventListener\('visibilitychange'/.test(ui));
check('中断函数存在', /function\s+interruptStudy/.test(ui));
check('提醒轮询 60 秒', /REMIND_POLL\s*=\s*60000/.test(ui));
check('提醒窗口 5 分钟', /REMIND_WINDOW\s*=\s*5\s*\*\s*60000/.test(ui));
check('提醒去重落盘', /notifyFired/.test(ui));
check('局部渲染函数存在', /function\s+renderQuick/.test(ui));
check('勾选完成走局部渲染', /S\.update\(id,\s*\{\s*status:[^}]*\}\);\s*\n\s*renderQuick\(\);/.test(ui));
check('?state=empty 先确认', /state === 'empty'[\s\S]{0,120}confirmDialog/.test(ui));

console.log('\n== 5. 文案不再承诺"固定 45 分钟预留" ==');
check('ui.js 没有"每天固定 45 分钟"', !/每天固定\s*45\s*分钟/.test(ui));
check('index.html 没有"每天固定 45 分钟"', !/每天固定\s*45\s*分钟/.test(html));
check('index.html 说清了是上限', /总量上限|每天最多/.test(html));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

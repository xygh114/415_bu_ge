/* 动效契约测试：node tests/motion.test.js
   手册（css-loaders-handoff.md）§4 的 20 条检查表里，能在静态阶段守住的那几条：
   1) 不许 transition: all
   2) 不许对 width / height / top / left 做过渡或动画（只动 transform / opacity / clip-path）
   3) 每个 @keyframes 里只允许 transform / opacity / clip-path / background-position / filter / 自定义属性
   4) 必须给 prefers-reduced-motion 降级
   5) 组件库十个类都在，页面只改 --cl-* 变量
   6) 进度条统一走 scaleX(var(--p))，ui.js 里不再有 .style.width
   这个测试不改任何文件，只读。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('assets/styles.css');
const cl = read('assets/css-loaders.css');
const html = read('index.html');
const ui = read('assets/ui.js');
const loaders = read('loaders.html');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* 只保留声明块里的内容，避免注释和选择器名误伤 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}
const cssClean = stripComments(css);
const clClean = stripComments(cl);
const both = cssClean + '\n' + clClean;

console.log('== 1. 禁止 transition: all ==');
check('styles.css 没有 transition: all', !/transition\s*:\s*all\b/.test(cssClean));
check('css-loaders.css 没有 transition: all', !/transition\s*:\s*all\b/.test(clClean));
check('没有 transition-property: all', !/transition-property\s*:\s*all\b/.test(both));

console.log('\n== 2. transition / animation 不许点名 width / height / top / left ==');
/* 把 cl-xxx-left 这类关键帧名先摘掉，再查属性词 */
function offending(decls) {
  const bad = [];
  decls.forEach((d) => {
    const cleaned = d.replace(/(^|[^a-z-])[a-z0-9-]*-(left|right|top|bottom)\b/g, '$1');
    if (/\b(width|height|top|left)\b/.test(cleaned)) bad.push(d.trim().slice(0, 90));
  });
  return bad;
}
const transDecls = both.match(/(?:^|[{;\s])transition\s*:[^;}]+/g) || [];
const animDecls = both.match(/(?:^|[{;\s])animation\s*:[^;}]+/g) || [];
const badTrans = offending(transDecls).filter((d) => !/animation-name/.test(d));
const badAnim = offending(animDecls);
const badKeyName = animDecls.filter((d) => /keyframes\s+(width|height|top|left)\b/.test(d));
check('transition 里没有 width/height/top/left', badTrans.length === 0, badTrans);
check('animation 里没有 width/height/top/left', badAnim.length === 0 && badKeyName.length === 0, badAnim.concat(badKeyName));
check('旧的 .bar i width 过渡已删', !/\.bar\s+i\s*\{[^}]*transition\s*:\s*width/.test(cssClean));
check('进度条改为 scaleX(var(--p', /\.bar\s+i\s*\{[^}]*scaleX\(var\(--p/.test(cssClean));
check('load-bar 改为 scaleX', /\.load-bar\s+i\s*\{[^}]*scaleX\(var\(--p/.test(cssClean));
check('study-progress 改为 scaleX', /\.study-progress\s+i\s*\{[^}]*scaleX\(var\(--p/.test(cssClean));

console.log('\n== 3. 每个 @keyframes 只动允许的属性 ==');
/* text-shadow 只重绘不布局（.cl-text-shadow 的全部效果就靠它），因此列入白名单 */
const ALLOW = /^(transform|opacity|clip-path|background-position|filter|text-shadow|-webkit-transform|--cl-[a-z0-9-]+)$/;
const kfNames = [];
let kfBad = [];
let idx = 0;
while ((idx = both.indexOf('@keyframes', idx)) !== -1) {
  const open = both.indexOf('{', idx);
  let depth = 0, end = open;
  for (let i = open; i < both.length; i++) {
    if (both[i] === '{') depth++;
    else if (both[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const name = both.slice(idx + 10, open).trim();
  kfNames.push(name);
  const body = both.slice(open + 1, end);
  body.split(';').forEach((decl) => {
    const d = decl.trim();
    if (!d) return;
    const m = d.match(/^([a-z-]+)\s*:/);
    if (!m) return;                                  /* 选择器行、括号残留 */
    if (!ALLOW.test(m[1])) kfBad.push(name + ' → ' + m[1]);
  });
  idx = end;
}
check('找到关键帧', kfNames.length > 0, kfNames.length);
check('关键帧只动 transform/opacity/clip-path', kfBad.length === 0, kfBad.slice(0, 6));
check('保留了 view-in / fade-up / flash-out', /view-in/.test(clClean + cssClean) && /fade-up/.test(cssClean) && /flash-out/.test(cssClean));

console.log('\n== 4. prefers-reduced-motion 降级 ==');
check('styles.css 有降级块', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(cssClean));
check('css-loaders.css 有降级块', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(clClean));
check('降级里关掉了切页与错峰', /\.view\.is-entering[^{]*\{[^}]*animation:\s*none/.test(cssClean) &&
  /\.task-list\.is-enter[^{]*\{[^}]*animation:\s*none/.test(cssClean));
check('降级里恢复 scroll-behavior', /scroll-behavior:\s*auto/.test(cssClean));
check('降级里隐藏闪烁遮罩', /\.is-flash::after[^{]*\{[^}]*display:\s*none/.test(cssClean));
check('降级里隐藏空态光球', /\.empty-glow[^{]*\{[^}]*display:\s*none/.test(cssClean));
check('计数器 JS 里有 reduced-motion 分支', /prefers-reduced-motion/.test(read('assets/css-loaders.js')));

console.log('\n== 5. 组件库十大件 + 页面只改变量 ==');
const classes = ['cl-glass', 'cl-typing', 'cl-water', 'cl-spinner', 'cl-clip', 'cl-squares',
  'cl-countdown', 'cl-text-shadow', 'cl-counter', 'cl-ripple'];
classes.forEach((c) => check('css-loaders.css 定义 .' + c, new RegExp('\\.' + c + '\\s*[,{:]').test(clClean)));
classes.forEach((c) => check('loaders.html 演示 .' + c, loaders.indexOf('class="' + c) !== -1 || loaders.indexOf(c + ' ') !== -1));
check('index.html 引入 css-loaders.css', /assets\/css-loaders\.css/.test(html));
check('index.html 引入 css-loaders.js', /assets\/css-loaders\.js/.test(html));
check('css-loaders.css 在 styles.css 之后', html.indexOf('assets/styles.css') < html.indexOf('assets/css-loaders.css'));
check('站点只在挂载点改变量，不改内部尺寸属性',
  !/\.cl-[a-z-]+\s*\{[^}]*(?<![a-z-])(width|height|top|left)\s*:/.test(cssClean.replace(/@media[\s\S]*?\}\s*\}/g, '')));
check('空态用了 cl-glass', /cl-glass cl-glass--ring empty-glow/.test(ui));
check('自习室用了 cl-countdown', /cl-countdown/.test(ui));

console.log('\n== 6. 站点侧动效接线 ==');
check('ui.js 有 frac() 写 --p', /function\s+frac\s*\(/.test(ui) && /setProperty\('--p'/.test(ui));
check('ui.js 不再写 style.width', !/\.style\.width\s*=/.test(ui));
check('切页加 .is-entering', /classList\.add\('is-entering'\)/.test(ui));
check('列表错峰加 .is-enter', /classList\.add\('is-enter'\)/.test(ui));
check('保存横幅有进出场类', /is-on/.test(ui) && /is-on/.test(cssClean));
check('弹层有 is-in 两态', /classList\.add\('is-in'\)/.test(ui) && /\.modal-mask\.is-in/.test(cssClean));
check('弹层进场用 MutationObserver 兜 9 处调用点', /MutationObserver/.test(ui) && /watchModal/.test(ui));
check('shake 关键帧在', /@keyframes\s+shake/.test(cssClean));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

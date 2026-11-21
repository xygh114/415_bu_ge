/* ============================================================
   不鸽 · Deadline Radar —— 陪伴宠物「小鸽」
   单文件、零依赖、不改动现有任何模块。

   挂载：自动在最右栏顶部插入一张「小鸽」卡片（移动端自动改为左下角悬浮）。
   数据：只读 window.BG.store / BG.model，不写入 buge.deadline.v1；
        自己的少量状态存在 buge.pet.v1。
   事件：轮询快照（1s 一次）比对任务状态，检测「刚完成 / 刚逾期」，
        不监听全局 click，不抢焦点，不发声。
   ============================================================ */
(function (win) {
  'use strict';

  var ATLAS = '__ATLAS__';
  var META = __META__;
  var VERSION = '__VERSION__';

  /* ================= 1. 纯逻辑（可在 Node 里单测） ================= */

  var STATES = ['idle', 'alert', 'happy', 'sad', 'sleepy', 'celebrate', 'focus', 'pat', 'wave',
    'groom', 'stretch', 'look_l', 'look_r', 'flap', 'turn', 'wag'];

  var LABEL = {
    idle: '待机', alert: '盯紧', happy: '开心', sad: '惦记',
    celebrate: '庆祝', sleepy: '犯困', focus: '认真', groom: '理毛', stretch: '伸懒腰', look_l: '看左边', look_r: '看右边',
    pat: '被摸', wave: '打招呼', flap: '扇翅膀', turn: '掉头', wag: '摇尾巴'
  };

  /* 反应动画结束后回到环境态；时长直接按图集里真实帧数算：
     动作播完（含最后那两帧收尾）再停 0.16s，回落时正好接上待机姿势 */
  var HOLD = {};
  (function () {
    var k, m, i, n, ticks;
    for (k in META.states) {
      m = META.states[k];
      if (!m.hold || !m.holds) continue;
      n = m.loop ? (m.loopEnd || m.frames) : m.frames;
      ticks = 0;
      for (i = 0; i < n; i++) ticks += m.holds[i];
      HOLD[k] = ticks * (m.tick || 90) + 160;
    }
  })();
  var FLOURISH = Object.keys(META.states).filter(function (k) { return META.states[k].flourish; });

  var FLOURISH_GAP = 9000;     // 两个小动作之间歇 9 秒（用户要求：间隔再久一点，看得清）
  var IDLE_AFTER = 90000;      // 90s 无操作 → 犯困
  var NIGHT_IDLE = 45000;     // 深夜只要 45s 没动就困（不然一开页面就睡，看不到别的动作）
  var BUBBLE_GAP = 9000;       // 气泡最短间隔

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function yesterdayKey(ts) {
    return dayKey(ts - 86400000);
  }

  function blankMemory() {
    return {
      day: '', doneToday: 0, streak: 0, lastDoneDay: '', pats: 0,
      xp: 0, lv: 1, patsToday: 0, seenDay: '', badges: {}
    };
  }

  /* ---------------- 成长：经验 / 等级 / 徽章 ---------------- */

  var LEVELS = [
    { xp: 0,   t: '刚破壳' },
    { xp: 40,  t: '会走路的崽' },
    { xp: 100, t: '认路的鸽子' },
    { xp: 200, t: '准时报到' },
    { xp: 360, t: '信使' },
    { xp: 600, t: '鸽子队长' }
  ];

  var XP = { DONE: 12, ON_TIME: 6, CLEANED: 4, PAT: 1, PAT_CAP: 5, STREAK: 5,
    RECOVER: 10, PLAN: 8 };

  /* 每级解锁哪些小动作：让成长看得见，也顺手控制动作丰富度 */
  var UNLOCK = {
    1: ['groom'],
    2: ['groom', 'stretch'],
    3: ['groom', 'stretch', 'wag'],
    4: ['groom', 'stretch', 'wag', 'flap'],
    5: ['groom', 'stretch', 'wag', 'flap', 'turn'],
    6: ['groom', 'stretch', 'wag', 'flap', 'turn']
  };

  /* 由经验算等级；progress 是当前级内进度 0..1 */
  function levelOf(xp) {
    var lv = 1, i;
    for (i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) lv = i + 1;
    var cur = LEVELS[lv - 1] || LEVELS[0];
    var next = LEVELS[lv];
    var span = next ? (next.xp - cur.xp) : 0;
    return {
      lv: Math.min(lv, LEVELS.length),
      title: cur.t,
      xp: xp,
      next: next ? next.xp : null,
      toNext: next ? next.xp - xp : 0,
      progress: next ? Math.max(0, Math.min(1, (xp - cur.xp) / span)) : 1
    };
  }

  /* 加经验，返回 {lv, up, xp} —— 纯函数，只改传入的 mem */
  function addXp(mem, n) {
    var before = levelOf(mem.xp || 0).lv;
    mem.xp = Math.max(0, (mem.xp || 0) + n);
    var after = levelOf(mem.xp);
    mem.lv = after.lv;
    return { lv: after.lv, up: after.lv > before, xp: mem.xp };
  }

  var BADGES = [
    { id: 'first', g: '1', name: '第一件', hint: '收掉第一件' },
    { id: 'three', g: '3', name: '一天三件', hint: '单日清三件' },
    { id: 'week',  g: '7', name: '连续七天', hint: '连续 7 天有进度' },
    { id: 'clear', g: '空', name: '清空一次', hint: '把清单清到 0' }
  ];

  /* 解锁徽章，返回 true 表示这次新解锁 */
  function award(mem, id) {
    if (!mem.badges) mem.badges = {};
    if (mem.badges[id]) return false;
    mem.badges[id] = Date.now();
    return true;
  }

  /* 每天零点重置今日计数 */
  function rollDay(mem, now) {
    var k = dayKey(now);
    if (mem.day !== k) {
      mem.day = k;
      mem.doneToday = 0;
    }
    return mem;
  }

  /* 记一次完成，返回 {celebrate:bool} */
  function recordDone(mem, now) {
    rollDay(mem, now);
    mem.doneToday += 1;
    if (mem.lastDoneDay !== mem.day) {
      mem.streak = (mem.lastDoneDay === yesterdayKey(now)) ? (mem.streak || 0) + 1 : 1;
      mem.lastDoneDay = mem.day;
    }
    return { celebrate: mem.doneToday === 3 };
  }

  /**
   * 干劲 0–100：把学习数据折成一个数，宠物的一切表现都看它。
   *   周负荷轻 + 有完成 → 高；逾期多 + 深夜 → 低。
   */
  function energyOf(world) {
    var e = 58;
    if (world.loadRatio != null) {
      if (world.loadRatio <= 0.8) e += 16;
      else if (world.loadRatio <= 1.0) e += 8;
      else if (world.loadRatio > 1.4) e -= 16;
      else e -= 6;
    }
    e -= Math.min(34, (world.overdue || 0) * 13);
    e += Math.min(24, (world.doneToday || 0) * 8);
    if (world.hour >= 23 || world.hour < 7) e -= 20;
    else if (world.hour >= 22) e -= 8;
    if (world.idleMs >= IDLE_AFTER) e -= 12;
    return Math.max(5, Math.min(100, Math.round(e)));
  }

  /* 干劲档位：决定动作池、频率、会不会犯困 */
  function moodOf(energy) {
    if (energy >= 72) return 'lively';
    if (energy >= 42) return 'normal';
    if (energy >= 22) return 'tired';
    return 'down';
  }

  /* 当前等级能做的动作里，按干劲挑一池 */
  function flourishPool(lv, energy) {
    var unlocked = UNLOCK[Math.min(lv, 6)] || UNLOCK[1];
    var pool = FLOURISH.filter(function (k) { return unlocked.indexOf(k) >= 0; });
    if (!pool.length) pool = ['groom'];
    if (energy >= 72) {
      var hot = pool.filter(function (k) { return k === 'flap' || k === 'stretch' || k === 'wag'; });
      if (hot.length) return hot;
    } else if (energy < 22) {
      var calm = pool.filter(function (k) { return k === 'groom' || k === 'wag'; });
      if (calm.length) return calm;
    }
    return pool;
  }

  /**
   * 环境态判定（优先级从高到低）。
   * world: { now, critical, overdue, open, doneToday, streak, typing, idleMs, hour }
   */
  function ambientState(world) {
    if (world.typing) return 'focus';                      // 正在输入 / 打开弹层：不打扰
    if (world.critical > 0) return 'alert';                // 24h 内有截止
    var e = world.energy != null ? world.energy : 58;
    if (!world.awake) {
      /* 没劲的时候更容易困：干劲低，60 秒没动就开始打盹 */
      if (world.idleMs >= IDLE_AFTER) return 'sleepy';
      if (e < 30 && world.idleMs >= 60000) return 'sleepy';
      if ((world.hour >= 23 || world.hour < 7) && world.idleMs >= NIGHT_IDLE) return 'sleepy';
    }
    /* 干劲很足且没截止压着：主动摇尾巴 / 扇翅膀，别像个贴纸 */
    if (e >= 76 && world.critical === 0 && !world.typing) return energyAmbient(world);
    return 'idle';
  }

  /* 高干劲时的待机：在 wag / flap / idle 之间换，看起来是活的 */
  function energyAmbient(world) {
    var slot = Math.floor((world.now || 0) / 9000) % 3;
    if (slot === 0) return 'wag';
    if (slot === 1) return 'flap';
    return 'idle';
  }

  /**
   * 完整状态：反应 > 环境。
   * reaction: {state, at} | null
   */
  function derive(world, reaction) {
    var t = world.now;
    if (reaction && reaction.hold) return { state: reaction.state, kind: 'reaction' };
    if (reaction && HOLD[reaction.state] && t - reaction.at < HOLD[reaction.state]) {
      return { state: reaction.state, kind: 'reaction' };
    }
    return { state: ambientState(world), kind: 'ambient' };
  }

  /* 气泡文案：同一状态内轮换，尽量贴当前数据 */
  function bubble(world, state, seed) {
    var n = world.critical || 0;
    var od = world.overdue || 0;
    var pool;
    switch (state) {
      case 'alert':
        var uh = world.nearestHours != null ? '还有 ' + U_hours(world) : '';
        pool = n >= 2
          ? ['有 ' + n + ' 件 24 小时内到期，挑一件现在能开始的就行。',
             '最紧的那件' + (uh ? uh + '到点' : '就在今天') + '，先做最小的那一步，不用一次做完。']
          : ['有一件' + (uh ? uh + '到点' : '24 小时内到点') + '，来得及，先动手。',
             '现在开始做，就不用熬夜了。'];
        break;
      case 'pat':
        pool = ['诶——被摸到了。',
                '再摸一下我就把这件盯得更紧。',
                '收到摸头，心情 +1。'];
        break;
      case 'wave':
        pool = world.top
          ? ['来啦。今天最该动的是「' + world.top.short + '」，先做 15 分钟就行。',
             '早。清单我先看过了，「' + world.top.short + '」排在最前面。']
          : ['来啦。今天清单是空的，随便安排。',
             '早。今天没有到期的东西，可以往前赶一点。'];
        break;
      case 'happy':
        pool = ['这件收掉了，剩下的看着没那么吓人。',
                '进度往前挪了一格，我记下来了。'];
        break;
      case 'celebrate':
        pool = ['今天清掉三件了，这个节奏值得记一下。',
                (world.streak || 0) > 1 ? '连续 ' + world.streak + ' 天有进度，很稳。' : '今天清掉三件了，很稳。'];
        break;
      case 'sad':
        pool = ['有件东西过期了。不是你的错，先决定顺延、拆小，还是放下。',
                '逾期不等于失败，给它换个时间就好。'];
        break;
      case 'sleepy':
        pool = ['夜深了。明天 8:30 这里会接着排计划。',
                '先睡吧，雷达替你盯到早上。'];
        break;
      case 'focus':
        pool = ['你先忙，我不打扰。', '在输入呢，我安静看着。'];
        break;
      default:
        if (world.hour >= 23 || world.hour < 6) {
          pool = od > 0
            ? ['夜深了。过了期的先别管，明天再改时间。',
               '这个点了，明天再处理也不迟，它跑不掉。']
            : ['夜深了。今天到这儿也行。',
               '这个点了，收工比多做一件划算。'];
          break;
        }
        pool = od > 0
          ? ['清单上还有 ' + od + ' 件已经过期，可以顺手给它改个时间。',
             '还有 ' + (world.open || 0) + ' 件待办，排序已经做好了。']
          : (world.open
              ? ['今天该先做的那件，就在上面第一张卡片。',
                 '还有 ' + world.open + ' 件在前面排着，一件一件来。']
              : ['清单是空的。这个晚上归你。']);
    }
    return pool[seed % pool.length];
  }

  function U_hours(world) {
    return world.nearestHours != null ? Math.max(1, Math.round(world.nearestHours)) + ' 小时' : '不久';
  }

  /* 快照差异：找出刚刚完成 / 刚刚逾期的任务 */
  function diffTasks(prev, list, now) {
    var out = { done: [], overdue: [], reshaped: false };
    if (!prev) {
      out.reshaped = true;
      return out;
    }
    var seen = 0;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var p = prev[t.id];
      if (!p) continue;                        // 新加的任务不算"变化"
      seen++;
      if (p.status !== 'done' && t.status === 'done') out.done.push(t);
      if (!p.overdue && isOverdue(t, now)) out.overdue.push(t);
    }
    if (seen === 0) out.reshaped = true;      // 一条都对不上（清空 / 恢复示例 / 换账号）
    return out;
  }

  function isOverdue(t, now) {
    return t.status !== 'done' && t.dueAt < now;
  }

  function snapshotOf(list, now) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
      map[list[i].id] = { status: list[i].status, overdue: isOverdue(list[i], now) };
    }
    return map;
  }

  /* ================= 2. 样式（注入一次） ================= */

  var CSS = [
    '.bp-card{display:flex;flex-direction:column;gap:10px;animation:bp-in .5s cubic-bezier(.2,.7,.3,1) both}',
    '@keyframes bp-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '.bp-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.bp-name{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;letter-spacing:.2px;color:var(--ink-2)}',
    '.bp-live{width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 0 rgba(217,242,107,.75);animation:bp-live 2.4s ease-out infinite}',
    '@keyframes bp-live{0%{box-shadow:0 0 0 0 rgba(217,242,107,.7)}70%{box-shadow:0 0 0 7px rgba(217,242,107,0)}100%{box-shadow:0 0 0 0 rgba(217,242,107,0)}}',
    '.bp-name .bp-sub{font-family:var(--num);font-size:9px;letter-spacing:1.4px;color:var(--muted-2);font-weight:400}',
    '.bp-stage{position:relative;display:grid;place-items:center;height:200px;border-radius:16px;',
    'border:1px solid var(--line-soft);background:radial-gradient(circle at 50% 64%,var(--card) 0%,var(--chip) 58%,var(--paper-2) 100%);overflow:hidden}',
    '.bp-stage::after{content:"";position:absolute;left:50%;bottom:16px;width:104px;height:1px;transform:translateX(-50%);',
    'background:linear-gradient(90deg,transparent,var(--line),transparent)}',
    '.bp-stage canvas{width:192px;height:192px;image-rendering:pixelated;image-rendering:crisp-edges;',
    'position:relative;z-index:1;cursor:pointer}',
    '.bp-stage .bp-glow{position:absolute;inset:auto 0 -30px 0;height:74px;border-radius:50%;',
    'background:radial-gradient(ellipse at center,var(--bp-tint,rgba(217,242,107,.30)),transparent 70%);filter:blur(6px)}',
    '.bp-bubble{font-size:11.5px;line-height:1.65;color:var(--muted);min-height:38px;text-align:center;',
    'padding:0 2px;transition:opacity .25s}',
    '.bp-bubble.is-fresh{animation:bp-pop .34s cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes bp-pop{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
    '.bp-acts{display:flex;gap:6px}',
    '.bp-acts .mini-btn{flex:1;text-align:center;padding:4px 6px;font-size:10.5px}',
    '.bp-acts .mini-btn:hover{color:var(--ink)}',
    /* 移动端：右栏隐藏时改为左下角悬浮 */
    '.bp-card.bp-float{position:fixed;right:12px;bottom:12px;left:auto;z-index:45;width:auto;max-width:200px;',
    'padding:8px 10px 6px;border-radius:16px;background:var(--modal);border:1px solid var(--line);',
    'box-shadow:0 18px 40px -26px rgba(22,25,29,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);gap:6px}',
    '.bp-card.bp-float .bp-stage{height:96px;border:0;background:transparent}',
    '.bp-card.bp-float .bp-stage canvas{width:96px;height:96px}',
    '.bp-card.bp-float .bp-stage::after{display:none}',
    '.bp-card.bp-float .bp-bubble{font-size:10.5px;min-height:0;max-width:170px}',
    '.bp-card.bp-float .bp-acts,.bp-card.bp-float .bp-name .bp-sub{display:none}',
    '.bp-card.bp-float.is-quiet .bp-bubble{display:none}',
    '.bp-card.bp-float.is-quiet .bp-stage{height:92px}',
  '.bp-fx{position:absolute;inset:0;width:192px;height:192px;margin:auto;pointer-events:none;image-rendering:pixelated}',
  '.bp-stage{cursor:grab;transition:transform .3s cubic-bezier(.2,.9,.3,1)}',
  '.bp-card.is-drag .bp-stage{cursor:grabbing;transition:none;position:relative;z-index:5;box-shadow:0 10px 26px rgba(20,23,26,.18)}',
    '.bp-hud{display:flex;flex-direction:column;gap:6px}',
    '.bp-hud .bp-line{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--muted-2);min-width:0}',
    '.bp-hud b{font-family:var(--num);font-weight:600;font-size:11.5px;color:var(--ink-2);letter-spacing:.4px;flex:0 0 auto}',
    '.bp-hud .bp-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bp-hud .bp-xpbar{position:relative;display:block;height:4px;border-radius:99px;background:var(--line-soft);overflow:hidden}',
    '.bp-hud .bp-xpbar i{position:absolute;inset:0 auto 0 0;width:0;border-radius:99px;',
    'background:linear-gradient(90deg,var(--lime),#BFE22E);transition:width .6s cubic-bezier(.2,.7,.3,1)}',
    '.bp-hud .bp-en-tag{flex:0 0 auto;letter-spacing:.5px}',
    '.bp-hud .bp-en-num{flex:0 0 auto;font-family:var(--num);font-size:10.5px;color:var(--muted)}',
    '.bp-hud .bp-enbar{height:3px}',
    '.bp-hud .bp-enbar i{background:var(--lime);transition:width .4s ease}',
    '.bp-hud .bp-enbar.is-lively i{background:var(--lime)}',
    '.bp-hud .bp-enbar.is-normal i{background:var(--amber)}',
    '.bp-hud .bp-enbar.is-tired i{background:var(--muted-2)}',
    '.bp-hud .bp-enbar.is-down i{background:var(--red);opacity:.6}',
    '.bp-hit{outline:2px solid var(--lime);outline-offset:3px;border-radius:10px;transition:outline-color .2s}',
    '.bp-hud .bp-streak{white-space:nowrap;font-variant-numeric:tabular-nums;flex:0 0 auto}',
    '.bp-hud .bp-streak.hot{color:var(--amber)}',
    '.bp-badges{display:flex;gap:4px;align-items:center}',
    '.bp-badge{width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:9px;line-height:1;',
    'border:1px dashed var(--line);color:var(--muted-2);transition:all .3s;background:var(--chip)}',
    '.bp-badge.on{border-style:solid;border-color:#D5E96A;background:rgba(217,242,107,.26);color:var(--ink-2);font-weight:600}',
    '.bp-badge.is-new{animation:bp-badge .7s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes bp-badge{0%{transform:scale(.4);box-shadow:0 0 0 0 rgba(217,242,107,.9)}60%{transform:scale(1.15)}100%{transform:scale(1);box-shadow:0 0 0 10px rgba(217,242,107,0)}}',
    '@media (prefers-reduced-motion: reduce){',
    '.bp-stage canvas{animation:none}.bp-live{animation:none}.bp-card{animation:none}}'
  ].join('');

  /* ================= 3. 渲染器 ================= */

  var TINT = {
    idle: 'rgba(217,242,107,.34)', alert: 'rgba(191,69,45,.26)', happy: 'rgba(217,242,107,.46)',
    sad: 'rgba(51,83,140,.20)', celebrate: 'rgba(232,184,75,.40)', sleepy: 'rgba(154,157,159,.24)',
    focus: 'rgba(42,107,84,.22)'
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function PetCard() {
    var card = el('section', 'bp-card');
    card.setAttribute('aria-label', '陪伴宠物 小鸽');

    var head = el('div', 'bp-head');
    var name = el('div', 'bp-name', '<i class="bp-live"></i><span>小鸽</span><span class="bp-sub">DEADLINE PIGEON</span>');
    var chip = el('span', 'pill subtle', LABEL.idle);
    head.appendChild(name); head.appendChild(chip);

    var stage = el('div', 'bp-stage');
    stage.appendChild(el('i', 'bp-glow'));
    var canvas = el('canvas', 'bp-main');
    canvas.width = 192; canvas.height = 192;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '小鸽，状态：待机');
    stage.appendChild(canvas);
    var fx = el('canvas', 'bp-fx');
    fx.width = 192; fx.height = 192;
    stage.appendChild(fx);

    var bubbleEl = el('p', 'bp-bubble');
    bubbleEl.setAttribute('role', 'status');
    bubbleEl.setAttribute('aria-live', 'polite');

    /* 成长条：等级 + 经验 + 连续天数 + 徽章 */
    var hud = el('div', 'bp-hud');
    var line = el('div', 'bp-line');
    var lvEl = el('b', 'bp-lv', 'Lv.1');
    var titleEl = el('span', 'bp-title', '刚破壳');
    var streakEl = el('span', 'bp-streak', '连续 0 天');
    line.appendChild(lvEl); line.appendChild(titleEl); line.appendChild(streakEl);
    var bar = el('span', 'bp-xpbar');
    var barFill = document.createElement('i');
    bar.appendChild(barFill);
    var enLine = el('div', 'bp-line');
    var enTag = el('span', 'bp-en-tag', '干劲');
    var enNum = el('span', 'bp-en-num', '58');
    enLine.appendChild(enTag); enLine.appendChild(enNum);
    var enBar = el('span', 'bp-xpbar bp-enbar');
    var enFill = document.createElement('i');
    enBar.appendChild(enFill);
    hud.appendChild(line); hud.appendChild(bar);
    hud.appendChild(enLine); hud.appendChild(enBar);

    var badgeRow = el('div', 'bp-badges');
    var badgeEls = {};
    for (var bi = 0; bi < BADGES.length; bi++) {
      var b = el('span', 'bp-badge', BADGES[bi].g);
      b.title = BADGES[bi].name + ' · ' + BADGES[bi].hint;
      badgeRow.appendChild(b);
      badgeEls[BADGES[bi].id] = b;
    }

    var acts = el('div', 'bp-acts');
    var pat = el('button', 'mini-btn', '摸摸');
    pat.setAttribute('data-bp', 'pat');
    var next = el('button', 'mini-btn', '先做这个');
    next.setAttribute('data-bp', 'next');
    acts.appendChild(pat); acts.appendChild(next);

    card.appendChild(head); card.appendChild(stage); card.appendChild(hud);
    card.appendChild(badgeRow); card.appendChild(bubbleEl); card.appendChild(acts);

    this.node = card;
    this.chip = chip;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bubble = bubbleEl;
    this.stage = stage;
    this.fx = fx;
    this.fxctx = fx.getContext('2d');
    this.parts = [];
    this.suppressClick = false;
    this.hud = { lv: lvEl, title: titleEl, bar: barFill, streak: streakEl,
      en: enNum, enWrap: enBar, enFill: enFill, pool: null };
    this.badges = badgeEls;
    this._lv = 0;
    this.ctx.imageSmoothingEnabled = false;
  }

  /* 刷新成长条；返回这次有没有升级 / 新徽章（用于弹特效） */
  PetCard.prototype.updateHud = function (mem, energy, pool) {
    var l = levelOf(mem.xp || 0);
    this.hud.lv.textContent = 'Lv.' + l.lv;
    this.hud.title.textContent = l.title;
    this.hud.bar.style.width = Math.round(l.progress * 100) + '%';
    var st = mem.streak || 0;
    this.hud.streak.textContent = '连续 ' + st + ' 天';
    this.hud.streak.classList.toggle('hot', st >= 3);

    var fresh = [];
    for (var id in this.badges) {
      var on = !!(mem.badges && mem.badges[id]);
      var n = this.badges[id];
      if (on && !n.classList.contains('on')) { fresh.push(n); n.classList.add('is-new'); }
      n.classList.toggle('on', on);
    }
    if (energy != null) {
      var e = Math.max(0, Math.min(100, Math.round(energy)));
      this.hud.en.textContent = e;
      this.hud.enFill.style.width = e + '%';
      this.hud.enWrap.className = 'bp-xpbar bp-enbar is-' + moodOf(e);
    }
    if (pool) this.hud.pool = pool;
    var up = this._lv && l.lv > this._lv;
    this._lv = l.lv;
    return { up: up, fresh: fresh, lv: l.lv };
  };

  /* 按 holds 表算当前该显示第几帧。
     环境态只循环 loopEnd 帧（不播收尾帧）；一次性动作播满全部帧、
     最后停在收尾帧上（收尾帧 = 待机第 0 帧的姿势），所以退场不会跳。 */
  function frameAt(meta, elapsed, once) {
    var holds = meta.holds;
    var n = meta.frames;
    if (!holds || holds.length !== n) {
      var f0 = Math.floor(elapsed / 1000 * (meta.fps || 3));
      return meta.loop && !once ? f0 % n : Math.min(n - 1, f0);
    }
    var tick = meta.tick || 60;
    var limit = once ? n : (meta.loop ? (meta.loopEnd || n) : n);
    var total = 0, i;
    for (i = 0; i < limit; i++) total += holds[i];
    var t = Math.floor(elapsed / tick);
    if (meta.loop && !once) { t %= total; } else { t = Math.min(t, total - 1); }
    var acc = 0;
    for (i = 0; i < limit; i++) {
      acc += holds[i];
      if (t < acc) return i;
    }
    return limit - 1;
  }

  /* 第 t 拍落在第几帧 */
  function indexAt(holds, t) {
    var acc = 0;
    for (var i = 0; i < holds.length; i++) { acc += holds[i]; if (t < acc) return i; }
    return holds.length - 1;
  }

  /* 三段式的 A + 循环 B（按住时用）：不越过 seg[1]，一直在 B 段里绕 */
  function frameAtHold(meta, elapsed) {
    if (!meta.seg || !meta.holds) return frameAt(meta, elapsed % 100000);
    var holds = meta.holds, tick = meta.tick || 60, seg = meta.seg, i;
    var aDur = 0, bDur = 0;
    for (i = 0; i < seg[0]; i++) aDur += holds[i];
    for (i = seg[0]; i < seg[1]; i++) bDur += holds[i];
    if (!bDur) bDur = 1;
    var t = Math.floor(elapsed / tick);
    if (t < aDur) return indexAt(holds, t);
    return indexAt(holds, aDur + ((t - aDur) % bDur));
  }

  /* 三段式的收尾 C（松手时用）：从 seg[1] 播到末帧，播完停在末帧 */
  function frameAtRelease(meta, elapsed) {
    if (!meta.seg || !meta.holds) return frameAt(meta, elapsed);
    var holds = meta.holds, tick = meta.tick || 60, i;
    var base = 0, total = 0;
    for (i = 0; i < meta.frames; i++) total += holds[i];
    for (i = 0; i < meta.seg[1]; i++) base += holds[i];
    return indexAt(holds, Math.min(total - 1, base + Math.floor(elapsed / tick)));
  }

  var BLEND_MS = 130;      // 换状态时交叉淡入的时长

  /* 画一帧；mirror 在渲染层做（整幅镜像 = 面朝左），不占图集 */
  PetCard.prototype.paintAt = function (state, frame, alpha) {
    var meta = META.states[state] || META.states.idle;
    var f = Math.max(0, Math.min(meta.frames - 1, frame | 0));
    var flip = !!meta.mirror || (meta.flipAt != null && f >= meta.flipAt);
    var w = META.frame.w, h = META.frame.h;
    var ctx = this.ctx, cw = this.canvas.width;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (flip) { ctx.save(); ctx.translate(cw, 0); ctx.scale(-1, 1); }
    ctx.drawImage(ATLAS_IMG, f * w, meta.row * h, w, h, 0, 0, cw, cw);
    if (flip) ctx.restore();
    ctx.globalAlpha = 1;
  };

  PetCard.prototype.draw = function (state, frame) {
    var ctx = this.ctx, cw = this.canvas.width;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cw, cw);
    if (this.blend && this.blendT < BLEND_MS) {
      // 上一帧垫底下、新的一帧淡入：硬切变成 130ms 的过渡
      this.paintAt(this.blend.state, this.blend.frame, 1);
      this.paintAt(state, frame, Math.max(0, Math.min(1, this.blendT / BLEND_MS)));
    } else {
      this.blend = null;
      this.paintAt(state, frame, 1);
    }
  };

  /* 轻粒子：庆祝撒星、犯困飘 Zzz（纯 canvas，2x2 像素方块，最多 28 颗） */
  PetCard.prototype.spawn = function (kind) {
    if (!this.fxctx) return;
    var n = kind === 'zzz' ? 2 : 6;
    for (var i = 0; i < n; i++) {
      this.parts.push({
        x: 80 + (Math.random() * 50 - 25),
        y: kind === 'zzz' ? 58 : 84 + Math.random() * 26,
        vx: kind === 'zzz' ? 0.5 + Math.random() * 0.5 : (Math.random() - 0.5) * 1.6,
        vy: kind === 'zzz' ? -0.45 - Math.random() * 0.35 : -1.2 - Math.random() * 0.9,
        g: kind === 'zzz' ? 0 : 0.055,
        life: 1,
        size: kind === 'zzz' ? 1.5 : 1,
        c: kind === 'zzz' ? '#9DB4D8' : (Math.random() < 0.5 ? '#F0C24B' : '#D9F26B')
      });
    }
    if (this.parts.length > 28) this.parts.splice(0, this.parts.length - 28);
  };

  PetCard.prototype.step = function (dt) {
    if (!this.fxctx || !this.parts.length) {
      if (this.fxctx && this._hadParts) { this.fxctx.clearRect(0, 0, 192, 192); this._hadParts = false; }
      return;
    }
    this._hadParts = true;
    var ctx = this.fxctx;
    ctx.clearRect(0, 0, 192, 192);
    var alive = [];
    for (var i = 0; i < this.parts.length; i++) {
      var pp = this.parts[i];
      pp.x += pp.vx * dt * 60; pp.y += pp.vy * dt * 60; pp.vy += pp.g * dt * 60;
      pp.life -= dt * 1.1;
      if (pp.life <= 0 || pp.y < -6) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, pp.life));
      ctx.fillStyle = pp.c;
      ctx.fillRect(Math.round(pp.x), Math.round(pp.y), pp.size * 2, pp.size * 2);
      alive.push(pp);
    }
    ctx.globalAlpha = 1;
    this.parts = alive;
  };

  PetCard.prototype.setLabel = function (state) {
    this.chip.textContent = LABEL[state] || state;
    this.canvas.setAttribute('aria-label', '小鸽，状态：' + (LABEL[state] || state));
    this.stage.style.setProperty('--bp-tint', TINT[state] || TINT.idle);
  };

  PetCard.prototype.say = function (text, force) {
    var now = Date.now();
    if (!force && text === this._lastText) return;
    if (!force && this._saidAt && now - this._saidAt < BUBBLE_GAP) return;
    this._lastText = text;
    this._saidAt = now;
    this.bubble.textContent = text;
    this.bubble.classList.remove('is-fresh');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('is-fresh');
  };

  /* ================= 4. 运行时 ================= */

  var ATLAS_IMG = null;

  function currentWorld(now, mem) {
    var BG = win.BG;
    var store = BG && BG.store && BG.store.get();
    var list = (store && store.tasks) || [];
    var settings = (store && store.settings) || {};
    var stats = BG.model.stats(list, now);

    var critical = 0, nearest = null;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.status === 'done') continue;
      if (BG.model.bucket(t, now) === 'critical') {
        critical++;
        var hl = (t.dueAt - now) / 3600000;
        if (nearest == null || hl < nearest) nearest = hl;
      }
    }
    var load = BG.model.weeklyLoad(list, now, settings);
    var active = document.activeElement;
    var typing = !!(
      (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) ||
      (document.getElementById('modalRoot') || {}).childElementCount
    );
    var hour = new Date(now).getHours();

    /* 最该先做的那件：未完成里截止最近的一条 */
    var top = null;
    for (var j = 0; j < list.length; j++) {
      var tj = list[j];
      if (tj.status === 'done') continue;
      if (!top || tj.dueAt < top.dueAt) top = tj;
    }
    if (top) {
      var title = String(top.title || '');
      top = {
        id: top.id,
        title: title,
        short: title.length > 12 ? title.slice(0, 12) + '…' : title,
        hours: (top.dueAt - now) / 3600000
      };
    }

    var w = {
      now: now,
      list: list,
      top: top,
      open: stats.open,
      overdue: stats.overdue,
      done: stats.done,
      critical: critical,
      nearestHours: nearest,
      loadRatio: load.ratio,
      overload: load.overload,
      doneToday: mem.doneToday,
      streak: mem.streak,
      typing: typing,
      hour: hour,
      idleMs: now - (win.BG_PET_IDLE || now),
      awake: !!win.BG_PET_AWAKE
    };
    w.energy = energyOf(w);
    w.mood = moodOf(w.energy);
    return w;
  }

  function start() {
    var BG = win.BG;
    if (!BG || !BG.store || !BG.model) {
      if (win.console) console.warn('[pet] 需要先加载 store.js / data.js');
      return;
    }
    if (win.BG_PET) return;

    var mem = load();
    var awakeMode = /(?:^|[?&])pet=awake(?:&|$)/.test((win.location && win.location.search) || '');
    win.BG_PET_AWAKE = awakeMode;
    var card = new PetCard();
    var reaction = null;
    var prev = null;
    var ambient = 'idle';
    var lastFlourish = 0;
    var state = 'idle';
    var frame = 0;
    var said = 0;

    /* ---- 记忆 ---- */
    function load() {
      var base = blankMemory();
      try {
        var raw = win.localStorage && win.localStorage.getItem('buge.pet.v1');
        if (raw) base = Object.assign(base, JSON.parse(raw) || {});
      } catch (e) { /* 隐私模式 */ }
      return rollDay(base, Date.now());
    }
    function save() {
      try {
        win.localStorage.setItem('buge.pet.v1', JSON.stringify({
          day: mem.day, doneToday: mem.doneToday, streak: mem.streak, lastDoneDay: mem.lastDoneDay,
          pats: mem.pats, xp: mem.xp, lv: mem.lv, patsToday: mem.patsToday,
          seenDay: mem.seenDay, badges: mem.badges
        }));
      } catch (e) { /* ignore */ }
    }

    /* ---- 挂载位置：右栏顶部；右栏不可见时改悬浮 ---- */
    function place() {
      var rail = document.querySelector('.rail');
      var float = !rail || !rail.offsetWidth;
      if (float) {
        card.node.classList.add('bp-float');
        document.body.appendChild(card.node);
      } else {
        card.node.classList.remove('bp-float');
        if (rail.firstChild !== card.node) rail.insertBefore(card.node, rail.firstChild);
      }
    }

    /* ---- 交互：只记「最后操作时间」，不抢焦点 ---- */
    var lastMove = 0;
    document.addEventListener('pointermove', function () {
      var t = Date.now();
      if (t - lastMove < 1500) return;          // 节流：别每帧都写
      lastMove = t; win.BG_PET_IDLE = t;
      card.node.classList.remove('is-quiet');
    }, { passive: true });
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        win.BG_PET_IDLE = Date.now();
        card.node.classList.remove('is-quiet');
      }, { passive: true });
    });
    var lookSide = 0;
    card.node.addEventListener('pointermove', function (e) {
      var r = card.canvas.getBoundingClientRect();
      var d = e.clientX - (r.left + r.width / 2);
      lookSide = Math.abs(d) < 10 ? 0 : (d > 0 ? 1 : -1);
    });
    card.node.addEventListener('pointerleave', function () { lookSide = 0; });

    /* 拖拽：按住画布拖，松手弹回原位；拖动超过 5px 就不算点击 */
    var drag = null;
    card.stage.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
      card.node.classList.add('is-drag');
      if (card.stage.setPointerCapture) { try { card.stage.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    card.stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) > 5) drag.moved = true;
      if (drag.moved) card.stage.style.transform = 'translate(' + drag.dx + 'px,' + drag.dy + 'px)';
    });
    function endDrag() {
      if (!drag) return;
      card.suppressClick = drag.moved;
      drag = null;
      card.node.classList.remove('is-drag');
      card.stage.style.transform = '';
      setTimeout(function () { card.suppressClick = false; }, 260);
    }
    card.stage.addEventListener('pointerup', endDrag);
    card.stage.addEventListener('pointercancel', endDrag);

    card.canvas.addEventListener('click', function () {
      if (card.suppressClick) return;
      win.BG_PET_IDLE = Date.now();
      if (card.node.classList.contains('bp-float')) {
        card.node.classList.toggle('is-quiet');
      }
      pat();
    });
    card.node.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-bp]');
      if (!b) return;
      if (b.dataset.bp === 'next') next();   // 「摸摸」走按住逻辑，这里只处理跳转
    });

    /* 短按「摸摸」= 摸一下；按住 220ms 以上 = 一直呼噜，松手播收尾 */
    (function () {
      var btn = card.node.querySelector('[data-bp="pat"]');
      if (!btn) return;
      var timer = null, long = false;
      btn.addEventListener('pointerdown', function () {
        long = false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { long = true; holdPat(true); }, 220);
      });
      function up() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (long) { holdPat(false); long = false; }
        else pat();
      }
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', function () { if (timer) clearTimeout(timer); timer = null; if (long) { holdPat(false); long = false; } });
      btn.addEventListener('pointerleave', function () { if (timer) clearTimeout(timer); timer = null; if (long) { holdPat(false); long = false; } });
    })();

    /* 按住「摸摸」：进 A→B 循环；松手：播 C 收尾 */
    function holdPat(on) {
      if (on) {
        if (reaction && reaction.hold) return;
        react('pat');                       // 计经验 + 台词
        reaction = { state: 'pat', at: Date.now(), hold: true };
        state = 'pat'; shown = 'pat'; t0 = lastTs || 0;
        card.setLabel('pat');
      } else if (reaction && reaction.hold) {
        reaction = { state: 'pat', at: Date.now(), release: true };
        t0 = lastTs || 0;
      }
    }

    function pat() {
      mem.pats = (mem.pats || 0) + 1;
      rollDay(mem, Date.now());
      if (mem.patsToday < XP.PAT_CAP) {
        mem.patsToday = (mem.patsToday || 0) + 1;
        addXp(mem, XP.PAT);
        card.updateHud(mem, worldEnergy(), poolNow());
      }
      save();
      react('pat');
      var lines = ['诶——被摸到了。', '收到，我继续盯着雷达。', '再摸下去我要骄傲了。', '有你在，逾期也不那么可怕。'];
      card.say(lines[mem.pats % lines.length], true);
    }

    /* 刷新成长条；升级时补一个庆祝 + 台词 */
    function worldEnergy() {
      try { return currentWorld(Date.now(), mem).energy; } catch (e) { return null; }
    }
    function poolNow() {
      try {
        var w = currentWorld(Date.now(), mem);
        return flourishPool(levelOf(mem.xp || 0).lv, w.energy);
      } catch (e) { return null; }
    }

    function updateHud() {
      var r = card.updateHud(mem, worldEnergy(), poolNow());
      if (r.up) {
        react('celebrate');
        card.say('升到 Lv.' + r.lv + ' 了 · ' + levelOf(mem.xp).title + '。', true);
      }
      return r;
    }

    function next() {
      var target = pickTargetTask();
      var btn = target || document.querySelector('#hero [data-action="focus"]');
      var hero = document.getElementById('hero');
      if (btn && btn.offsetParent !== null) { btn.click(); return; }
      if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.say('今天该先做的是清单最上面那张卡。', true);
    }

    function react(s) {
      reaction = { state: s, at: Date.now() };
      lastFlourish = Date.now();
      frame = 0;
    }

    /* 找当前最该做的那张任务卡，滚动过去并闪一下 */
    function pickTargetTask() {
      var w;
      try { w = currentWorld(Date.now(), mem); } catch (e) { return null; }
      if (!w.top) return null;
      var id = w.top.id;
      var nodes = document.querySelectorAll('[data-id], [data-task]');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.getAttribute('data-id') === id || n.getAttribute('data-task') === id) {
          if (n.scrollIntoView) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
          n.classList.add('bp-hit');
          setTimeout(function () { n.classList.remove('bp-hit'); }, 1400);
          return n;
        }
      }
      return null;
    }

    /* ---- 每秒：比对快照 → 触发反应态 ---- */
    function think(now) {
      rollDay(mem, now);
      var world = currentWorld(now, mem);
      var d = diffTasks(prev, world.list, now);
      prev = snapshotOf(world.list, now);

      if (d.done.length) {
        var rec = recordDone(mem, now);
        var gain = XP.DONE * d.done.length;
        for (var k = 0; k < d.done.length; k++) {
          if (now < d.done[k].dueAt) gain += XP.ON_TIME;      // 提前收掉，多给一点
        }
        if (rec.celebrate) award(mem, 'three');
        award(mem, 'first');
        if (mem.streak >= 7) award(mem, 'week');
        var res = addXp(mem, gain);
        save();
        card.updateHud(mem, worldEnergy(), poolNow());
        react(rec.celebrate || res.up ? 'celebrate' : 'happy');
        card.spawn('star');
        if (res.up) {
          card.say('升到 Lv.' + res.lv + ' 了 · ' + levelOf(mem.xp).title + '。谢谢你把清单往前推。', true);
        }
      } else if (d.overdue.length) {
        react('sad');
      }

      /* 清单被清空 → 给个徽章 */
      if (d.reshaped || world.open === 0) {
        if (world.open === 0 && (mem.xp || 0) > 0 && award(mem, 'clear')) {
          save();
          card.updateHud(mem, worldEnergy(), poolNow());
        }
      }

      ambient = derive(world, null).state;

      /* 待机时来个小动作：能做什么看等级，多久做一次看干劲 */
      var lvNow = levelOf(mem.xp || 0).lv;
      var pool = flourishPool(lvNow, world.energy);
      if (!reaction && derive(world, null).state === 'idle' && pool.length) {
        var gap = FLOURISH_GAP;
        if (world.energy >= 72) gap -= 1500;       // 有劲：七八秒来一下
        else if (world.energy < 22) gap += 3000;   // 没劲：拖到十二秒
        if (now - lastFlourish > gap) {
          lastFlourish = now;
          var pick = pool[Math.floor(Math.random() * pool.length)];
          reaction = { state: pick, at: now };
          frame = 0;
          card.setLabel(pick);
        }
      }

      var nextState = derive(world, reaction).state;
      if (nextState !== state) {
        state = nextState;
        frame = 0;
        card.setLabel(state);
      }

      /* 气泡：状态切换时立刻换，平时 20s 轻轻换一句 */
      var meta = META.states[state];
      if (Date.now() - said > 20000 || state !== card._state) {
        said = Date.now();
        card._state = state;
        card.say(bubble(world, state, said / 1000 | 0), true);
      }
      if (ambient === 'sleepy' && Math.random() < 0.3) card.spawn('zzz');
      if (reaction && !HOLD[reaction.state]) reaction = null;
      if (reaction && now - reaction.at >= HOLD[reaction.state]) reaction = null;

      return state;
    }

    /* ---- 动画帧 ---- */
    var raf = 0, lastTick = 0, t0 = 0, lastTs = 0;
    var shown = 'idle';
    function loop(ts) {
      raf = win.requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!t0) t0 = ts;
      if (ts - lastTick > 1000) { lastTick = ts; think(Date.now()); }

      var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;

      /* 待机 + 光标在卡片上 → 扭头看光标 */
      var looking = (ambient === 'idle' && !reaction && lookSide)
        ? (lookSide > 0 ? 'look_r' : 'look_l') : null;
      var want = state;
      if (reaction && reaction.hold) want = reaction.state;
      else if (reaction && reaction.release) {
        var cMeta = META.states[reaction.state];
        var cDur = 0, ci;
        if (cMeta && cMeta.holds) for (ci = cMeta.seg ? cMeta.seg[1] : 0; ci < cMeta.frames; ci++) cDur += cMeta.holds[ci];
        if (ts - t0 < cDur * (cMeta.tick || 60)) want = reaction.state;
      } else if (looking) want = looking;
      card.blendT = (card.blendT || 0) + dt * 1000;
      if (want !== shown) {
        card.blend = { state: shown, frame: frame };   // 旧的一帧垫在下面
        card.blendT = 0;
        shown = want;
        t0 = ts;
      }

      var meta = META.states[shown] || META.states.idle;
      var once = !!(reaction && !reaction.hold && !reaction.release && HOLD[reaction.state]);
      if (reaction && reaction.hold) frame = frameAtHold(meta, ts - t0);
      else if (reaction && reaction.release) frame = frameAtRelease(meta, ts - t0);
      else frame = frameAt(meta, ts - t0, once);
      card.draw(shown, frame);
      card.step(dt);
    }

    place();
    var now0 = Date.now();
    var w0 = currentWorld(now0, mem);
    state = derive(w0, null).state;
    card.setLabel(state);
    card.say(bubble(w0, state, 0), true);
    prev = snapshotOf(w0.list, now0);
    card.updateHud(mem, worldEnergy(), poolNow());

    /* 今天第一次见到它 → 打个招呼，并给一句今天该做什么 */
    if (mem.seenDay !== dayKey(now0)) {
      mem.seenDay = dayKey(now0);
      mem.patsToday = 0;
      save();
      react('wave');
      state = 'wave';
      card.setLabel(state);
      card.say(bubble(w0, 'wave', now0 / 60000 | 0), true);
    }

    var img = new Image();
    img.onload = function () { ATLAS_IMG = img; card.draw(state, 0); };
    img.src = ATLAS;
    ATLAS_IMG = img;

    win.addEventListener('resize', place);
    document.addEventListener('visibilitychange', function () { t0 = 0; lastTick = 0; });
    raf = win.requestAnimationFrame(loop);

    win.BG_PET = {
      version: VERSION,
      refresh: function () { think(Date.now()); },
      state: function () { return state; },
      /* 演示用：手动触发一个反应态，例如 BG_PET.force('celebrate') */
      force: function (s) { if (META.states[s]) react(s); return state; },
      node: card.node
    };
  }

  /* ================= 5. 导出（供单测 & 二次开发） ================= */

  var logic = {
    STATES: STATES,
    LABEL: LABEL,
    HOLD: HOLD,
    FLOURISH: FLOURISH,
    ambientState: ambientState,
    derive: derive,
    bubble: bubble,
    diffTasks: diffTasks,
    snapshotOf: snapshotOf,
    recordDone: recordDone,
    rollDay: rollDay,
    blankMemory: blankMemory,
    dayKey: dayKey,
    LEVELS: LEVELS,
    XP: XP,
    UNLOCK: UNLOCK,
    energyOf: energyOf,
    moodOf: moodOf,
    flourishPool: flourishPool,
    BADGES: BADGES,
    levelOf: levelOf,
    addXp: addXp,
    award: award,
    frameAt: frameAt,
    frameAtHold: frameAtHold,
    frameAtRelease: frameAtRelease,
    META: META
  };

  var BG = win.BG = win.BG || {};
  BG.petLogic = logic;

  function boot() {
    if (win.location && /[?&]pet=off\b/.test(win.location.search || '')) return;
    var style = document.createElement('style');
    style.setAttribute('data-bp', 'style');
    style.textContent = CSS;
    document.head.appendChild(style);
    start();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);

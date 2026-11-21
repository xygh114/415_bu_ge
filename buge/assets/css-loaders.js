/*!
 * css-loaders.js — 只服务 09 号组件 .cl-counter（全屏数字计数器）
 * 摘自 D:\dsh文件\css-loaders-handoff.md §7，原样落地；不注册任何全局副作用，
 * 只扫描 [data-cl-counter] 元素，跑完加 .is-done 并派发 cl-counter-done 事件。
 * 站点里如果没有 .cl-counter，这个文件等于空转（<1ms）。
 */
/**
 * css-loaders.js —— 只服务于 09 号组件 .cl-counter（全屏数字计数器）。
 *
 * 其余 9 个组件是纯 CSS，不需要引入这个文件；这个文件也不做任何全局副作用，
 * 只扫描带 data-cl-counter 的元素。
 *
 * 用法：
 *   <div class="cl-counter" data-cl-counter>
 *     <div class="cl-counter__bar"></div>
 *     <div class="cl-counter__num">0%</div>
 *   </div>
 *
 * 可选属性和 CSS 变量：
 *   data-cl-duration="8"   进度总时长（秒），优先于 --cl-duration
 *   --cl-duration: 8s      同上
 *   --cl-color / --cl-track / --cl-num  见 css-loaders.css
 *
 * 结束时：给元素加 .is-done（CSS 里淡出），并派发一次冒泡事件 cl-counter-done，
 * 方便你接在首次渲染完成之后再显示正文。
 */
(function () {
  'use strict';

  var SELECTOR = '[data-cl-counter]';
  var started = new WeakSet();

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function readDuration(el) {
    var attr = parseFloat(el.dataset.clDuration);
    if (isFinite(attr) && attr > 0) return attr;
    var css = parseFloat(getComputedStyle(el).getPropertyValue('--cl-duration'));
    if (isFinite(css) && css > 0) return css;
    return 8;
  }

  function finish(el) {
    el.classList.add('is-done');
    el.dispatchEvent(new CustomEvent('cl-counter-done', { bubbles: true }));
  }

  function run(el) {
    if (started.has(el)) return;
    started.add(el);

    var num = el.querySelector('.cl-counter__num');
    var duration = readDuration(el);

    if (prefersReducedMotion()) {
      el.style.setProperty('--cl-progress', '1');
      if (num) num.textContent = '100%';
      finish(el);
      return;
    }

    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / (duration * 1000), 1);
      // ease-out：前段跑得快，和原版 80ms 固定步进的观感一致但不掉帧
      var eased = 1 - Math.pow(1 - t, 2);
      el.style.setProperty('--cl-progress', String(eased));
      if (num) num.textContent = Math.round(eased * 100) + '%';
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        setTimeout(function () { finish(el); }, 500);
      }
    }
    requestAnimationFrame(frame);
  }

  function scan(root) {
    if (root.matches && root.matches(SELECTOR)) run(root);
    if (root.querySelectorAll) {
      var nodes = root.querySelectorAll(SELECTOR);
      for (var i = 0; i < nodes.length; i++) run(nodes[i]);
    }
  }

  function boot() {
    scan(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) scan(added[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // 供非模块环境手动调用：window.CssLoaders.runCounter(el)
  window.CssLoaders = window.CssLoaders || {};
  window.CssLoaders.runCounter = run;
})();

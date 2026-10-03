/*
 * fx.js — manga-style drama layer for the Prompt Colosseum prototypes.
 *
 *   FX.init()                                  // once, after the stage exists
 *   FX.menace({ x, y, w, h, chars, color, every })  -> stop()   floating ゴゴゴ in a zone
 *   FX.pop(text, x, y, { size, color, rot })   // one-off sound effect (ドド, オラ)
 *   FX.slam(text, { sub, color, size, hold })  // giant centred impact text
 *   FX.lines(ms, { color })                    // radial speed lines
 *   FX.invert(times)                           // negative-colour flash
 *   FX.shake(ms, px)                           // shake the whole stage
 *   FX.tbc(cb)                                 // sepia freeze + "To Be Continued" arrow
 *
 * Coordinates are stage pixels (1440×810). Everything respects prefers-reduced-motion
 * by skipping the looping/flashing parts.
 */
(function () {
  var CSS = [
    '.fx-layer{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:40}',
    '.fx-sfx{position:absolute;font-family:"Dela Gothic One",sans-serif;line-height:1;white-space:nowrap;',
    '  -webkit-text-stroke:4px #120414;paint-order:stroke fill;text-shadow:5px 5px 0 #120414;will-change:transform,opacity}',
    '.fx-go{animation:fx-go 2.4s steps(12) forwards}',
    '@keyframes fx-go{0%{opacity:0;transform:translate(0,30px) scale(.4) rotate(var(--r))}',
    '  12%{opacity:1;transform:translate(0,0) scale(1.25) rotate(var(--r))}',
    '  20%{transform:translate(0,0) scale(1) rotate(var(--r))}',
    '  85%{opacity:1}100%{opacity:0;transform:translate(var(--dx),-60px) scale(1.1) rotate(var(--r))}}',
    '.fx-pop{animation:fx-pop .9s cubic-bezier(.2,1.6,.4,1) forwards}',
    '@keyframes fx-pop{0%{opacity:0;transform:scale(2.6) rotate(var(--r))}18%{opacity:1;transform:scale(.9) rotate(var(--r))}',
    '  30%{transform:scale(1.05) rotate(var(--r))}75%{opacity:1}100%{opacity:0;transform:scale(1) translateY(-24px) rotate(var(--r))}}',
    '.fx-slam{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}',
    '.fx-slam .fx-sfx{position:static;animation:fx-slam var(--hold) cubic-bezier(.15,1.5,.3,1) forwards}',
    '.fx-slam .fx-sub{font-family:"Jersey 10",sans-serif;font-size:58px;letter-spacing:6px;color:#fff;',
    '  text-shadow:4px 4px 0 #120414,-3px 0 0 #120414,3px 0 0 #120414,0 -3px 0 #120414;animation:fx-slam var(--hold) .06s cubic-bezier(.15,1.5,.3,1) both}',
    '@keyframes fx-slam{0%{opacity:0;transform:scale(4) rotate(-8deg)}14%{opacity:1;transform:scale(.92) rotate(-4deg)}',
    '  22%{transform:scale(1.04) rotate(-5deg)}80%{opacity:1;transform:scale(1) rotate(-5deg)}100%{opacity:0;transform:scale(1.15) rotate(-5deg)}}',
    '.fx-lines{position:absolute;left:-20%;top:-40%;width:140%;height:180%;opacity:0;',
    '  background:repeating-conic-gradient(from 0deg at 50% 50%,var(--c) 0deg 1.2deg,transparent 1.2deg 4.5deg,var(--c) 4.5deg 5deg,transparent 5deg 9deg);',
    '  -webkit-mask:radial-gradient(circle at 50% 50%,transparent 18%,#000 46%);mask:radial-gradient(circle at 50% 50%,transparent 18%,#000 46%);',
    '  animation:fx-lines .12s steps(1) infinite}',
    '@keyframes fx-lines{0%{transform:rotate(0)}50%{transform:rotate(2.5deg)}}',
    '.fx-lines.on{opacity:.75;transition:opacity .08s}',
    '.fx-invert{animation:fx-invert .1s steps(1) var(--n) both}',
    '@keyframes fx-invert{0%{filter:invert(1) hue-rotate(180deg) saturate(2.4) contrast(1.3)}50%{filter:none}}',
    '.fx-shake{animation:fx-shake .07s steps(1) infinite}',
    '@keyframes fx-shake{0%{translate:var(--s) calc(var(--s) * -.6)}33%{translate:calc(var(--s) * -1) calc(var(--s) * .5)}66%{translate:calc(var(--s) * .5) var(--s)}}',
    '.fx-sepia{filter:sepia(1) contrast(1.15) brightness(.9);transition:filter .25s}',
    '.fx-tbc{position:absolute;left:-560px;bottom:56px;display:flex;align-items:center;gap:14px;height:76px;padding:0 54px 0 34px;',
    '  background:#1d140c;color:#F0D9A0;clip-path:polygon(44px 0,100% 0,100% 100%,44px 100%,0 50%);',
    '  font-family:"Jersey 10",sans-serif;font-size:50px;letter-spacing:3px;animation:fx-tbc .45s cubic-bezier(.2,1.3,.4,1) forwards}',
    '@keyframes fx-tbc{to{left:40px}}',
    '.fx-hot{animation:fx-hot .5s steps(2) infinite}',
    '@keyframes fx-hot{0%{color:#FF3B30;text-shadow:0 0 18px rgba(255,40,30,.9),4px 0 0 #120414}50%{color:#F2EEDC}}'
  ].join('\n');

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage, layer, linesEl;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function sfx(text, x, y, size, color, rot, cls, life) {
    var el = document.createElement('span');
    el.className = 'fx-sfx ' + cls;
    el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.fontSize = size + 'px'; el.style.color = color;
    el.style.setProperty('--r', rot + 'deg');
    el.style.setProperty('--dx', rnd(-20, 20) + 'px');
    layer.appendChild(el);
    setTimeout(function () { el.remove(); }, life);
    return el;
  }

  var FX = {
    init: function () {
      if (stage) return FX;
      var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      stage = document.querySelector('#frame > div');
      layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true');
      linesEl = document.createElement('div'); linesEl.className = 'fx-lines';
      layer.appendChild(linesEl);
      // under the scanline overlay (last child) so effects get scanlined too
      stage.insertBefore(layer, stage.lastElementChild);
      return FX;
    },

    menace: function (o) {
      if (reduce) return function () {};
      var chars = o.chars || 'ゴ', color = o.color || '#B04CFF';
      var t = setInterval(function () {
        var size = rnd(o.min || 56, o.max || 96);
        sfx(chars, o.x + rnd(0, o.w), o.y + rnd(0, o.h), size, color, rnd(-18, 18), 'fx-go', 2500);
      }, o.every || 260);
      return function () { clearInterval(t); };
    },

    pop: function (text, x, y, o) {
      o = o || {};
      sfx(text, x, y, o.size || 56, o.color || '#FFE14A', o.rot != null ? o.rot : rnd(-16, 16), 'fx-pop', 950);
    },

    slam: function (text, o) {
      o = o || {};
      var hold = o.hold || 1100;
      var box = document.createElement('div'); box.className = 'fx-slam';
      box.style.setProperty('--hold', hold + 'ms');
      var big = document.createElement('span'); big.className = 'fx-sfx';
      big.textContent = text; big.style.fontSize = (o.size || 200) + 'px'; big.style.color = o.color || '#FFE14A';
      big.style.webkitTextStroke = '8px #120414'; big.style.textShadow = '12px 12px 0 #120414';
      box.appendChild(big);
      if (o.sub) { var s = document.createElement('span'); s.className = 'fx-sub'; s.textContent = o.sub; box.appendChild(s); }
      layer.appendChild(box);
      setTimeout(function () { box.remove(); }, hold + 80);
    },

    lines: function (ms, o) {
      if (reduce) return;
      linesEl.style.setProperty('--c', (o && o.color) || 'rgba(255,255,255,0.9)');
      linesEl.classList.add('on');
      clearTimeout(linesEl._t);
      linesEl._t = setTimeout(function () { linesEl.classList.remove('on'); }, ms || 700);
    },

    invert: function (times) {
      if (reduce) return;
      stage.classList.remove('fx-invert'); void stage.offsetWidth;
      stage.style.setProperty('--n', times || 2);
      stage.classList.add('fx-invert');
      setTimeout(function () { stage.classList.remove('fx-invert'); }, 100 * (times || 2) + 20);
    },

    shake: function (ms, px) {
      if (reduce) return;
      stage.style.setProperty('--s', (px || 8) + 'px');
      stage.classList.add('fx-shake');
      clearTimeout(stage._shk);
      stage._shk = setTimeout(function () { stage.classList.remove('fx-shake'); }, ms || 400);
    },

    tbc: function (cb) {
      stage.classList.add('fx-sepia');
      var a = document.createElement('div'); a.className = 'fx-tbc'; a.textContent = 'TO BE CONTINUED';
      layer.appendChild(a);
      setTimeout(cb, reduce ? 300 : 1700);
    },

    // Run fn, then follow the link. Used to put a dramatic beat before page changes.
    beforeNav: function (link, fn, delay) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var href = link.getAttribute('href');
        fn(function () { location.href = href; });
        if (delay != null) setTimeout(function () { location.href = href; }, reduce ? 150 : delay);
      });
    }
  };

  window.FX = FX;
})();

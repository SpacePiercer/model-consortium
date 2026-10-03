/*
 * Prompt Colosseum — arena renderer
 * Draws the PS1-style colosseum into a 320x180 canvas (scale it up with
 * `image-rendering: pixelated`). Low-poly stands, cardboard-cutout crowd,
 * the four cut-out emperors (emperors.js) in a Red Room lodge, gladiators at typewriters,
 * then an ordered-dither colour crush.
 *
 * Usage:
 *   const arena = ArenaEngine.create(canvasEl, {
 *     mode: 'battle',          // 'lobby' | 'battle' | 'verdict'
 *     stations: true,          // draw the two gladiator desks
 *     typing: 'p1',            // battle: who is typing ('p1' | 'p2' | 'both' | null)
 *     loser: null,             // verdict: 'p1' | 'p2'
 *     votes: null,             // verdict: per emperor 'p1' | 'p2' | 'tie'
 *     mood: null,              // emperors' faces: 'neutral' | 'happy' | 'mad'; null = neutral, except in
 *                              //   the verdict: 'mad' when p1 (the local player) lost, 'happy' when p2 lost
 *     seated: [1, 1, 1, 1],    // unused: the four emperors are one cut-out image
 *     hype: 0,                 // 0..1 crowd excitement
 *     depth: 4,                // colour bits per channel after dithering (2..6)
 *     tv: tvCanvasEl,          // optional 144x108 canvas for the CRT
 *     tvMode: 'offering'       // 'offering' (painted placeholder) | 'static'
 *   });
 *   arena.set({ depth: 3 });   // change options live
 *   arena.stop();
 */
(function (root) {
  'use strict';
  var W = 320, H = 180;

  function mk(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function noiseField(w, h, amp, seed) {
    var a = new Float32Array(w * h), s = seed >>> 0;
    for (var i = 0; i < w * h; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      a[i] = (s / 4294967296 - 0.5) * amp;
    }
    return a;
  }

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function dither(ctx, w, h, bits, noise, vig, jit) {
    var Lv = (1 << bits) - 1;
    var img = ctx.getImageData(0, 0, w, h), d = img.data, N = w * h;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, o = i * 4;
        var t = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        var n = noise[i] + noise[(i + jit * 97) % N] * 0.3;
        var v = vig ? vig[i] : 1;
        for (var k = 0; k < 3; k++) {
          var q = Math.floor((d[o + k] + n) * v * Lv / 255 + t);
          if (q < 0) q = 0; else if (q > Lv) q = Lv;
          d[o + k] = q * 255 / Lv;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  var ASSETS = null;
  function assets() {
    if (ASSETS) return ASSETS;
    var A = {};
    A.noise = noiseField(W, H, 20, 1234567);
    A.vig = new Float32Array(W * H);
    for (var i = 0; i < W * H; i++) {
      var vx = (i % W) / W - 0.5, vy = Math.floor(i / W) / H - 0.5;
      A.vig[i] = Math.max(0.25, 1 - (vx * vx * 0.8 + vy * vy * 1.0) * 0.95);
    }
    var s = 99;
    var rnd = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var robes = ['#D8CCB0', '#C9B48A', '#E8E0CC', '#8A2A2A', '#B8892E', '#7E6A4E', '#6B3A6E', '#4E5A3A', '#A84A2C', '#BFB49A'];
    var hides = [['#7A5232', '#4E321C', '#A47A52'], ['#5E3E24', '#3A2414', '#86603E'], ['#8E8A86', '#5E5A58', '#C2BEB8'], ['#9A7048', '#6A4A2C', '#C49A6A']];
    var skins = ['#E0B48C', '#C08A60', '#8E5A3A', '#5E3A26', '#F0C8A0', '#B07850'];
    var hairs = ['#1a120c', '#3a2416', '#6a4a2a', '#C9B48A', '#2a2a2a', '#8a2a1a', '#D8D4C8'];
    var flags = ['#C0202A', '#E0B040', '#6B2070', '#EDE6D6', '#2A5A8A'];
    A.sprites = [];
    for (var v = 0; v < 24; v++) {
      var sk = pick(skins), hr = pick(hairs), fl = pick(flags);
      var kind = rnd() < 0.3 ? 'hide' : rnd() < 0.5 ? 'robe' : 'tunic';
      var hd = pick(hides), cl = kind === 'hide' ? hd[0] : pick(robes);
      var hood = kind === 'robe' && rnd() < 0.3, hasFlag = rnd() < 0.2, frames = [];
      for (var fr = 0; fr < 2; fr++) {
        var c = mk(7, 13), x = c.getContext('2d');
        var px = (function (xc) { return function (col, xx, yy) { xc.fillStyle = col; xc.fillRect(xx, yy, 1, 1); }; })(x);
        px(hood ? cl : hr, 3, 3); px(hood ? cl : hr, 4, 3);
        px(sk, 3, 4); px(sk, 4, 4); px(sk, 3, 5); px(sk, 4, 5);
        if (hood) { px(cl, 2, 4); px(cl, 5, 4); }
        if (kind === 'robe') {
          // ankle-length robe, darker fold down the middle
          for (var yr = 6; yr <= 12; yr++) for (var xr = 2; xr <= 5; xr++) px(cl, xr, yr);
          for (var yf = 8; yf <= 12; yf++) px('rgba(0,0,0,0.25)', 3, yf);
        } else if (kind === 'tunic') {
          // knee-length tunic, rope belt, bare legs
          for (var yt = 6; yt <= 10; yt++) for (var xt = 2; xt <= 5; xt++) px(cl, xt, yt);
          for (var xb = 2; xb <= 5; xb++) px('#4a3020', xb, 8);
          px(sk, 2, 11); px(sk, 5, 11); px('#3a2414', 2, 12); px('#3a2414', 5, 12);
        } else {
          // pelt over one shoulder, mottled, the other shoulder bare
          for (var yh = 6; yh <= 10; yh++) for (var xh = 2; xh <= 5; xh++) px((xh + yh) % 3 ? hd[0] : hd[(xh * yh) % 2 ? 1 : 2], xh, yh);
          px(sk, 5, 6); px(hd[1], 2, 10); px(hd[1], 4, 10);
          px(sk, 2, 11); px(sk, 5, 11); px('#3a2414', 2, 12); px('#3a2414', 5, 12);
        }
        var arm = kind === 'robe' ? cl : sk;
        if (hasFlag) {
          for (var yp = 0; yp <= 9; yp++) px('#4a3020', 0, yp);
          var fy = fr ? 1 : 0;
          px(fl, 1, fy); px(fl, 2, fy); px(fl, 1, fy + 1); px(fl, 2, fy + 1); px(fl, 1, fy + 2);
          px(sk, 1, 6); px(arm, 1, 7);
          if (fr) { px(sk, 6, 3); px(sk, 6, 4); px(arm, 6, 5); px(arm, 6, 6); }
          else { px(arm, 6, 6); px(arm, 6, 7); px(sk, 6, 8); }
        } else if (fr) {
          px(sk, 1, 3); px(sk, 1, 4); px(arm, 1, 5); px(arm, 1, 6);
          px(sk, 6, 3); px(sk, 6, 4); px(arm, 6, 5); px(arm, 6, 6);
        } else {
          px(arm, 1, 6); px(arm, 1, 7); px(sk, 1, 8);
          px(arm, 6, 6); px(arm, 6, 7); px(sk, 6, 8);
        }
        frames.push(c);
      }
      A.sprites.push(frames);
    }
    A.petals = [];
    for (var p = 0; p < 46; p++) {
      A.petals.push({ x: rnd() * 14 - 7, z: -6 + rnd() * 8, y0: rnd() * 9, sp: 0.35 + rnd() * 0.5, ph: rnd() * 6.28, c: rnd() < 0.7 ? '#B0202A' : '#E8D6B0' });
    }
    A.blood = [];
    for (var b = 0; b < 16; b++) A.blood.push({ vx: 10 + rnd() * 26, vy: -(12 + rnd() * 24), d: rnd() * 0.3 });

    // Sleeve and hand colours for the vote arms, left to right (Amodei, Altman, Zuckerberg, Musk).
    A.emps = [
      { sleeve: '#E8E0D0', arm: '#C9946E' },
      { sleeve: '#7A5236', arm: '#F0C4A8' },
      { sleeve: '#9A9894', arm: '#EEC8B0' },
      { sleeve: '#3A2230', arm: '#E6BC9C' }
    ];
    ASSETS = A;
    return A;
  }

  // ---- emperors ----
  // One cut-out group from emperors.js, standing on the box ledge, centred on the lodge.
  // To sit in the arena it gets an ink outline, a drop shadow on the curtain, torchlight from
  // the left, a contact shadow at the ledge and the arena's ordered dither.
  var GROUP_CX = 160, PAD = 6;

  function tone(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + Math.min(255, Math.round((n >> 16 & 255) * k)) + ',' + Math.min(255, Math.round((n >> 8 & 255) * k)) + ',' + Math.min(255, Math.round((n & 255) * k)) + ')';
  }

  // The poses: the neutral group at the top level of EMPERORS plus any in EMPERORS.moods.
  function emperorPoses() {
    var d = root.EMPERORS, out = { neutral: d };
    Object.keys(d.moods || {}).forEach(function (k) { out[k] = d.moods[k]; });
    return out;
  }

  function emperorMood(o) {
    if (o.mood) return o.mood;
    if (o.mode === 'verdict' && o.loser) return o.loser === 'p1' ? 'mad' : 'happy';
    return 'neutral';
  }

  // Overlay box in arena pixels, sized to the tallest pose; every pose stands on the ledge.
  function emperorBox(parTop) {
    var d = root.EMPERORS, t = d.texel, poses = emperorPoses(), h = 0;
    Object.keys(poses).forEach(function (k) { h = Math.max(h, poses[k].h); });
    var x0 = GROUP_CX - d.w / t / 2 - PAD / t;
    return { x0: x0, y0: parTop - (h + PAD) / t, w: d.w + PAD * 2, h: h + PAD, t: t };
  }

  function drawEmperors(ov, imgs, o) {
    var A = assets(), d = root.EMPERORS, poses = emperorPoses();
    var ctx = ov.getContext('2d', { willReadFrequently: true });
    if (!ctx || !d) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ov.width, ov.height);
    var mood = emperorMood(o);
    if (!poses[mood] || !imgs[mood] || !imgs[mood].naturalWidth) mood = 'neutral';
    var img = imgs[mood], pose = poses[mood];
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.imageSmoothingEnabled = false;
    var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    var W2 = ov.width, H2 = ov.height;
    var gx = PAD + Math.round(mean(d.faces) - mean(pose.faces)), gy = H2 - pose.h;   // heads stay over the plates

    var sil = document.createElement('canvas'); sil.width = W2; sil.height = H2;
    var sc = sil.getContext('2d');
    var silhouette = function (col) {
      sc.globalCompositeOperation = 'source-over'; sc.clearRect(0, 0, W2, H2);
      sc.drawImage(img, gx, gy);
      sc.globalCompositeOperation = 'source-in'; sc.fillStyle = col; sc.fillRect(0, 0, W2, H2);
      return sil;
    };
    ctx.globalAlpha = 0.5; ctx.drawImage(silhouette('#0a0002'), 4, 3); ctx.globalAlpha = 1;   // shadow on the curtain
    silhouette('#140806');
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (q) { ctx.drawImage(sil, q[0], q[1]); });   // ink outline
    ctx.drawImage(img, gx, gy);

    ctx.globalCompositeOperation = 'source-atop';
    var g = ctx.createLinearGradient(0, 0, W2, 0);
    g.addColorStop(0, 'rgba(255,170,90,0.22)'); g.addColorStop(0.45, 'rgba(255,170,90,0)');
    g.addColorStop(0.7, 'rgba(40,0,10,0)'); g.addColorStop(1, 'rgba(40,0,10,0.3)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    g = ctx.createLinearGradient(0, H2 * 0.7, 0, H2);
    g.addColorStop(0, 'rgba(12,2,2,0)'); g.addColorStop(1, 'rgba(12,2,2,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    ctx.globalCompositeOperation = 'source-over';

    if (o.votes) {
      // a small thumbs-up beside each head, on the favoured gladiator's side (texel units)
      A.emps.forEach(function (e, ei) {
        var v = o.votes[ei];
        if (v !== 'p1' && v !== 'p2') return;
        var s2 = v === 'p1' ? -1 : 1, x = Math.round(gx + pose.faces[ei] + s2 * 16) - 4, y = Math.round(H2 * 0.5);
        var R = function (x1, y1, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x1, y1, w, h); };
        R(x - 1, y - 1, 10, 9, '#140806'); R(x + 1, y - 7, 4, 7, '#140806');      // outline
        R(x, y, 8, 7, e.arm); R(x + 2, y - 6, 2, 6, tone(e.arm, 1.12));          // fist, thumb
        R(x, y + 2, 8, 1, tone(e.arm, 0.75)); R(x, y + 4, 8, 1, tone(e.arm, 0.75));
        R(x - 1, y + 7, 10, 3, '#140806'); R(x, y + 7, 8, 2, e.sleeve);          // cuff
      });
    }
    if (!A.empNoise || A.empNoise.length !== W2 * H2) A.empNoise = noiseField(W2, H2, 20, 4242);
    dither(ctx, W2, H2, Math.max(2, Math.min(6, Math.round(o.depth || 4))), A.empNoise, null, 0);
  }

  function paintOffering(c) {
    var ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    var sx = c.width / 128, sy = c.height / 96;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    var w = 128, h = 96, s = 7;
    var rnd = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    var g = ctx.createLinearGradient(0, 0, 0, 58);
    g.addColorStop(0, '#05070f'); g.addColorStop(0.6, '#1c1a3a'); g.addColorStop(1, '#40263f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, 58);
    g = ctx.createRadialGradient(92, 24, 2, 92, 24, 34);
    g.addColorStop(0, 'rgba(255,120,80,0.55)'); g.addColorStop(1, 'rgba(255,80,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, 62);
    ctx.fillStyle = '#e8603c'; ctx.beginPath(); ctx.arc(92, 24, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,190,140,0.45)'; ctx.beginPath(); ctx.arc(89, 21, 4, 0, Math.PI * 2); ctx.fill();
    g = ctx.createLinearGradient(0, 58, 0, h);
    g.addColorStop(0, '#161c30'); g.addColorStop(1, '#03050b');
    ctx.fillStyle = g; ctx.fillRect(0, 58, w, h - 58);
    for (var k = 0; k < 46; k++) {
      ctx.fillStyle = 'rgba(120,140,175,' + (0.1 + rnd() * 0.2).toFixed(2) + ')';
      ctx.fillRect(Math.floor(rnd() * w), 60 + Math.floor(rnd() * 36), 2 + Math.floor(rnd() * 7), 1);
    }
    for (var y = 60; y < 94; y += 2) {
      var rw = 3 + rnd() * 7;
      ctx.fillStyle = 'rgba(232,96,60,' + (0.75 * (1 - (y - 60) / 40)).toFixed(2) + ')';
      ctx.fillRect(Math.round(92 - rw / 2 + (rnd() - 0.5) * 3), y, Math.round(rw), 1);
    }
    ctx.fillStyle = 'rgba(255,222,150,0.16)';
    ctx.beginPath(); ctx.moveTo(30, 27); ctx.lineTo(-12, 10); ctx.lineTo(-12, 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#07080a';
    ctx.beginPath(); ctx.moveTo(10, 66); ctx.lineTo(16, 57); ctx.lineTo(24, 55); ctx.lineTo(40, 56); ctx.lineTo(47, 61); ctx.lineTo(50, 68); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(24, 57); ctx.lineTo(36, 57); ctx.lineTo(34, 29); ctx.lineTo(26, 29); ctx.closePath(); ctx.clip();
    g = ctx.createLinearGradient(24, 0, 36, 0);
    g.addColorStop(0, '#8a8478'); g.addColorStop(0.45, '#e6dfcf'); g.addColorStop(1, '#6e695f');
    ctx.fillStyle = g; ctx.fillRect(20, 28, 20, 30);
    ctx.fillStyle = 'rgba(176,40,30,0.85)'; ctx.fillRect(20, 35, 20, 5); ctx.fillRect(20, 46, 20, 5);
    ctx.restore();
    ctx.fillStyle = '#121212'; ctx.fillRect(25, 27, 10, 2);
    ctx.fillStyle = '#ffd890'; ctx.fillRect(27, 22, 6, 5);
    ctx.fillStyle = '#121212';
    ctx.beginPath(); ctx.moveTo(25, 22); ctx.lineTo(35, 22); ctx.lineTo(30, 17); ctx.closePath(); ctx.fill();
    g = ctx.createRadialGradient(30, 24, 1, 30, 24, 12);
    g.addColorStop(0, 'rgba(255,220,140,0.6)'); g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g; ctx.fillRect(14, 10, 32, 30);
    ctx.fillStyle = '#0a0706';
    ctx.beginPath(); ctx.moveTo(58, 75); ctx.lineTo(77, 75); ctx.lineTo(74, 79); ctx.lineTo(61, 79); ctx.closePath(); ctx.fill();
    ctx.fillRect(67, 58, 1, 17);
    ctx.fillStyle = '#cbbfa6';
    ctx.beginPath(); ctx.moveTo(68, 59); ctx.lineTo(68, 73); ctx.lineTo(76, 73); ctx.closePath(); ctx.fill();
    g = ctx.createLinearGradient(0, 50, 0, 68);
    g.addColorStop(0, 'rgba(160,160,185,0)'); g.addColorStop(0.5, 'rgba(160,160,185,0.13)'); g.addColorStop(1, 'rgba(160,160,185,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 50, w, 18);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    dither(ctx, c.width, c.height, 4, noiseField(c.width, c.height, 30, 4242), null, 0);
  }

  function paintStatic(c, T) {
    var ctx = c.getContext('2d');
    if (!ctx) return;
    var w = c.width, h = c.height;
    var img = ctx.createImageData(w, h), d = img.data;
    var s = ((T * 1000) | 0) + 1;
    var bar = ((T * 40) % (h + 24)) - 12;
    for (var i = 0; i < w * h; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      var v = (s >>> 24) * 0.62, y = (i / w) | 0;
      if (Math.abs(y - bar) < 7) v = Math.min(255, v + 55);
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = Math.min(255, v * 1.08); d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function draw(canvas, T, o) {
    var A = assets();
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    var f = 150, cx = 160, cy = 104, camY = 1.2, camZ = 5;
    var P = function (x, y, z) { var d = camZ - z; return [cx + f * x / d, cy - f * (y - camY) / d]; };
    var EA = 11, EB = 7;
    var Q = function (s, y, th) { return P(EA * s * Math.cos(th), y, EB * s * Math.sin(th)); };
    var dep = function (s, th) { return camZ - EB * s * Math.sin(th); };
    var HAZE = [70, 40, 42];
    var rgb = function (a, sh, t) {
      var r = a[0] * sh, g2 = a[1] * sh, b = a[2] * sh;
      return 'rgb(' + Math.round(r + (HAZE[0] - r) * t) + ',' + Math.round(g2 + (HAZE[1] - g2) * t) + ',' + Math.round(b + (HAZE[2] - b) * t) + ')';
    };
    var fill = function (pts, col) {
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var q = pts[i];
        if (i) ctx.lineTo(Math.round(q[0]), Math.round(q[1])); else ctx.moveTo(Math.round(q[0]), Math.round(q[1]));
      }
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 0.5; ctx.stroke();
    };
    var flick = 0.8 + 0.2 * Math.sin(T * 11.3) * Math.sin(T * 6.7);
    var glows = [], eyes = [];
    var hype = o.hype || 0;

    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createLinearGradient(0, 0, 0, 110);
    g.addColorStop(0, '#120a18'); g.addColorStop(0.5, '#3b1d2a'); g.addColorStop(1, '#8a4a2c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 110);
    ctx.fillStyle = 'rgba(30,14,24,0.7)';
    ctx.fillRect(0, 8, 120, 3); ctx.fillRect(190, 14, 130, 2); ctx.fillRect(60, 22, 90, 2);
    g = ctx.createLinearGradient(0, 100, 0, H);
    g.addColorStop(0, '#9a7a4e'); g.addColorStop(1, '#5a4028');
    ctx.fillStyle = g; ctx.fillRect(0, 100, W, H - 100);
    ctx.strokeStyle = 'rgba(40,24,12,0.18)'; ctx.lineWidth = 1;
    for (var rx = -10; rx <= 10; rx += 1.6) {
      var r0 = P(rx, 0, -7), r1 = P(rx * 1.6, 0, 3.5);
      ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
    }

    // ---- stands ----
    var N = 40, NT = 7;
    var sK = function (k) { return 1.04 + k * 0.07; }, yK = function (k) { return 1.6 + k * 0.72; };
    var SW = 1.53, YW0 = yK(NT), YW1 = 9.4, YW2 = 10.2;
    var segs = [];
    for (var si = 0; si < N; si++) {
      var a0 = (si / N) * Math.PI * 2, b0 = ((si + 1) / N) * Math.PI * 2;
      if (Math.min(dep(1, a0), dep(1, b0), dep(SW, a0), dep(SW, b0)) < 1.4) continue;
      var pa = Q(SW, 6, a0), pb = Q(SW, 6, b0);
      if ((pa[0] < -90 && pb[0] < -90) || (pa[0] > 410 && pb[0] > 410)) continue;
      segs.push({ i: si, a: a0, b: b0, d: dep(1.25, (a0 + b0) / 2) });
    }
    segs.sort(function (p, q) { return q.d - p.d; });
    var STONE = [178, 142, 102], MARBLE = [206, 188, 160];
    var cheerThr = 0.55 - 0.5 * hype;
    segs.forEach(function (sg) {
      var a = sg.a, b = sg.b, m = (a + b) / 2;
      var sh = Math.max(0.42, 0.56 + 0.44 * (-Math.cos(m) * 0.8 - Math.sin(m) * 0.6));
      var ht = Math.min(0.55, Math.max(0, (sg.d - 8) / 16));
      var lerp = function (u) { return a + (b - a) * u; };
      fill([Q(SW, YW0, a), Q(SW, YW0, b), Q(SW, YW1, b), Q(SW, YW1, a)], rgb(STONE, sh * 0.82, ht));
      fill([Q(SW, 7.0, lerp(0.28)), Q(SW, 7.0, lerp(0.72)), Q(SW, 8.7, lerp(0.72)), Q(SW, 9.05, lerp(0.5)), Q(SW, 8.7, lerp(0.28))], rgb([60, 26, 40], 1, ht * 0.5));
      fill([Q(SW, YW1, a), Q(SW, YW1, b), Q(SW, YW2, b), Q(SW, YW2, a)], rgb(STONE, sh * 0.7, ht));
      if (sg.i % 2 === 0) fill([Q(SW, 9.6, lerp(0.4)), Q(SW, 9.6, lerp(0.6)), Q(SW, 10.0, lerp(0.6)), Q(SW, 10.0, lerp(0.4))], 'rgb(30,16,20)');
      if (sg.i % 5 === 0) {
        var bw = Math.sin(T * 1.3 + sg.i) * 0.006;
        fill([Q(SW - 0.01, YW1, lerp(0.38)), Q(SW - 0.01, YW1, lerp(0.62)), Q(SW - 0.01, 7.3, lerp(0.62) + bw), Q(SW - 0.01, 7.0, lerp(0.5) + bw), Q(SW - 0.01, 7.3, lerp(0.38) + bw)], rgb([150, 26, 30], sh, ht));
      }
      for (var k = NT - 1; k >= 0; k--) {
        var tone = (k % 2 ? 0.86 : 1) * (0.78 + k * 0.03);
        fill([Q(sK(k), yK(k), a), Q(sK(k), yK(k), b), Q(sK(k + 1), yK(k + 1), b), Q(sK(k + 1), yK(k + 1), a)], rgb(STONE, sh * tone, ht));
        var sm = (sK(k) + sK(k + 1)) / 2, ym = (yK(k) + yK(k + 1)) / 2;
        for (var j = 0; j < 3; j++) {
          var hh = (Math.imul(sg.i + 1, 73856093) ^ Math.imul(k + 1, 19349663) ^ Math.imul(j + 1, 83492791)) >>> 0;
          if (hh % 13 === 0) continue;
          var th = lerp((j + 0.5) / 3 + ((hh >>> 16) % 100) / 1000 - 0.05);
          var bp = Q(sm, ym, th);
          var sc = (f / dep(sm, th)) / 10.5;
          var ph = ((hh >>> 8) % 628) / 100;
          var wv = ((th - T * 0.9) % 6.2832 + 6.2832) % 6.2832;
          var up = wv < 0.45 || Math.sin(T * (2.6 + (hh % 3) + hype * 2) + ph) > cheerThr ? 1 : 0;
          var spr = A.sprites[hh % A.sprites.length][up];
          var sw2 = Math.max(1, Math.round(7 * sc)), sh2 = Math.max(1, Math.round(13 * sc));
          ctx.globalAlpha = 1 - ht * 0.6;
          ctx.drawImage(spr, Math.round(bp[0] - sw2 / 2), Math.round(bp[1] - sh2 * 0.92 - up * sc), sw2, sh2);
          ctx.globalAlpha = 1;
        }
      }
      fill([Q(1, 0, a), Q(1, 0, b), Q(1, 1.6, b), Q(1, 1.6, a)], rgb(MARBLE, sh * 0.9, ht));
      fill([Q(1, 1.45, a), Q(1, 1.45, b), Q(1, 1.6, b), Q(1, 1.6, a)], rgb(MARBLE, sh * 1.12, ht));
      if (sg.i % 6 === 3) fill([Q(1, 0, lerp(0.3)), Q(1, 0, lerp(0.7)), Q(1, 1.0, lerp(0.7)), Q(1, 1.2, lerp(0.5)), Q(1, 1.0, lerp(0.3))], 'rgb(18,10,10)');
      if (sg.i % 4 === 1) {
        var tb = Q(1.0, 1.6, a), tt = Q(1.0, 2.3, a);
        ctx.strokeStyle = 'rgb(40,26,16)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(tb[0]) + 0.5, Math.round(tb[1])); ctx.lineTo(Math.round(tt[0]) + 0.5, Math.round(tt[1])); ctx.stroke();
        ctx.fillStyle = flick > 0.9 ? '#FFD27A' : '#E8862E';
        ctx.fillRect(Math.round(tt[0]) - 1, Math.round(tt[1]) - 2, 2, 2);
        glows.push([tt[0], tt[1] - 1, 18 * f / sg.d / 12]);
      }
    });

    var sails = [];
    segs.forEach(function (sg) {
      if (sg.i % 2 || Math.sin((sg.a + sg.b) / 2) > -0.2) return;
      var a = sg.a, b = sg.a + (Math.PI * 4) / N, m = (a + b) / 2;
      sails.push({ d: sg.d, pts: [Q(SW, YW2, a), Q(SW, YW2, b), Q(1.25, 11.2, m)], c: sg.i % 4 ? [205, 186, 148] : [150, 40, 34] });
    });
    sails.sort(function (p, q) { return q.d - p.d; });
    sails.forEach(function (sl) { fill(sl.pts, rgb(sl.c, 0.9, 0.25)); });

    var BC = -Math.PI / 2;
    [-0.13, 0.13].forEach(function (dx) {
      var th = BC + dx, wd = 0.035, bw = Math.sin(T * 1.1 + dx * 30) * 0.004;
      fill([Q(1.49, 10.0, th - wd), Q(1.49, 10.0, th + wd), Q(1.49, 6.4, th + wd + bw), Q(1.49, 5.9, th + bw), Q(1.49, 6.4, th - wd + bw)], 'rgb(92,24,74)');
      fill([Q(1.488, 9.7, th - wd), Q(1.488, 9.7, th + wd), Q(1.488, 9.5, th + wd), Q(1.488, 9.5, th - wd)], 'rgb(220,170,64)');
    });

    // ---- imperial lodge ----
    var bx = 5.5, zF = -7.6, zB = -8.9;
    fill([P(-bx, 1.6, zB), P(bx, 1.6, zB), P(bx, 6.0, zB), P(-bx, 6.0, zB)], 'rgb(128,12,16)');
    ctx.fillStyle = 'rgba(40,0,6,0.55)';
    for (var fx = -bx + 0.45; fx < bx; fx += 0.9) {
      var f0 = P(fx, 6.0, zB), f1 = P(fx + 0.14, 1.6, zB);
      ctx.fillRect(Math.round(f0[0]), Math.round(f0[1]), Math.max(1, Math.round(f1[0] - f0[0])), Math.round(f1[1] - f0[1]));
    }
    fill([P(-bx, 1.6, zF), P(-bx, 1.6, zB), P(-bx, 6.0, zB), P(-bx, 6.0, zF)], 'rgb(90,8,12)');
    fill([P(bx, 1.6, zF), P(bx, 1.6, zB), P(bx, 6.0, zB), P(bx, 6.0, zF)], 'rgb(90,8,12)');

    var parTop = Math.round(P(0, 2.5, zF)[1]);
    A.parTop = parTop;

    fill([P(-5.7, 1.6, zF), P(5.7, 1.6, zF), P(5.7, 2.5, zF), P(-5.7, 2.5, zF)], 'rgb(196,178,148)');
    fill([P(-5.8, 2.42, zF + 0.05), P(5.8, 2.42, zF + 0.05), P(5.8, 2.56, zF + 0.05), P(-5.8, 2.56, zF + 0.05)], 'rgb(232,220,196)');
    fill([P(-5.7, 1.6, zF + 0.02), P(5.7, 1.6, zF + 0.02), P(5.7, 1.68, zF + 0.02), P(-5.7, 1.68, zF + 0.02)], 'rgb(120,104,82)');
    // zigzag Red Room floor on the parapet
    var pv0 = P(-5.7, 2.5, zF), pv1 = P(5.7, 1.6, zF);
    ctx.save();
    ctx.beginPath(); ctx.rect(pv0[0], pv0[1] + 1, pv1[0] - pv0[0], pv1[1] - pv0[1] - 1); ctx.clip();
    ctx.fillStyle = '#EDE6D6'; ctx.fillRect(pv0[0], pv0[1], pv1[0] - pv0[0], pv1[1] - pv0[1]);
    ctx.strokeStyle = '#0c0808'; ctx.lineWidth = 1.6;
    for (var zy = pv0[1] - 4; zy < pv1[1] + 4; zy += 4) {
      ctx.beginPath();
      for (var zx = pv0[0]; zx <= pv1[0] + 4; zx += 4) ctx.lineTo(zx, zy + (Math.round((zx - pv0[0]) / 4) % 2 ? 2 : 0));
      ctx.stroke();
    }
    ctx.restore();
    [-5.45, 5.45].forEach(function (cxw) {
      fill([P(cxw - 0.16, 2.5, zF), P(cxw + 0.16, 2.5, zF), P(cxw + 0.16, 6.0, zF), P(cxw - 0.16, 6.0, zF)], 'rgb(214,198,170)');
      fill([P(cxw - 0.26, 5.82, zF), P(cxw + 0.26, 5.82, zF), P(cxw + 0.26, 6.05, zF), P(cxw - 0.26, 6.05, zF)], 'rgb(230,214,180)');
    });
    var cz0 = -7.4, cz1 = -9.0, cw = 5.9;
    for (var ck = 0; ck < 10; ck++) {
      var x0 = -cw + (ck * 2 * cw) / 10, x1 = -cw + ((ck + 1) * 2 * cw) / 10;
      fill([P(x0, 6.0, cz0), P(x1, 6.0, cz0), P(x1, 6.5, cz1), P(x0, 6.5, cz1)], ck % 2 ? 'rgb(206,156,60)' : 'rgb(110,26,84)');
    }
    for (var fk = 0; fk < 20; fk++) {
      var y0 = -cw + (fk * 2 * cw) / 20, y1 = -cw + ((fk + 1) * 2 * cw) / 20;
      fill([P(y0, 6.0, cz0), P(y1, 6.0, cz0), P((y0 + y1) / 2, 5.65, cz0)], 'rgb(220,176,70)');
    }
    [-cw, 0, cw].forEach(function (cxw) {
      fill([P(cxw - 0.14, 6.0, cz0), P(cxw + 0.14, 6.0, cz0), P(cxw, 6.8, cz0)], 'rgb(240,200,80)');
    });

    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createLinearGradient(0, 20, 0, 110);
    g.addColorStop(0, 'rgba(120,50,30,0)'); g.addColorStop(1, 'rgba(120,60,36,0.16)');
    ctx.fillStyle = g; ctx.fillRect(0, 20, W, 90);
    glows.forEach(function (gl) {
      var r = Math.max(4, gl[2]);
      var gg = ctx.createRadialGradient(gl[0], gl[1], 0, gl[0], gl[1], r);
      gg.addColorStop(0, 'rgba(255,150,60,' + (0.42 * flick).toFixed(2) + ')'); gg.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = gg; ctx.fillRect(gl[0] - r, gl[1] - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = 'source-over';

    // ---- gladiator stations ----
    if (o.stations) {
      var G = function (pts, col, mir) { fill(pts.map(function (p) { return [mir ? W - p[0] : p[0], p[1]]; }), col); };
      var L = function (x1, y1, x2, y2, col, mir) {
        var a1 = mir ? W - x1 : x1, a2 = mir ? W - x2 : x2;
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(a1) + 0.5, Math.round(y1) + 0.5); ctx.lineTo(Math.round(a2) + 0.5, Math.round(y2) + 0.5); ctx.stroke();
      };
      var O = function (x, y, r, col, mir) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mir ? W - x : x, y, r, 0, Math.PI * 2); ctx.fill(); };
      var PX = function (x, y, col, mir) { ctx.fillStyle = col; ctx.fillRect(mir ? W - 1 - x : x, y, 1, 1); };

      var station = function (mir, plume, plumeDk, eye, pose) {
        var hx = 0, hy = Math.sin(T * 1.7 + (mir ? 2 : 0)) > 0.6 ? 1 : 0;
        if (pose === 'hit') { hx = -2; hy = 2 + (Math.sin(T * 9) > 0.7 ? 1 : 0); }
        var dy = pose === 'typing' && Math.sin(T * 17 + (mir ? 1 : 0)) > 0.1 ? 1 : 0;
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.beginPath(); ctx.ellipse(mir ? W - 66 : 66, 179, 64, 3, 0, 0, Math.PI * 2); ctx.fill();

        G([[1, 141], [9, 139], [10, 177], [2, 179]], '#7E2418', mir);
        L(2, 142, 9, 140, '#C9A040', mir); L(2, 177, 9, 175, '#C9A040', mir);
        O(5.5, 159, 2.5, '#C9A040', mir);
        G([[8, 150], [30, 150], [30, 154], [8, 154]], '#4a3020', mir);
        G([[10, 154], [12, 154], [12, 180], [10, 180]], '#3a2416', mir);
        G([[26, 154], [28, 154], [28, 180], [26, 180]], '#3a2416', mir);
        G([[25, 149], [41, 150], [41, 156], [25, 156]], '#C08A60', mir);
        G([[37, 153], [42, 153], [41, 172], [36, 172]], '#B8892E', mir);
        L(40, 154, 40, 171, '#E0B860', mir);
        G([[34, 172], [45, 172], [46, 176], [34, 176]], '#3a2414', mir);
        G([[9, 145], [28, 145], [32, 154], [7, 155]], '#8E2A1E', mir);
        [12, 16, 20, 24].forEach(function (sx) { L(sx, 147, sx + 1, 154, '#5a160e', mir); });
        G([[11, 146], [25, 146], [30, 124], [15, 121]], '#C08A60', mir);
        G([[11, 146], [16, 146], [19, 123], [15, 121]], '#8E5A3A', mir);
        G([[10, 140], [28, 139], [27, 146], [10, 147]], '#7A5420', mir);
        G([[22, 141], [25, 141], [25, 144], [22, 144]], '#E0B860', mir);
        var hd = function (pts) { return pts.map(function (p) { return [p[0] + hx, p[1] + hy]; }); };
        G([[21, 114 + hy], [27, 114 + hy], [27, 121], [21, 121]], '#8E5A3A', mir);
        G(hd([[13, 104], [16, 95], [24, 90], [32, 92], [35, 97], [31, 101], [16, 104]]), plume, mir);
        L(17 + hx, 102 + hy, 20 + hx, 94 + hy, plumeDk, mir); L(21 + hx, 101 + hy, 25 + hx, 92 + hy, plumeDk, mir); L(25 + hx, 100 + hy, 30 + hx, 93 + hy, plumeDk, mir);
        G(hd([[15, 103], [31, 99], [32, 101], [16, 105]]), '#C9A040', mir);
        G(hd([[14, 111], [17, 103], [25, 100], [32, 104], [34, 110], [34, 116], [16, 118]]), '#B8892E', mir);
        G(hd([[14, 111], [17, 103], [20, 102], [19, 117], [16, 118]]), '#8A6A24', mir);
        G(hd([[12, 116], [36, 113], [37, 117], [11, 120]]), '#8A6A24', mir);
        G(hd([[28, 105], [34, 107], [34, 115], [28, 115]]), '#1a1208', mir);
        L(30 + hx, 106 + hy, 30 + hx, 115 + hy, '#C9A040', mir); L(32 + hx, 107 + hy, 32 + hx, 115 + hy, '#C9A040', mir); L(28 + hx, 110 + hy, 34 + hx, 110 + hy, '#C9A040', mir);
        var eyesOn = pose !== 'hit' || Math.sin(T * 23) > 0.6;
        if (eyesOn) {
          var ec = 'rgb(' + eye.join(',') + ')';
          PX(31 + hx, 108 + hy, ec, mir); PX(33 + hx, 108 + hy, ec, mir);
          eyes.push([mir ? W - 32 - hx : 32 + hx, 108.5 + hy, eye, 4.5]);
        }
        G([[19, 117], [31, 119], [31, 127], [23, 126]], '#B8892E', mir);

        G([[30, 147], [126, 147], [128, 151], [28, 151]], '#8A5A30', mir);
        L(30, 147, 126, 147, '#B07A44', mir);
        G([[28, 151], [128, 151], [128, 158], [28, 158]], '#5A3418', mir);
        L(29, 154, 127, 154, '#3a2010', mir);
        G([[31, 158], [35, 158], [35, 180], [31, 180]], '#4a2a12', mir);
        G([[121, 158], [125, 158], [125, 180], [121, 180]], '#4a2a12', mir);

        G([[42, 138], [98, 137], [101, 147], [40, 147]], '#1c1a1a', mir);
        L(42, 138, 98, 137, '#4a4848', mir);
        G([[40, 147], [42, 138], [56, 138], [56, 147]], '#141212', mir);
        for (var ky = 139; ky <= 145; ky += 2) {
          for (var kx = 43 + ((ky - 139) / 2) % 2; kx <= 54; kx += 2) PX(kx, ky, '#d8d0c0', mir);
        }
        G([[42, 131], [100, 131], [100, 137], [42, 137]], '#2a2828', mir);
        O(39, 134, 2.5, '#0e0c0c', mir); O(102, 134, 2.5, '#0e0c0c', mir);
        O(66, 137, 2, '#4a1010', mir); O(82, 137, 2, '#4a1010', mir);

        if (pose === 'victory') {
          var lift = Math.sin(T * 4) > 0 ? 1 : 0;
          G([[24, 124], [30, 123], [40, 111 - lift], [35, 108 - lift]], '#A8A098', mir);
          L(27, 121, 32, 120, '#6a645c', mir); L(31, 115, 36, 114, '#6a645c', mir);
          G([[35, 108 - lift], [40, 111 - lift], [42, 97 - lift], [38, 96 - lift]], '#C08A60', mir);
          G([[37, 92 - lift], [43, 92 - lift], [43, 97 - lift], [37, 97 - lift]], '#B07850', mir);
          G([[39, 92 - lift], [41, 92 - lift], [41, 74 - lift], [40, 71 - lift], [39, 74 - lift]], '#D8D8E0', mir);
          L(41, 90 - lift, 41, 75 - lift, '#8A8A96', mir);
          G([[36, 91 - lift], [44, 91 - lift], [44, 93 - lift], [36, 93 - lift]], '#C9A040', mir);
        } else if (pose === 'hit') {
          G([[24, 124], [30, 123], [36, 136], [31, 138]], '#A8A098', mir);
          G([[31, 136], [36, 135], [39, 146], [35, 147]], '#C08A60', mir);
          G([[34, 145], [40, 145], [40, 148], [34, 148]], '#B07850', mir);
        } else {
          G([[24, 124], [30, 123], [38, 133], [33, 136]], '#A8A098', mir);
          L(26, 127, 31, 126, '#6a645c', mir); L(29, 130, 34, 129, '#6a645c', mir); L(32, 133, 37, 132, '#6a645c', mir);
          G([[33, 133], [38, 132], [48, 137 + dy], [45, 140 + dy]], '#C08A60', mir);
          G([[44, 137 + dy], [50, 138 + dy], [50, 141 + dy], [44, 141 + dy]], '#B07850', mir);
        }

        if (pose === 'hit') {
          var ox = 30 + hx, oy = 110 + hy;
          A.blood.forEach(function (bd) {
            var t = ((T + bd.d) % 1.6);
            if (t > 1.0) return;
            var bxp = ox - bd.vx * t, byp = oy + bd.vy * t + 55 * t * t;
            if (byp > 178) return;
            PX(Math.round(bxp), Math.round(byp), t < 0.5 ? '#E02020' : '#8A1018', mir);
          });
        }
      };

      var pose1 = 'idle', pose2 = 'idle';
      if (o.mode === 'verdict') {
        pose1 = o.loser === 'p1' ? 'hit' : 'victory';
        pose2 = o.loser === 'p2' ? 'hit' : 'victory';
      } else {
        if (o.typing === 'p1' || o.typing === 'both') pose1 = 'typing';
        if (o.typing === 'p2' || o.typing === 'both') pose2 = 'typing';
      }
      station(false, '#B0202A', '#6E1018', [182, 255, 74], pose1);
      station(true, '#A0206E', '#5A0E3E', [255, 79, 176], pose2);

      if (o.mode === 'verdict' && o.loser) {
        var pulse = 0.1 + 0.1 * Math.max(0, Math.sin(T * 3.2));
        ctx.fillStyle = 'rgba(220,20,20,' + pulse.toFixed(3) + ')';
        ctx.fillRect(o.loser === 'p1' ? 0 : W / 2, 60, W / 2, H - 60);
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    eyes.forEach(function (ey) {
      var cc = ey[2].join(','), r = ey[3];
      var gg = ctx.createRadialGradient(ey[0], ey[1], 0, ey[0], ey[1], r);
      gg.addColorStop(0, 'rgba(' + cc + ',0.65)'); gg.addColorStop(1, 'rgba(' + cc + ',0)');
      ctx.fillStyle = gg; ctx.fillRect(ey[0] - r, ey[1] - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = 'source-over';

    A.petals.forEach(function (p) {
      var y = 9 - ((p.y0 + T * p.sp * (1 + hype)) % 9);
      var x = p.x + Math.sin(T * 0.9 + p.ph) * 0.35;
      var q = P(x, y, p.z);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(q[0]), Math.round(q[1]), Math.sin(T * 3 + p.ph) > 0 ? 2 : 1, 1);
    });

    var bits = Math.max(2, Math.min(6, Math.round(o.depth || 4)));
    dither(ctx, W, H, bits, A.noise, A.vig, Math.floor(T * 20));
  }

  function create(canvas, opts) {
    var st = {
      o: Object.assign({ mode: 'battle', stations: true, typing: 'p1', loser: null, votes: null, seated: [1, 1, 1, 1], hype: 0, depth: 4, tv: null, tvMode: 'offering' }, opts || {}),
      raf: 0, last: 0, alive: true, painted: null
    };
    var paintTv = function () {
      if (st.o.tv && st.o.tvMode === 'offering' && st.painted !== st.o.tv) {
        try { paintOffering(st.o.tv); st.painted = st.o.tv; } catch (e) { /* ignore */ }
      }
    };
    var frame = function (ms) {
      if (!st.alive) return;
      st.raf = requestAnimationFrame(frame);
      if (ms - st.last < 50) return;
      st.last = ms;
      try {
        draw(canvas, ms / 1000, st.o);
        if (st.o.tv && st.o.tvMode === 'static') paintStatic(st.o.tv, ms / 1000);
      } catch (e) { st.alive = false; }
    };
    paintTv();
    try { draw(canvas, 0, st.o); } catch (e) { st.alive = false; }
    if (st.alive && typeof requestAnimationFrame === 'function') st.raf = requestAnimationFrame(frame);

    var ov = null, imgs = {};
    var paintEmperors = function () { if (ov) { try { drawEmperors(ov, imgs, st.o); } catch (e) { /* ignore */ } } };
    if (root.EMPERORS && canvas.parentNode && typeof document !== 'undefined') {
      var A = assets(), k = (canvas.offsetWidth || W) / W, bx = emperorBox(A.parTop);
      ov = document.createElement('canvas');
      ov.width = bx.w; ov.height = bx.h;
      ov.setAttribute('aria-hidden', 'true');
      ov.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;left:' + (canvas.offsetLeft + bx.x0 * k) + 'px;top:' +
        (canvas.offsetTop + bx.y0 * k) + 'px;width:' + (bx.w / bx.t * k) + 'px;height:' + (bx.h / bx.t * k) + 'px';
      canvas.parentNode.insertBefore(ov, canvas.nextSibling);
      var poses = emperorPoses();
      Object.keys(poses).forEach(function (k) {
        var im = new Image(); im.onload = paintEmperors; im.src = poses[k].src; imgs[k] = im;
      });
    }
    return {
      set: function (o) { Object.assign(st.o, o || {}); paintTv(); paintEmperors(); },
      stop: function () { st.alive = false; if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }
    };
  }

  root.ArenaEngine = { create: create, paintOffering: paintOffering, paintStatic: paintStatic };
})(typeof window !== 'undefined' ? window : this);

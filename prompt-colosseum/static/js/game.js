// The game client: the design prototypes (design/*.html) on one page, driven by the socket
// protocol in docs/GAME_SPEC.md. The server decides everything; this sends intents and draws.
(() => {
  const $ = id => document.getElementById(id);
  const SLOTS = ["p1", "p2"];
  const ROMAN = ["", "I", "II", "III", "IV", "V"];
  const other = s => (s === "p1" ? "p2" : "p1");

  // ---- stage: scale the 1440x810 frame, one arena for the whole page ----
  const frame = $("frame");
  const fit = () => {
    const s = Math.min(innerWidth / 1440, innerHeight / 810);
    frame.style.transform = "translate(-50%, -50%) scale(" + s + ")";
  };
  addEventListener("resize", fit); fit();
  // created while the stage is visible: it measures the canvas to place the Emperors overlay
  const arena = ArenaEngine.create($("stage"), { mode: "lobby", stations: false, tvMode: "static", tv: $("lobby-tv") });
  FX.init();

  let menaces = [];
  const menace = o => menaces.push(FX.menace(o));
  const calm = () => { menaces.forEach(stop => stop()); menaces = []; };
  const unTbc = () => {
    document.querySelector("#frame > div").classList.remove("fx-sepia");
    document.querySelectorAll(".fx-tbc").forEach(e => e.remove());
  };

  let screen = "";
  const show = name => {
    if (screen === name) return;
    screen = name; calm(); unTbc();
    ["lobby", "battle", "verdict"].forEach(s => { $(s).hidden = s !== name; });
    $("hud").hidden = name === "lobby";
    if (name === "lobby") {
      arena.set({ mode: "lobby", stations: false, tvMode: "static", tv: $("lobby-tv"), loser: null, votes: null, mood: null, hype: 0 });
      menace({ x: 30, y: 20, w: 260, h: 170 });
      menace({ x: 1130, y: 20, w: 260, h: 170 });
    }
  };

  // ---- small helpers ----
  const el = (tag, text, style) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (style) e.style.cssText = style; return e; };
  let toastTimer = null;
  const toast = msg => { $("toast").textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").textContent = ""; }, 5000); };

  // ---- session ----
  let me = null, players = [], phase = "lobby", hpBefore = { p1: 100, p2: 100 };
  const saved = () => { try { return JSON.parse(sessionStorage.getItem("colosseum") || "null"); } catch (e) { return null; } };
  const forget = () => { try { sessionStorage.removeItem("colosseum"); } catch (e) { /* private mode */ } };
  const nameOf = s => { const p = players.find(x => x.id === s); return p ? p.name : (s === "p1" ? "the First" : "the Second"); };

  const socket = io();
  const SOLO = location.pathname === "/solo";   // two tabs on /solo pair up and start by themselves
  socket.on("connect", () => {
    const s = saved();
    if (s) socket.emit("room:rejoin", { code: s.code, playerId: s.token });
    else if (SOLO) socket.emit("room:solo", {});
  });
  socket.on("error", e => {
    toast(e.message);
    if (/gone|Could not rejoin|abandoned/.test(e.message)) {
      forget(); me = null; $("entry").hidden = false; $("waiting").hidden = true; show("lobby");
      if (SOLO && !/abandoned/.test(e.message)) socket.emit("room:solo", {});   // a stale session: pair up afresh
    }
  });

  // ---- HUD: names, HP bars, context bars ----
  const hpBar = (s, hp, before) => {   // looks: .hp in theme.css
    const full = Math.ceil(hp / 5), lost = Math.max(0, Math.ceil(before / 5) - full);
    const seg = kind => { const d = document.createElement("i"); if (kind) d.className = kind; return d; };
    const kinds = [...Array(full).fill("on"), ...Array(lost).fill("lost"), ...Array(Math.max(0, 20 - full - lost)).fill("")];
    $(s + "-bar").replaceChildren(...(s === "p1" ? kinds : kinds.reverse()).map(seg));
    $(s + "-hp").textContent = String(hp).padStart(3, "0");
  };
  const hud = (blinkLost) => {
    players.forEach(p => {
      $(p.id + "-name").textContent = p.name.toUpperCase() + (p.connected ? "" : " (gone)");
      $(p.id + "-label").textContent = (p.id === "p1" ? "Gladiator the First" : "Gladiator the Second") + (p.id === me ? " · you" : "");
      hpBar(p.id, p.hp, blinkLost ? hpBefore[p.id] : p.hp);
      const c = Math.round((p.context || 0) * 100), bar = $(p.id + "-ctx");
      bar.style.width = Math.min(100, c) + "%";
      bar.style.background = c > 85 ? "#FF3B30" : c >= 60 ? "#B6FF4A" : "#E9CF8E";   // green = /compact sweet spot
      $(p.id + "-ctxn").textContent = c + "%";
    });
  };
  const tag = (s, text) => { const t = $(s + "-tag"); t.hidden = !text; t.querySelector(".t").textContent = text || ""; };

  // ---- lobby ----
  $("create").onclick = () => socket.emit("room:create", { name: $("name").value });
  $("join").onclick = () => socket.emit("room:join", { code: $("matchcode").value.toUpperCase(), name: $("name").value });
  $("matchcode").onkeydown = e => { if (e.key === "Enter") $("join").click(); };
  $("start").onclick = () => socket.emit("room:start", {});

  socket.on("room:joined", j => {
    me = j.you;
    try { sessionStorage.setItem("colosseum", JSON.stringify({ code: j.code, token: j.token })); } catch (e) { /* private mode */ }
    $("roomcode").textContent = j.code;
    $("entry").hidden = true; $("waiting").hidden = false;
    $("lobby-tvtext").textContent = "MATCH " + j.code;
  });

  socket.on("room:state", s => {
    const was = phase;
    players = s.players; phase = s.phase;
    if (phase === "lobby") {
      show("lobby");
      const two = players.length === 2;
      $("waitmsg").textContent = !two ? "Waiting for a second gladiator. Share the code."
        : me === "p1" ? nameOf("p2") + " has entered. Begin when ready." : "Waiting for " + nameOf("p1") + " to begin.";
      $("start").hidden = !(me === "p1" && two);
      $("lobby-tvcap").textContent = players.map(p => p.name).join(" vs ") || "no offering";
    }
    if (phase === "countdown" && was !== "countdown") {
      FX.invert(1); FX.lines(900); FX.shake(400, 8);
      FX.slam("Ad Arenam!", { sub: "TO THE ARENA", color: "#FFE14A", size: 130, hold: 900 });
    }
    if (phase !== "verdict") hud(false);
    else hud(true);
  });

  // ---- battle ----
  const tv = $("battle-tv"), tvx = tv.getContext("2d");
  const paintImage = url => {
    const img = new Image();
    img.onload = () => {   // cover-crop to the 4:3 CRT, then the same dither the prototype uses
      const w = tv.width, h = tv.height, k = Math.max(w / img.width, h / img.height);
      tvx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
      ArenaEngine.dither(tvx, w, h, 4, ArenaEngine.noiseField(w, h, 30, 4242), null, 0);
    };
    img.onerror = () => ArenaEngine.paintOffering(tv);   // ponytail: no pictures yet, the lighthouse stands in
    img.src = url;
  };

  let labels = {}, endsAt = 0, briefEnds = 0, skew = 0, tick = null, lastSec = -1, draftTimer = null, keys = 0, vanish = null, maxChars = 0;
  const serverNow = () => Date.now() + skew;
  // during the task card the clock shows the full writing time; it starts when the card goes
  const left = () => Math.max(0, Math.ceil((endsAt - Math.max(serverNow(), briefEnds)) / 1000));
  const paintTimer = () => {
    const t = left(), timer = $("timer");
    timer.textContent = String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
    timer.classList.toggle("fx-hot", t <= 10);
    if (t !== lastSec) {
      if (t === 10 && lastSec > 10) { FX.lines(900, { color: "rgba(176,76,255,0.7)" }); FX.slam("Tempvs Fvgit", { sub: "10 SECONDS", color: "#C98CFF", size: 110 }); }
      if (t > 0 && t <= 5) FX.shake(160, 4);
      lastSec = t;
    }
  };
  const stopTimer = () => { clearInterval(tick); tick = null; $("timer").classList.remove("fx-hot"); };
  const count = () => { $("count").textContent = $("testimony").value.length + "/" + maxChars; };

  // timers that belong to one screen (the task card, the falling faces); a new event cancels them
  let beats = [];
  const beat = (ms, fn) => beats.push(setTimeout(fn, ms));
  const hush = () => { beats.forEach(clearTimeout); beats = []; $("card").hidden = true; };

  // the task card: the round's job, big, until the clock starts; a red line drains underneath
  let unlock = () => {};
  const taskCard = r => {
    const ms = briefEnds - serverNow();
    if (ms <= 0) return unlock();
    const o = r.offering;
    $("card-round").textContent = "Rovnd " + ROMAN[r.round] + " of V";
    $("card-title").textContent = r.title;
    $("card-brief").textContent = r.brief;
    $("card-img").hidden = !o.url; if (o.url) $("card-img").src = o.url;
    $("card-task").hidden = !o.task; $("card-task").textContent = o.task || "";
    $("card-wild").hidden = !r.wildcard;
    $("card-wild").textContent = r.wildcard ? r.wildcard.title + ": " + r.wildcard.rule : "";
    const bar = $("card-bar");
    bar.style.transitionDuration = "0ms"; bar.style.width = "100%";
    void bar.offsetWidth;                                   // restart the transition
    bar.style.transitionDuration = ms + "ms"; bar.style.width = "0%";
    $("card").hidden = false;
    beat(ms, () => { $("card").hidden = true; unlock(); FX.lines(500); FX.shake(200, 6); });
  };

  socket.on("round:start", r => {
    hush(); show("battle"); calm(); unTbc();
    menace({ x: 1230, y: 560, w: 170, h: 170, color: "#FF4FB0" });
    menace({ x: 30, y: 230, w: 320, h: 160, color: "#B6FF4A", every: 1300 });
    arena.set({ mode: "battle", stations: true, typing: "both", tv: tv, tvMode: "offering", loser: null, votes: null, mood: null, hype: 0 });
    hpBefore = Object.fromEntries(players.map(p => [p.id, p.hp]));
    skew = r.serverNow - Date.now(); endsAt = r.endsAt; briefEnds = r.briefEndsAt || 0;
    lastSec = -1; labels = r.optionLabels || {};
    $("rtitle").textContent = r.title;
    $("rlabel").textContent = "Rovnd " + ROMAN[r.round] + " of V";
    $("wild").hidden = !r.wildcard;
    $("wild").textContent = r.wildcard ? r.wildcard.title + ": " + r.wildcard.rule : "";
    $("brief").textContent = r.brief;
    $("deliberate").hidden = true;

    // the offering: a picture painted on the CRT, or the task as text on it
    const o = r.offering;
    clearTimeout(vanish);
    $("tv-text").hidden = !!o.url; $("tv-text").textContent = o.task || "";
    $("tv-cap").textContent = "offering · " + o.id;
    tv.setAttribute("aria-label", o.url ? "The offering: a picture" : "The offering: " + o.task);
    if (o.url) paintImage(o.url);
    if (r.wildcard && r.wildcard.id === "caecus")   // 10 s after the clock starts, not after the card
      vanish = setTimeout(() => { $("tv-text").hidden = true; arena.set({ tvMode: "static" }); }, Math.max(0, briefEnds - serverNow()) + 10000);

    // write a testimony, or pick a model card in Consilivm
    const pick = r.options != null, ta = $("testimony");
    maxChars = r.maxChars || 0;
    ta.hidden = pick; $("count").hidden = pick; $("cards").hidden = !pick;
    ta.maxLength = maxChars || 9999; ta.value = (r.you && r.you.text) || "";
    const sealed = (r.sealed && r.sealed[me]) || (r.you && r.you.pick);
    ta.disabled = $("seal").disabled = true;               // opened by unlock() when the card goes
    $("seal").hidden = pick;
    $("cards").replaceChildren(...(pick ? r.options.map(m => {
      const b = el("button", r.optionLabels[m]); b.type = "button"; b.className = "card-model";
      b.setAttribute("aria-pressed", String(!!(r.you && r.you.pick === m)));
      b.disabled = true;
      b.onclick = () => {
        socket.emit("round:choose", { model: m });
        b.setAttribute("aria-pressed", "true");
        $("cards").querySelectorAll("button").forEach(x => { x.disabled = true; });
        FX.slam("Electvm", { sub: "CHOSEN", color: "#FF5A40", size: 130, hold: 700 });
      };
      return b;
    }) : []));
    unlock = () => {
      if (sealed) return;
      ta.disabled = $("seal").disabled = false;
      $("cards").querySelectorAll("button").forEach(x => { x.disabled = false; });
      if (!pick) ta.focus();
    };
    count();
    SLOTS.forEach(s => tag(s, r.sealed && r.sealed[s] ? "sealed" : pick ? "choosing…" : "writing…"));
    taskCard(r);

    stopTimer(); paintTimer(); tick = setInterval(paintTimer, 250);
    hud(false);
  });

  const words = ["IO!", "EIA!", "HA!", "✠", "VAE!"];
  $("testimony").oninput = () => {
    count();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => socket.emit("round:draft", { text: $("testimony").value }), 400);   // throttled
    if (++keys >= 30) {
      keys = 0;
      FX.pop(words[Math.floor(Math.random() * words.length)], 120 + Math.random() * 640, 350 + Math.random() * 50, { size: 30 + Math.random() * 14 });
    }
  };
  $("seal").onclick = () => {
    socket.emit("round:seal", { text: $("testimony").value });
    $("testimony").disabled = $("seal").disabled = true;
    FX.invert(1); FX.lines(1000, { color: "rgba(255,70,40,0.8)" }); FX.shake(400, 10);
    FX.slam("Signatvm", { sub: "SEALED", color: "#FF5A40", size: 140, hold: 1000 });
  };
  socket.on("round:sealed", s => tag(s.playerId, "sealed"));
  socket.on("round:judging", () => {
    hush(); show("battle");   // a player who rejoins mid-judging arrives here straight from the lobby
    stopTimer(); $("timer").textContent = "--:--";
    $("testimony").disabled = $("seal").disabled = true;
    $("deliberate").hidden = false;
    SLOTS.forEach(s => tag(s, "awaiting judgement"));
    arena.set({ typing: null });
    FX.lines(1200, { color: "rgba(240,217,160,0.7)" });
  });

  // ---- each Emperor's face, cut out of the group portrait (design/emperors.js) ----
  const faces = [];
  (() => {
    const E = window.EMPERORS, img = new Image();
    img.onload = () => {
      // ponytail: per-face top edges hand-fitted to the current art (texels); redo if emperors.js is regenerated
      const k = img.naturalWidth / E.w, S = 52, TOP = [30, 46, 26, 14];
      E.faces.forEach((fx, i) => {
        const c = document.createElement("canvas"); c.width = c.height = S;
        const x0 = Math.max(0, Math.min(E.w - S, fx - S / 2));
        c.getContext("2d").drawImage(img, x0 * k, (TOP[i] || 0) * k, S * k, S * k, 0, 0, S, S);
        faces[i] = c.toDataURL();
      });
    };
    img.src = E.src;
  })();

  // ---- verdict: the table of faces, then the wound ----
  const wound = (d, crit) => crit ? "a critical blow" : d >= 40 ? "a mortal wound" : d >= 25 ? "a grievous wound"
    : d >= 12 ? "a deep cut" : d > 0 ? "a scratch" : "unscathed";
  const GAP = 800;   // ms between falling faces

  socket.on("round:verdict", v => {
    stopTimer(); clearTimeout(vanish); hush();
    show("verdict"); calm(); unTbc();
    $("report").hidden = true; $("endbox").hidden = true; $("vbuttons").hidden = false;
    SLOTS.forEach(s => tag(s, null));
    const winner = v.loser ? other(v.loser) : null;
    const mood = !winner ? "neutral" : winner === me ? "happy" : "mad";   // the Emperors face the local player
    arena.set({ mode: "verdict", stations: true, loser: v.loser, votes: null, mood: mood, hype: 1, tv: null, typing: null });
    $("vtitle").textContent = v.forfeit ? "A Gladiator Has Fled" : "The Emperors Have Spoken";
    $("col-p1").textContent = nameOf("p1").toUpperCase();
    $("col-p2").textContent = nameOf("p2").toUpperCase();

    // one row per Emperor; the face falls into the picked column, a coin first on a tie
    const rows = $("vrows");
    rows.replaceChildren();
    let at = 500;
    v.emperors.forEach((e, i) => {
      const row = el("div"); row.className = "vrow";
      const who = el("span", e.name); who.className = "who" + (e.pick ? "" : " out");
      if (!e.pick) who.append(el("small", "abstinet"));
      const cells = { p1: el("div"), p2: el("div") };
      cells.p1.className = cells.p2.className = "cell";
      row.append(who, cells.p1, cells.p2);
      rows.append(row);
      if (!e.pick) return;
      if (e.coin) {
        beat(at, () => {
          const coin = el("div", "?"); coin.className = "coin"; row.style.position = "relative";
          coin.style.left = (170 + (row.offsetWidth - 170) / 2) + "px";
          row.append(coin);
          beat(900, () => coin.remove());
        });
        at += 900;
      }
      beat(at, () => {
        const f = document.createElement("img");
        f.className = "face fall"; f.alt = e.name + " picks " + nameOf(e.pick);
        f.src = faces[i] || faces[0] || "";
        cells[e.pick].append(f);
        beat(300, () => FX.shake(220, 10));
      });
      at += GAP;
    });
    if (!v.emperors.length) {
      const row = el("div", v.picks ? "Consilivm needs no Emperor: the right card was " + (v.answer || []).map(k => labels[k] || k).join(", ") + "."
        : v.forfeit ? "No Emperor was needed." : "The Emperors were silent.",
        "padding: 22px 6px; font-family: 'Special Elite', monospace; font-size: 22px; color: #1d1a16; text-align: center");
      rows.append(row);
    }

    // then the outcome: one line, the wound beside the loser, and the shout
    const both = !v.loser && v.dmg.p1 > 0;
    $("vline").style.opacity = 0; $("dmgbox").style.opacity = 0;
    $("vline").replaceChildren();
    if (v.forfeit) $("vline").append(nameOf(v.forfeit).toUpperCase() + " forfeits Rovnd " + ROMAN[v.round]);
    else if (winner) $("vline").append(el("span", nameOf(winner).toUpperCase(), "font-family: 'Jersey 10', sans-serif; font-size: 44px; color: " + (winner === "p1" ? "#D8FF9A" : "#FF8FCB")),
      " takes Rovnd " + ROMAN[v.round] + " · " + nameOf(v.loser).toUpperCase() + " −" + v.damage);
    else $("vline").append("Rovnd " + ROMAN[v.round] + " is a draw" + (both ? " · both −" + v.damage : ""));
    const box = $("dmgbox");
    box.style.left = v.loser === "p2" ? "1100px" : "60px";
    box.style.alignItems = v.loser === "p2" ? "flex-end" : "flex-start";
    $("dmg").textContent = v.damage > 0 ? "−" + v.damage + (both ? " each" : "") : "0";
    $("dmglabel").textContent = wound(v.damage, v.crit);

    beat(at + 200, () => {
      $("vline").style.opacity = 1; $("dmgbox").style.opacity = 1;
      players = players.map(p => ({ ...p, hp: v.hp[p.id], context: v.context[p.id] }));
      hud(true);
      arena.set({ votes: v.emperors.length ? v.emperors.map(e => e.pick) : null });
      FX.invert(1); FX.lines(1000); FX.shake(500, 10);
      const sub = winner ? nameOf(winner).toUpperCase() + " TAKES THE ROUND" : "A DRAW";
      if (SLOTS.some(s => v.flagged[s])) FX.slam("Corrvptio!", { sub: "THE EMPERORS SAW THROUGH THE BRIBE", color: "#FFB347", size: 120, hold: 1300 });
      else if (!winner) FX.slam("Par", { sub: sub, color: "#F0D9A0", size: 130, hold: 1300 });
      else if (winner === me) FX.slam("Io Triumphe!", { sub: sub, color: "#CFFF8A", size: 120, hold: 1300 });
      else FX.slam("Vae Victis!", { sub: sub, color: "#FF6FC0", size: 130, hold: 1300 });
      if (winner) menace({ x: winner === "p1" ? 40 : 1150, y: 150, w: 260, h: 220, color: winner === "p1" ? "#B6FF4A" : "#FF4FB0", every: 700 });
    });

    const last = v.round >= 5;
    $("compact").hidden = $("clear").hidden = last;
    $("compact").disabled = $("clear").disabled = false;
    $("next").disabled = false;
    $("next").textContent = last ? "To the Verdict" : "Next Rovnd";
    yieldArmed = false; $("yield").textContent = "Yield";
  });

  $("compact").onclick = () => { socket.emit("context:reset", { mode: "compact" }); $("compact").disabled = $("clear").disabled = true; };
  $("clear").onclick = () => { socket.emit("context:reset", { mode: "clear" }); $("compact").disabled = $("clear").disabled = true; };
  $("next").onclick = () => { socket.emit("round:next", {}); $("next").disabled = true; if (screen === "verdict" && !$("vbuttons").hidden) FX.tbc(() => {}); };
  let yieldArmed = false;
  $("yield").onclick = () => {
    if (!yieldArmed) { yieldArmed = true; $("yield").textContent = "Truly yield?"; return; }
    socket.emit("match:yield", {});
  };

  // ---- the end, and the report of the whole match ----
  let history = [];
  socket.on("match:end", m => {
    stopTimer(); hush(); forget();
    history = m.history || [];
    if (screen !== "verdict") {   // yield or flight mid-round: show the end over the verdict layout
      show("verdict");
      $("vrows").replaceChildren(); $("vline").replaceChildren(); $("dmg").textContent = ""; $("dmglabel").textContent = "";
    }
    calm(); unTbc();
    m.final.forEach(f => { const p = players.find(x => x.id === f.id); if (p) p.hp = f.hp; });
    hud(false);
    $("vbuttons").hidden = true; $("endbox").hidden = false;
    $("report-open").hidden = !history.length;
    $("vtitle").textContent = m.winnerId ? nameOf(m.winnerId).toUpperCase() + " is Victor" : "The Games End in a Draw";
    const why = { yield: "by yield", disconnect: "by flight", hp: "" }[m.reason] || "";
    $("endtext").textContent = !m.winnerId ? "Par" : m.winnerId === me ? "Victor " + why : "Victvs " + why;
    arena.set({ mode: "verdict", loser: m.winnerId ? other(m.winnerId) : null, votes: null, hype: 1,
      mood: !m.winnerId ? "neutral" : m.winnerId === me ? "happy" : "mad" });
    FX.invert(1); FX.lines(1200); FX.shake(600, 12);
    FX.slam(m.winnerId === me ? "Io Triumphe!" : m.winnerId ? (m.reason === "yield" && m.winnerId !== me ? "Misericordia" : "Vae Victis!") : "Par", {
      sub: m.winnerId === me ? "VICTORY" : m.winnerId ? "DEFEAT" : "DRAW",
      color: m.winnerId === me ? "#FFE14A" : "#9AA0B4", size: 120, hold: 1600 });
  });

  const report = () => {
    const body = $("report-body");
    body.replaceChildren(...history.map(h => {
      const r = el("div"); r.className = "report-round";
      r.append(el("h3", "Rovnd " + ROMAN[h.round] + " · " + h.title));
      r.append(Object.assign(el("div", h.task), { className: "task" }));
      const pr = el("div"); pr.className = "prompts";
      SLOTS.forEach(s => {
        const d = el("div");
        d.append(el("b", nameOf(s).toUpperCase() + " · " + h.totals[s], "color: " + (s === "p1" ? "#3E7A10" : "#A0145E")),
          h.prompts[s] || (h.picks ? "(no pick)" : "(nothing was written)"));
        pr.append(d);
      });
      r.append(pr);
      if (h.emperors.length) {
        const em = el("div"); em.className = "emps";
        h.emperors.forEach(e => {
          em.append(Object.assign(el("span", e.name), { className: "n" }),
            Object.assign(el("span", e.vote ? e.p1 + " · " + e.p2 : "–"), { className: "s" }),
            Object.assign(el("span", e.vote ? "“" + e.remark + "”" + (e.coin ? " (a coin chose " + nameOf(e.pick) + ")" : "") : "abstained"), { className: "r" }));
        });
        r.append(em);
      }
      const out = [];
      SLOTS.forEach(s => {
        if (h.dmg[s]) out.push(nameOf(s) + " −" + h.dmg[s] + (h.crit && h.loser === s ? " (critical)" : ""));
        if (h.heal[s]) out.push(nameOf(s) + " +" + h.heal[s] + (h.sweep && h.sweep[s] ? " (checklist complete)" : ""));
        if (h.flagged[s]) out.push(nameOf(s) + ": bribe caught");
      });
      if (h.answer) out.push("right card: " + h.answer.map(k => labels[k] || k).join(", "));
      if (h.forfeit) out.push(nameOf(h.forfeit) + " forfeited");
      r.append(Object.assign(el("div", out.join(" · ") || "no blood drawn"), { className: "out" }));
      return r;
    }));
    $("report").hidden = false;
  };
  $("report-open").onclick = report;
  $("report-close").onclick = () => { $("report").hidden = true; };
  $("again").onclick = () => { forget(); location.reload(); };

  show("lobby");
})();

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
  socket.on("connect", () => { const s = saved(); if (s) socket.emit("room:rejoin", { code: s.code, playerId: s.token }); });
  socket.on("error", e => {
    toast(e.message);
    if (/gone|Could not rejoin/.test(e.message)) { forget(); me = null; $("entry").hidden = false; $("waiting").hidden = true; show("lobby"); }
  });

  // ---- HUD: names, HP bars, context bars ----
  const COLORS = { p1: ["#B6FF4A", "rgba(182,255,74,0.13)", "-16deg"], p2: ["#FF4FB0", "rgba(255,79,176,0.13)", "16deg"] };
  const hpBar = (s, hp, before) => {
    const [on, off, skew] = COLORS[s];
    const full = Math.ceil(hp / 5), lost = Math.max(0, Math.ceil(before / 5) - full);
    const seg = kind => {
      const d = el("div", null, "width: 17px; height: 20px; transform: skewX(" + skew + "); " +
        (kind === "on" ? "background: " + on + "; box-shadow: 0 0 7px " + on
          : kind === "lost" ? "background: #F5E6C8; box-shadow: 0 0 8px #FF3B30" : "background: " + off + "; box-shadow: none"));
      if (kind === "lost") d.className = "blink-fast";
      return d;
    };
    const kinds = [...Array(full).fill("on"), ...Array(lost).fill("lost"), ...Array(Math.max(0, 20 - full - lost)).fill("off")];
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

  let labels = {}, endsAt = 0, skew = 0, tick = null, lastSec = -1, draftTimer = null, keys = 0, vanish = null, maxChars = 0;
  const left = () => Math.max(0, Math.ceil((endsAt - (Date.now() + skew)) / 1000));
  const paintTimer = () => {
    const t = left(), timer = $("timer");
    timer.textContent = "00:" + String(t).padStart(2, "0");
    timer.classList.toggle("fx-hot", t <= 10);
    if (t !== lastSec) {
      if (t === 10 && lastSec > 10) { FX.lines(900, { color: "rgba(176,76,255,0.7)" }); FX.slam("Tempvs Fvgit", { sub: "10 SECONDS", color: "#C98CFF", size: 110 }); }
      if (t > 0 && t <= 5) FX.shake(160, 4);
      lastSec = t;
    }
  };
  const stopTimer = () => { clearInterval(tick); tick = null; $("timer").classList.remove("fx-hot"); };
  const count = () => { $("count").textContent = $("testimony").value.length + "/" + maxChars; };

  socket.on("round:start", r => {
    show("battle"); calm(); unTbc();
    menace({ x: 1230, y: 560, w: 170, h: 170, color: "#FF4FB0" });
    menace({ x: 30, y: 230, w: 320, h: 160, color: "#B6FF4A", every: 1300 });
    arena.set({ mode: "battle", stations: true, typing: "both", tv: tv, tvMode: "offering", loser: null, votes: null, mood: null, hype: 0 });
    hpBefore = Object.fromEntries(players.map(p => [p.id, p.hp]));
    endsAt = r.endsAt; skew = r.serverNow - Date.now(); lastSec = -1; labels = r.optionLabels || {};
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
    if (r.wildcard && r.wildcard.id === "caecus") vanish = setTimeout(() => { $("tv-text").hidden = true; arena.set({ tvMode: "static" }); }, 10000);

    // write a testimony, or pick a model card in Consilivm
    const pick = r.options != null, ta = $("testimony");
    maxChars = r.maxChars || 0;
    ta.hidden = pick; $("count").hidden = pick; $("cards").hidden = !pick;
    ta.maxLength = maxChars || 9999; ta.value = (r.you && r.you.text) || "";
    const sealed = (r.sealed && r.sealed[me]) || (r.you && r.you.pick);
    ta.disabled = $("seal").disabled = !!sealed;
    $("seal").hidden = pick;
    $("cards").replaceChildren(...(pick ? r.options.map(m => {
      const b = el("button", r.optionLabels[m]); b.type = "button"; b.className = "card-model";
      b.setAttribute("aria-pressed", String(!!(r.you && r.you.pick === m)));
      b.disabled = !!(r.you && r.you.pick);
      b.onclick = () => {
        socket.emit("round:choose", { model: m });
        b.setAttribute("aria-pressed", "true");
        $("cards").querySelectorAll("button").forEach(x => { x.disabled = true; });
        FX.slam("Electvm", { sub: "CHOSEN", color: "#FF5A40", size: 130, hold: 700 });
      };
      return b;
    }) : []));
    count();
    SLOTS.forEach(s => tag(s, r.sealed && r.sealed[s] ? "sealed" : pick ? "choosing…" : "writing…"));
    if (!pick && !sealed) ta.focus();

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
    stopTimer(); $("timer").textContent = "--:--";
    $("testimony").disabled = $("seal").disabled = true;
    $("deliberate").hidden = false;
    SLOTS.forEach(s => tag(s, "awaiting judgement"));
    arena.set({ typing: null });
    FX.lines(1200, { color: "rgba(240,217,160,0.7)" });
  });

  // ---- verdict ----
  const wound = (d, crit) => crit ? "a critical blow" : d >= 40 ? "a mortal wound" : d >= 25 ? "a grievous wound"
    : d >= 12 ? "a deep cut" : d > 0 ? "a scratch" : "unscathed";
  const STAMPS = { win: ["Victor", "rgba(30,110,40,0.8)"], lose: ["Victvs", "rgba(190,20,20,0.78)"], draw: ["Par", "rgba(150,110,20,0.8)"] };

  socket.on("round:verdict", v => {
    stopTimer(); clearTimeout(vanish);
    show("verdict"); calm(); unTbc();
    $("endbox").hidden = true; $("vbuttons").hidden = false;
    SLOTS.forEach(s => tag(s, null));
    const winner = v.loser ? other(v.loser) : null;
    const votes = v.emperors.length ? v.emperors.map(e => e.vote || "tie") : null;
    const mood = !winner ? "neutral" : winner === me ? "happy" : "mad";   // the Emperors face the local player
    arena.set({ mode: "verdict", stations: true, loser: v.loser, votes: votes, mood: mood, hype: 1, tv: null, typing: null });

    $("vtitle").textContent = v.forfeit ? "A Gladiator Has Fled" : "The Emperors Have Spoken";
    $("vline").replaceChildren();
    if (v.forfeit) $("vline").append(el("span", nameOf(v.forfeit).toUpperCase() + " forfeits Rovnd " + ROMAN[v.round]));
    else if (winner) {
      const n = el("span", nameOf(winner).toUpperCase(), "font-family: 'Jersey 10', sans-serif; font-size: 28px; color: " + (winner === "p1" ? "#D8FF9A" : "#FF8FCB"));
      $("vline").append(n, " takes Rovnd " + ROMAN[v.round] + " · " + v.totals[winner] + " to " + v.totals[other(winner)]);
    } else $("vline").append("Rovnd " + ROMAN[v.round] + " is a draw · " + v.totals.p1 + " to " + v.totals.p2);

    // the wound, under the loser (or both, on a tie)
    const box = $("dmgbox");
    box.style.left = v.loser === "p2" ? "1150px" : "44px";
    box.style.alignItems = v.loser === "p2" ? "flex-end" : "flex-start";
    const both = !v.loser && v.dmg.p1 > 0;
    $("dmg").textContent = v.damage > 0 ? "−" + v.damage + (both ? " each" : "") : "0";
    $("dmglabel").textContent = wound(v.damage, v.crit);
    $("tags").style.left = v.loser === "p2" ? "1036px" : "44px";
    $("tags").style.textAlign = v.loser === "p2" ? "right" : "left";
    const tags = [];
    SLOTS.forEach(s => {
      const who = s === me ? "You" : nameOf(s);
      if (v.flagged[s]) tags.push(who + ": the Emperors saw through the bribe");
      if (v.heal[s]) tags.push(who + " heals " + v.heal[s] + (v.sweep[s] ? " (checklist complete)" : ""));
    });
    if (v.answer) tags.push("Right answer: " + v.answer.map(k => labels[k] || k).join(", "));
    $("tags").replaceChildren(...tags.map(t => el("span", t)));

    // the two testimonies
    SLOTS.forEach(s => {
      const paper = $("paper-" + s), result = !winner ? "draw" : s === winner ? "win" : "lose";
      paper.querySelector(".total").textContent = v.totals[s];
      paper.querySelector(".text").textContent = v.prompts[s] || (v.picks ? "(no pick)" : "(nothing was written)");
      const [word, color] = STAMPS[result], stamp = paper.querySelector(".stamp");
      stamp.textContent = word; stamp.style.color = color; stamp.style.border = "3px solid " + color;
      paper.style.outline = result === "win" ? "4px solid " + (s === "p1" ? "rgba(182,255,74,0.45)" : "rgba(255,79,176,0.35)") : "none";
    });

    // the Emperors' reasons
    const acta = $("acta");
    acta.replaceChildren();
    if (!v.emperors.length) {
      acta.append(el("span", v.picks ? "Consilivm is not judged by the Emperors." : "No Emperor was needed.",
        "grid-column: 1 / -1; font-family: 'Special Elite', monospace; font-size: 15px"));
    }
    v.emperors.forEach(e => {
      acta.append(el("span", e.name, "font-family: 'Cinzel Decorative', serif; font-weight: 700; font-size: 14px; color: #2A1F15"));
      const sc = el("span", null, "font-family: 'Doto', monospace; font-weight: 900; font-size: 16px");
      if (e.vote) sc.append(el("span", e.p1, "color: #2E6A10"), "·", el("span", e.p2, "color: #A0145E"));
      else sc.textContent = "–";
      acta.append(sc, el("span", e.vote ? "“" + e.remark + "”" : "(abstained)", "font-family: 'Special Elite', monospace; font-size: 15px"));
    });

    const last = v.round >= 5;
    $("compact").hidden = $("clear").hidden = last;
    $("compact").disabled = $("clear").disabled = false;
    $("next").disabled = false;
    $("next").textContent = last ? "To the Verdict" : "Next Rovnd";
    yieldArmed = false; $("yield").textContent = "Yield";

    players = players.map(p => ({ ...p, hp: v.hp[p.id], context: v.context[p.id] }));
    hud(true);

    setTimeout(() => {
      FX.invert(1); FX.lines(1000); FX.shake(500, 10);
      const sub = winner ? nameOf(winner).toUpperCase() + " TAKES THE ROUND" : "A DRAW";
      if (!winner) FX.slam("Par", { sub: sub, color: "#F0D9A0", size: 130, hold: 1300 });
      else if (winner === me) FX.slam("Io Triumphe!", { sub: sub, color: "#CFFF8A", size: 120, hold: 1300 });
      else FX.slam("Vae Victis!", { sub: sub, color: "#FF6FC0", size: 130, hold: 1300 });
    }, 200);
    if (winner) {
      menace({ x: winner === "p1" ? 40 : 1150, y: 150, w: 260, h: 220, color: winner === "p1" ? "#B6FF4A" : "#FF4FB0", every: 700 });
      menace({ x: winner === "p1" ? 1100 : 40, y: 200, w: 300, h: 160, chars: "†", color: "#FF3B30", every: 1400 });
    }
  });

  $("compact").onclick = () => { socket.emit("context:reset", { mode: "compact" }); $("compact").disabled = $("clear").disabled = true; };
  $("clear").onclick = () => { socket.emit("context:reset", { mode: "clear" }); $("compact").disabled = $("clear").disabled = true; };
  $("next").onclick = () => { socket.emit("round:next", {}); $("next").disabled = true; if (screen === "verdict" && !$("vbuttons").hidden) FX.tbc(() => {}); };
  let yieldArmed = false;
  $("yield").onclick = () => {
    if (!yieldArmed) { yieldArmed = true; $("yield").textContent = "Truly yield?"; return; }
    socket.emit("match:yield", {});
  };

  // ---- the end ----
  socket.on("match:end", m => {
    stopTimer(); forget();
    if (screen !== "verdict") {   // yield or flight mid-round: show the end over the verdict layout
      show("verdict");
      ["paper-p1", "paper-p2"].forEach(id => { $(id).querySelector(".text").textContent = ""; $(id).querySelector(".total").textContent = ""; $(id).querySelector(".stamp").textContent = ""; });
      $("acta").replaceChildren(); $("tags").replaceChildren(); $("dmg").textContent = ""; $("dmglabel").textContent = "";
      $("vline").textContent = "";
    }
    calm(); unTbc();
    m.final.forEach(f => { const p = players.find(x => x.id === f.id); if (p) p.hp = f.hp; });
    hud(false);
    $("vbuttons").hidden = true; $("endbox").hidden = false;
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
  $("again").onclick = () => { forget(); location.reload(); };

  show("lobby");
})();

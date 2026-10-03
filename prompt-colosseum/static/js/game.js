// Dev client: speaks the whole socket protocol (docs/GAME_SPEC.md) with no styling.
// The server decides everything; this only sends intents and shows what it is told.
(() => {
  const $ = id => document.getElementById(id);
  const socket = io();
  let me = null, code = null, endsAt = 0, skew = 0, kind = "", tick = null, sendDraft = null, wild = null;
  let seen = { players: [], phase: "lobby" };

  const saved = () => JSON.parse(sessionStorage.getItem("colosseum") || "null");
  const forget = () => sessionStorage.removeItem("colosseum");
  const show = (...names) => ["entry", "room", "round", "verdict", "end"].forEach(s => $(s).hidden = !names.includes(s));
  const h = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
  const note = msg => { $("err").textContent = msg; setTimeout(() => { if ($("err").textContent === msg) $("err").textContent = ""; }, 5000); };

  // ---- lobby ----
  $("create").onclick = () => socket.emit("room:create", { name: $("name").value });
  $("join").onclick = () => socket.emit("room:join", { code: $("code").value, name: $("name").value });
  $("start").onclick = () => socket.emit("room:start", {});
  $("yield").onclick = () => confirm("Give up the match?") && socket.emit("match:yield", {});

  socket.on("connect", () => { const s = saved(); if (s) socket.emit("room:rejoin", { code: s.code, playerId: s.token }); });
  socket.on("error", e => {
    note(e.message);
    if (/gone|Could not rejoin/.test(e.message)) { forget(); me = null; show("entry"); }
  });
  socket.on("room:joined", j => {
    me = j.you; code = j.code;
    sessionStorage.setItem("colosseum", JSON.stringify({ code: j.code, token: j.token }));
    $("roomcode").textContent = j.code;
  });
  socket.on("room:state", s => {
    seen = s;
    $("phase").textContent = s.phase; $("roundno").textContent = s.round;
    $("players").replaceChildren(...s.players.map(p => {
      const d = h("div", "", "card " + p.id);
      d.append(h("b", p.name + (p.id === me ? " (you)" : "")), h("div", "HP " + p.hp + (p.connected ? "" : "  [disconnected]")),
               h("div", "context " + Math.round(p.context * 100) + "%", "dim"));
      return d;
    }));
    $("start").hidden = !(me === "p1" && s.phase === "lobby" && s.players.length === 2);
    $("yield").hidden = s.phase === "lobby" || s.phase === "finished";
    $("wait").textContent = s.phase === "lobby" ? (s.players.length < 2 ? "Waiting for a second gladiator. Share the code." : "")
                          : s.phase === "countdown" ? "Get ready..." : "";
    $("entry").hidden = !!me;                                 // the entry form only while not in a room
    $("room").hidden = false;
    if (s.phase === "lobby" || s.phase === "countdown") $("round").hidden = $("verdict").hidden = $("end").hidden = true;
  });

  // ---- writing ----
  const left = () => Math.max(0, Math.ceil((endsAt - (Date.now() + skew)) / 1000));
  socket.on("round:start", r => {
    kind = r.kind; wild = r.wildcard; endsAt = r.endsAt; skew = r.serverNow - Date.now();
    $("verdict").hidden = $("end").hidden = true; $("round").hidden = false; $("room").hidden = false;
    $("title").textContent = "Round " + r.round + ": " + r.title;
    $("brief").textContent = r.brief;
    $("wild").textContent = r.wildcard ? "Wildcard " + r.wildcard.title + ": " + r.wildcard.rule : "";
    $("opp").textContent = "";
    const o = r.offering, box = $("offering"), pick = r.options !== null;
    box.replaceChildren();
    if (o.url) { const img = document.createElement("img"); img.src = o.url; img.alt = "the offering"; box.append(img); }
    else box.append(h("p", o.task, "card"));
    if (r.wildcard && r.wildcard.id === "caecus") setTimeout(() => { if (!$("round").hidden) box.replaceChildren(h("p", "(the offering vanished)", "dim")); }, 10000);
    $("write").hidden = pick;
    $("cards").replaceChildren(...(pick ? r.options.map(m => {
      const b = h("button", r.optionLabels[m]); b.onclick = () => { socket.emit("round:choose", { model: m }); $("cards").querySelectorAll("button").forEach(x => x.disabled = true); };
      return b; }) : []));
    const t = $("text"); t.value = (r.you && r.you.text) || ""; t.maxLength = r.maxChars || 0;
    const sealed = r.sealed && r.sealed[me]; t.disabled = $("seal").disabled = !!sealed;
    if (r.sealed && r.sealed[me === "p1" ? "p2" : "p1"]) $("opp").textContent = "opponent sealed";
    if (r.you && r.you.pick) $("cards").querySelectorAll("button").forEach(x => x.disabled = true);
    count();
    clearInterval(tick); const paint = () => $("timer").textContent = left() + " s"; paint(); tick = setInterval(paint, 250);
  });
  const count = () => $("count").textContent = $("text").value.length + " / " + ($("text").maxLength > 0 ? $("text").maxLength : "-");
  $("text").oninput = () => {
    count(); clearTimeout(sendDraft);
    sendDraft = setTimeout(() => socket.emit("round:draft", { text: $("text").value }), 400);   // throttled
  };
  $("seal").onclick = () => { socket.emit("round:seal", { text: $("text").value }); $("text").disabled = $("seal").disabled = true; };
  socket.on("round:sealed", s => { if (s.playerId !== me) $("opp").textContent = "opponent sealed"; });
  socket.on("round:judging", () => { clearInterval(tick); $("timer").textContent = "-"; $("opp").textContent = "The Emperors deliberate..."; });

  // ---- verdict ----
  const who = s => s === "p1" ? "the first gladiator" : "the second gladiator";
  socket.on("round:verdict", v => {
    clearInterval(tick);
    $("round").hidden = true; $("end").hidden = true; $("verdict").hidden = false; $("room").hidden = false;
    $("vhead").textContent = "Round " + v.round + (v.forfeit ? ": " + who(v.forfeit) + " forfeits" :
      v.loser ? ": " + who(v.loser === "p1" ? "p2" : "p1") + " wins" : ": a draw") + "   (" + v.totals.p1 + " to " + v.totals.p2 + ")";
    const tags = [];
    SLOTS.forEach(s => {
      if (v.dmg[s]) tags.push((s === me ? "you take " : "opponent takes ") + v.dmg[s] + (v.crit && v.loser === s ? " (crit)" : ""));
      if (v.heal[s]) tags.push((s === me ? "you heal " : "opponent heals ") + v.heal[s]);
      if (v.flagged[s]) tags.push("the Emperors saw through " + (s === me ? "your" : "their") + " bribe");
    });
    $("vtags").textContent = tags.join(" | ") + (v.picks ? " | right answer: " + v.answer.join(", ") : "");
    $("emperors").replaceChildren(...v.emperors.map(e => h("div", e.name + " (" + e.model + ")  " +
      (e.vote ? e.p1 + " : " + e.p2 + "  \"" + e.remark + "\"" : "abstained"))));
    $("prompts").replaceChildren(...SLOTS.map(s => { const d = h("div", "", "card " + s);
      d.append(h("b", (s === me ? "You" : "Opponent") + ":"), h("div", v.picks ? "picked: " + (v.prompts[s] || "nothing") : v.prompts[s] || "(empty)")); return d; }));
    $("compact").hidden = $("clear").hidden = v.round >= 5;
    $("compact").disabled = $("clear").disabled = false; $("next").disabled = false;
  });
  const SLOTS = ["p1", "p2"];
  $("compact").onclick = () => { socket.emit("context:reset", { mode: "compact" }); $("compact").disabled = $("clear").disabled = true; };
  $("clear").onclick = () => { socket.emit("context:reset", { mode: "clear" }); $("compact").disabled = $("clear").disabled = true; };
  $("next").onclick = () => { socket.emit("round:next", {}); $("next").disabled = true; };

  // ---- the end ----
  socket.on("match:end", m => {
    clearInterval(tick); forget();
    $("round").hidden = $("verdict").hidden = true; $("end").hidden = false; $("yield").hidden = true;
    $("endhead").textContent = m.winnerId ? (m.winnerId === me ? "You win" : "You lose") + " (" + m.reason + ")" : "A draw";
    $("endhp").textContent = m.final.map(f => f.id + ": " + f.hp + " HP").join("   ");
  });
})();

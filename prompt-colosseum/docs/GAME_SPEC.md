# Game spec

## Core loop

1. **Lobby.** A player creates a room (gets a 4-letter code) or joins one. The match is always
   the 5 rounds below, with fixed time and length limits. The Emperors seated are the judges
   registered on the server, topped up to 4 with random-score fakes (see `docs/JUDGES.md`).
2. **Round start.** Server picks an unused offering and broadcasts it. The timer starts on the
   server. Both players type their "testimonium", up to the round's character limit.
3. **Seal.** A player presses Seal to lock their prompt. The opponent only sees that it is
   sealed and when. When both are sealed, or the hourglass empties, the round closes. An
   empty prompt at time-out counts as an empty submission (it will score 0).
4. **Judgement.** Server sends the offering (and its hidden checklist) and both prompts to every
   seated Emperor in parallel. Round 5 has no judges: the server scores the picks.
5. **Verdict.** Scores are summed, damage and healing applied, verdict broadcast. The verdict
   shows the two prompts side by side and each Emperor's one-line remark. After ~8 s (or both
   press Next, after using /compact or /clear if they want to), the next round starts.
6. **Match end.** All 5 rounds always play. Nobody drops below 1 HP before round 5. After
   round 5 the player with more HP wins; equal HP is a draw.

## The five rounds

The shared principles every judged round scores (`SHARED` in `app/rounds.py`): **clarity**,
**constraints**, **economy**. Each judged round adds two of its own. The numbers below live in
`app/rounds.py`; this table is for reading.

| # | Round | Players write | Own criteria | Damage x | Limit |
|---|---|---|---|---|---|
| 1 | Pictvra | An image-generator prompt for the picture: subject, style, framing, negative prompt | likeness, specificity | 1.0 | 300 chars / 60 s |
| 2 | Lvdvs | A prompt that makes an AI build the named game | mechanics, done condition | 1.0 | 250 / 60 s |
| 3 | Minister | A system prompt for an agent: who it is | role and scope, escalation | 1.25 | 200 / 60 s |
| 4 | Ars | A skill: name, trigger, numbered steps: how it works | trigger, steps | 1.5 | 150 / 60 s |
| 5 | Consilivm | Pick the right model type for a task (multiple choice) | server-scored, no judges | see below | 15 s |

Rounds 2-4 give every task a hidden checklist of must-haves. It goes to the judges only (the
players don't see it), and the judges report how many items each testimony covers. Players
learn from the side-by-side prompts and the Emperors' remarks.

## Scoring

Each Emperor returns, for each testimony, five sub-scores 0–10 (the round's two criteria plus
`clarity`, `constraints`, `economy`), an overall `score` 0–10 (their holistic call, not a mean),
a `checklist` count on rounds 2–4, and one one-line remark.

- Player total = sum of `score` over Emperors who answered. A player whose context bar is above
  85% (see "Context bar") has every Emperor score multiplied by 0.8.
- If an Emperor fails or times out, it abstains; the remaining totals are scaled to the full
  panel size so that abstentions do not change the damage scale:
  `scaled = total * seated / answered`.
- An Emperor's vote = whichever testimony it scored higher, or `tie`.

## Damage

- Both players start at 100 HP. Nobody drops below 1 HP before round 5 (a last stand).
- `margin = abs(total_p1 - total_p2)` (after scaling, rounded).
- Loser takes `min(40, 10 + 3 * margin) * damage_mult` (the round's multiplier from the table).
  Only the base is capped at 40; there is no final cap, so later rounds really hit harder.
- Unanimous verdict (every answering Emperor voted the same way) is a crit: damage × 1.25 on top.
  Round 4's maximum is 40 × 1.5 × 1.25 = 75.
- Exact tie in totals: both take 5.
- Round 5 (no judges): a correct first pick deals 15 damage to the opponent, a correct second
  pick deals 5, a wrong pick deals 0. "Correct" means a pick with the top `fit` score for the
  task (`score_choice` in `app/rounds.py`). Fastest correct pick is first.

Example (round 1, x1.0): totals 26 vs 33, margin 7, damage 10 + 21 = 31, HP 72 → 41.

## Healing and the context bar

- **Checklist sweep:** covering every checklist item (judges' median) heals +5, even when you
  lose the round.
- **Context bar:** every character a player writes adds to their bar, which holds 600 for the
  whole match. The caps (300 + 250 + 200 + 150 = 900) mean writing to every cap fills it, so
  players must /compact or /clear most rounds (one compact is not enough: the bar is checked
  after the current round's text is added). Above 85% is "context rot": the player's scores are x0.8.
- **/compact** (verdict screen, between rounds): halves the bar and heals +10 when used at 60-85%
  full, +3 outside that band.
- **/clear:** empties the bar, but forfeits your next checklist-sweep heal.
- The server tracks the bar; the client only displays it.

## Socket events (Socket.IO)

Client → server

| event | payload |
|---|---|
| `room:create` | `{ name }` |
| `room:join` | `{ code, name }` |
| `room:start` | `{}` (host, once both players are in; starts the countdown) |
| `room:rejoin` | `{ code, playerId }` (after a refresh or a dropped connection; accepted until the next round starts) |
| `round:draft` | `{ text }` (optional, throttled; lets the server auto-submit on time-out) |
| `round:seal` | `{ text }` |
| `round:choose` | `{ model }` (round 5 only; a key of `MODELS`) |
| `context:reset` | `{ mode: "compact" \| "clear" }` (verdict screen, once per round) |
| `round:next` | `{}` |
| `match:yield` | `{}` (give up: the opponent wins the match at once) |

Server → client

| event | payload |
|---|---|
| `room:joined` | `{ code, you, token, name }` (private, to a new or rejoining player: `you` is `"p1"` or `"p2"`, and `token` is the `playerId` that `room:rejoin` needs; nobody else ever sees it) |
| `room:state` | `{ code, players: [{ id, name, hp, connected, context }], phase, round, rounds }` (`id` is the public slot `"p1"` / `"p2"`, the same keys the verdict uses; `context` is the bar, 0 to 1) |
| `round:start` | `{ round, kind, title, brief, maxChars, endsAt, serverNow, offering: { id, url \| task }, options, optionLabels, wildcard }` (endsAt and serverNow = server epoch ms, so the client can correct for clock skew; `options` = 4 model keys and `optionLabels` their names, round 5 only; `wildcard` = `{ id, title, rule }` or null). Sent again to a rejoining player with `you: { text, pick }` and `sealed: { p1, p2 }` added. |
| `round:sealed` | `{ playerId, at }` |
| `round:judging` | `{}` |
| `round:verdict` | see below |
| `match:end` | `{ winnerId, reason: "hp" \| "yield" \| "disconnect", final: [{ id, hp }] }` (winnerId null = draw) |
| `error` | `{ message }` |

`round:verdict` payload:

```json
{
  "round": 1,
  "totals": { "p1": 26, "p2": 33 },
  "loser": "p1",
  "damage": 31,
  "crit": false,
  "flagged": { "p1": false, "p2": false },
  "sweep": { "p1": false, "p2": true },
  "heal": { "p1": 0, "p2": 5 },
  "context": { "p1": 0.82, "p2": 0.55 },
  "hp": { "p1": 41, "p2": 58 },
  "prompts": { "p1": "...", "p2": "..." },
  "emperors": [
    { "id": "amodei", "name": "Amodei", "model": "gemini flash",
      "p1": 6, "p2": 9, "vote": "p2", "remark": "Both found the moon. Only one found the lens." }
  ]
}
```

Extra verdict fields: `dmg` (`{ p1, p2 }`, the HP each player lost; `damage` is the larger one and
`loser` the player who lost more, or null when equal), `forfeit` (`"p1"` or `"p2"`, only when a
disconnect cost them the round), and in round 5 `picks` (the model each player chose), `correct`
(the right pickers, fastest first) and `answer` (the top-fit model keys). In round 5 `prompts`
holds the picked model's name, `totals` holds each pick's 0-10 `fit` score (shown on the papers),
and `emperors` is empty. A rotted player's scores (context bar above
85%) count x0.8 in `totals` and in each Emperor's vote, while the per-Emperor numbers shown stay raw.

## Phases (per room)

`lobby → countdown(3 s) → writing → judging → verdict → (writing | finished)`

## Edge cases

- Disconnect during writing or judging: 20 s grace to `room:rejoin`. After that the player loses
  the current round: 40 × the round's multiplier damage (round 5: × 1, so 40), no crit. They can
  still rejoin until the next round starts; the forfeited round stays lost.
- Disconnect during a verdict costs nothing by itself.
- Anyone still gone when the next round starts loses the match (`match:end` reason `disconnect`).
- Yield: the player loses the match at once (`match:end` reason `yield`).
- A lobby or countdown that loses a player (grace ran out) or everyone: the remaining player gets
  an `error` ("The match was abandoned.") and the room is deleted; the client clears its saved
  session and returns to the lobby's entry form.
- `/compact` and `/clear` are accepted only on a verdict screen before round 5, once per player per
  round. A pending `/clear` penalty is used up by the next sweep that would have healed.
- Double seal: ignore after the first.
- Seal after `endsAt`: reject; the server already auto-submitted the last draft.
- Judges all fail: counts as a tie, both take 5 (no replay).
- Rate limits: after a 429 the provider cools down (its `retry-after`, at most 120 s) and that
  Emperor abstains for the round rather than waiting.

## Wildcards

`WILDCARDS` in `app/rounds.py`. Each of rounds 2-4 has a 50% chance to draw one (never round 1
or 5), shown on screen with the round brief and sent in `round:start`.

- Rules the judges enforce (Brevitas, Sine Colore, Sine Nomine, Vna Sententia): the rule goes
  into the Emperors' prompt, and a testimony that breaks it scores at most 3 overall.
- Rules the game enforces: Clepsydra halves the round's time (server). Caecvs hides the offering
  after 10 s on the client only; the server just sends the wildcard, and the judges get no rule.
- Wildcards are the one exception to the fixed per-round limits.

## Offerings

Rounds and their offering pools are hardcoded in `app/rounds.py`; image files live in
`static/offerings/`.
Use photos you have rights to (your own, CC0, public domain). The game sends the file to the
judges as it is, so resize it yourself to ~1024 px on the long side before dropping it in
(e.g. `sips -Z 1024 file.jpg`). The CRT on screen shows a pixelated 144×108 version:
`static/js/game.js` cover-crops it onto the `#battle-tv` canvas and dithers it with
`ArenaEngine.dither`.

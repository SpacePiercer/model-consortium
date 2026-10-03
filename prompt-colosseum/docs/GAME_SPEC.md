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
- Unanimous verdict (every answering Emperor voted the same way) is a crit: damage × 1.25, cap 40.
- Exact tie in totals: both take 5.
- Round 5 (no judges): a correct first pick deals 15 damage to the opponent, a correct second
  pick deals 5, a wrong pick deals 0. "Correct" means a pick with the top `fit` score for the
  task (`score_choice` in `app/rounds.py`). Fastest correct pick is first.

Example from the design: totals 26 vs 33, margin 7, damage 10 + 21 = 31, HP 72 → 41.

## Healing and the context bar

- **Checklist sweep:** covering every checklist item (judges' median) heals +5, even when you
  lose the round.
- **Context bar:** every character a player writes adds to their bar, which holds 600 for the
  whole match. The caps (300 + 250 + 200 + 150 = 900) mean writing to every cap fills it, so
  players must compact once. Above 85% is "context rot": the player's scores are x0.8.
- **/compact** (verdict screen, between rounds): halves the bar and heals +10 when used at 60-85%
  full, +3 outside that band.
- **/clear:** empties the bar, but forfeits your next checklist-sweep heal.
- The server tracks the bar; the client only displays it.

## Socket events (Socket.IO)

Client → server

| event | payload |
|---|---|
| `room:create` | `{ name, settings }` |
| `room:join` | `{ code, name }` |
| `round:draft` | `{ text }` (optional, throttled; lets the server auto-submit on time-out) |
| `round:seal` | `{ text }` |
| `round:choose` | `{ model }` (round 5 only; a key of `MODELS`) |
| `context:reset` | `{ mode: "compact" \| "clear" }` (verdict screen, once per round) |
| `round:next` | `{}` |

Server → client

| event | payload |
|---|---|
| `room:state` | `{ code, players: [{ id, name, hp, connected }], settings, phase }` |
| `round:start` | `{ round, offering: { id, url }, endsAt }` (endsAt = server epoch ms) |
| `round:sealed` | `{ playerId, at }` |
| `round:judging` | `{}` |
| `round:verdict` | see below |
| `match:end` | `{ winnerId, final: [{ id, hp }] }` |
| `error` | `{ message }` |

`round:verdict` payload:

```json
{
  "round": 3,
  "totals": { "p1": 26, "p2": 33 },
  "loser": "p1",
  "damage": 31,
  "crit": false,
  "heal": { "p1": 0, "p2": 5 },
  "context": { "p1": 0.82, "p2": 0.55 },
  "hp": { "p1": 41, "p2": 58 },
  "prompts": { "p1": "...", "p2": "..." },
  "emperors": [
    { "id": "augusta", "name": "Avgvsta", "model": "gemini flash",
      "p1": 6, "p2": 9, "vote": "p2", "remark": "Both found the moon. Only one found the lens." }
  ]
}
```

## Phases (per room)

`lobby → countdown(3 s) → writing → judging → verdict → (writing | finished)`

## Edge cases

- Disconnect during writing: 20 s grace to reconnect, then the round is forfeited
  (opponent wins the round with max damage 40).
- Double seal: ignore after the first.
- Seal after `endsAt`: reject; the server already auto-submitted the last draft.
- Judges all fail: counts as a tie, both take 5 (no replay).
- Rate limits: keep a per-provider token bucket; if a provider is cooling down, mark that
  Emperor absent for the round rather than waiting.

## Offerings

Rounds and their offering pools are hardcoded in `app/rounds.py`; image files live in
`static/offerings/`.
Use photos you have rights to (your own, CC0, public domain). Resize to ~1024 px on the long
side for the judges; the CRT on screen shows a pixelated 144×108 version (draw the image into
the `#tv` canvas, then optionally dither with `ArenaEngine.paintOffering` replaced by your own
draw + dither).

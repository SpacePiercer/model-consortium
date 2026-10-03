# Game spec

## Core loop

1. **Lobby.** A player creates a room (gets a 4-letter code) or joins one. Host picks the
   hourglass (30/60/90 s), format (best of 3 / best of 5 / last one standing), offering pool,
   and which Emperors are seated (at least 2).
2. **Round start.** Server picks an unused offering and broadcasts it. The timer starts on the
   server. Both players type in their own "testimonium" (max 400 characters).
3. **Seal.** A player presses Seal to lock their prompt. The opponent only sees that it is
   sealed and when. When both are sealed, or the hourglass empties, the round closes. An
   empty prompt at time-out counts as an empty submission (it will score 0).
4. **Judgement.** Server sends the image and both prompts to every seated Emperor in parallel.
5. **Verdict.** Scores are summed, damage applied, verdict broadcast. After ~8 s (or both press
   Next), the next round starts. Match ends when the format is decided or someone reaches 0 HP.

## Scoring

Each Emperor returns, for each testimony, three sub-scores 0–10: `likeness`, `specificity`,
`craft`, and an overall `score` 0–10 (their holistic call, not a mean), plus a one-line remark.

- Player total = sum of `score` over Emperors who answered.
- If an Emperor fails or times out, it abstains; the remaining totals are scaled to the full
  panel size so that abstentions do not change the damage scale:
  `scaled = total * seated / answered`.
- An Emperor's vote = whichever testimony it scored higher, or `tie`.

## Damage

- Both players start at 100 HP.
- `margin = abs(total_p1 - total_p2)` (after scaling, rounded).
- Loser takes `min(40, 10 + 3 * margin)` damage.
- Unanimous verdict (every answering Emperor voted the same way) is a crit: damage × 1.25.
- Exact tie in totals: both take 5.

Example from the design: totals 26 vs 33, margin 7, damage 10 + 21 = 31, HP 72 → 41.

## Socket events (Socket.IO)

Client → server

| event | payload |
|---|---|
| `room:create` | `{ name, settings }` |
| `room:join` | `{ code, name }` |
| `room:settings` | `{ hourglass, format, pool, seated: [bool×4] }` (host only, lobby only) |
| `round:draft` | `{ text }` (optional, throttled; lets the server auto-submit on time-out) |
| `round:seal` | `{ text }` |
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
- Judges all fail: void the round, no damage, replay with a new offering.
- Rate limits: keep a per-provider token bucket; if a provider is cooling down, mark that
  Emperor absent for the round rather than waiting.

## Offerings

Rounds and their offering pools are hardcoded in `app/rounds.py`; image files live in
`static/offerings/`.
Use photos you have rights to (your own, CC0, public domain). Resize to ~1024 px on the long
side for the judges; the CRT on screen shows a pixelated 144×108 version (draw the image into
the `#tv` canvas, then optionally dither with `ArenaEngine.paintOffering` replaced by your own
draw + dither).

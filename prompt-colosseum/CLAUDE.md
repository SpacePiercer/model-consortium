# Prompt Colosseum — instructions for Claude Code

A two-player, real-time web game. Both players see the same image ("the offering") and have a
timer to write the prompt that best describes it. A panel of AI "Emperors" (vision LLMs from
different providers) scores both prompts against the image. The loser takes damage. Best of five.

Start by reading, in this order:

1. `docs/GAME_SPEC.md` — game loop, rules, damage, socket events, state.
2. `docs/JUDGES.md` — judge system prompt, JSON schema, providers, prompt-injection defence.
3. `design/README.md` — the visual direction and how the prototypes are built.
4. Open `design/index.html` in a browser to see the three screens (lobby, battle, verdict).
5. `PLAN.md` — build phases, current status, and where the team still owes input.

## Stack

- Backend: Python 3.11+, Flask, Flask-SocketIO (eventlet or gevent), httpx for judge calls.
- Frontend: plain HTML/CSS/JS served by Flask (no framework needed). Socket.IO client.
- Rendering: `design/arena.js` draws the whole 3D-ish colosseum into a 320×180 canvas that is
  scaled up with `image-rendering: pixelated`. Reuse it as-is; do not rewrite it in WebGL.
- State: in memory (dict of rooms). No database for the MVP.

## Target layout

```
app/
  __init__.py          # Flask app + SocketIO
  rooms.py             # Room / Player / Round dataclasses, state machine
  judges.py            # provider clients, fan-out, parsing, aggregation
  rounds.py            # round themes, offering/task pools, wildcards, judge prompts
  events.py            # socket handlers
static/
  js/arena.js          # copied from design/arena.js
  js/lobby.js, battle.js, verdict.js
  css/theme.css        # extracted from the prototypes
  offerings/           # images referenced by the pools in app/rounds.py
templates/
  lobby.html, battle.html  (battle.html also renders the verdict state)
tests/
.env.example
```

## Build order (each step should run end to end before the next)

1. **Static screens.** Port the three prototypes into Flask templates with the CSS pulled into
   `static/css/theme.css`. Pixel-match the prototypes; they are the spec.
2. **Rooms.** Create/join by 4-letter code, two players max, server-authoritative timer,
   prompt submit is sealed (opponent sees only "sealed"). Fake judges that return random scores.
3. **Real judges.** `judges.py` per `docs/JUDGES.md`: parallel calls, 15 s timeout, strict JSON,
   one retry, abstain on failure, A/B order randomized per judge.
4. **Verdict.** Aggregate, apply damage, broadcast verdict, drive the verdict screen
   (`ArenaEngine.set({ mode: 'verdict', loser, votes, hype: 1 })`), next round / match end.
5. **Polish.** Sounds, screen shake on damage, reconnect handling, practice mode.

## Rules

- API keys live only on the server (`.env`). Never send them to the browser.
- The client never decides scores, damage, or the timer. The server is the source of truth.
- Treat player prompts as untrusted data. Follow the injection defence in `docs/JUDGES.md`.
- Keep the fonts. The design deliberately mixes Jacquard 24, Jacquarda Bastarda 9, Jersey 10,
  Doto, Cinzel Decorative, Special Elite and Workbench (all Google Fonts). Do not swap them for
  system or generic fonts.
- Keep the 320×180 internal resolution and the dither pass; that is the look.
- Write small pytest tests for: scoring aggregation, damage formula, judge JSON parsing,
  timer expiry auto-submit, disconnect forfeits.

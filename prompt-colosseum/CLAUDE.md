# Prompt Colosseum — instructions for Claude Code

A two-player, real-time web game that teaches prompting an AI. Every match is the same five
rounds: describe a picture for an image generator, prompt an AI to build a game, brief an agent,
write a skill, and pick the right model for a task. A panel of AI "Emperors" (LLMs from different
providers) scores both players' prompts in rounds 1-4; round 5 is scored by the server. The loser
of each round takes damage; higher HP after round 5 wins.

Start by reading, in this order:

1. `docs/GAME_SPEC.md` — game loop, rules, damage, socket events, state.
2. `docs/JUDGES.md` — providers, request and parsing rules, prompt-injection defence (the live
   judge prompt and schema are in `app/prompts/`).
3. `design/README.md` — the visual direction and how the prototypes are built.
4. Open `design/index.html` in a browser to see the three screens (lobby, battle, verdict).
5. `PLAN.md` — build phases, current status, and where the team still owes input.

## Stack

- Backend: Python 3.11+, Flask, Flask-SocketIO (threading mode + simple-websocket; gunicorn with threads), httpx for judge calls.
- Frontend: plain HTML/CSS/JS served by Flask (no framework needed). Socket.IO client.
- Rendering: `design/arena.js` draws the whole 3D-ish colosseum into a 320×180 canvas that is
  scaled up with `image-rendering: pixelated`. Reuse it; the only planned edit is exporting
  `dither` for the offering pictures. Do not rewrite it in WebGL.
- State: in memory (dict of rooms). No database for the MVP.

## Target layout

```
app/
  __init__.py          # Flask app + SocketIO
  rooms.py             # Room / Player / Round dataclasses, state machine
  judges.py            # provider clients, fan-out, parsing, aggregation
  rounds.py            # round themes, offering/task pools, wildcards, judge prompt builder
  prompts/             # editable judge text: judge.md, personas/, rubrics/, cases/ (see its README)
  calibrate.py         # live check that the judges pick the winners in prompts/cases/
  events.py            # socket handlers
static/
  js/arena.js          # copied from design/arena.js (+ exports dither, noiseField)
  js/emperors.js       # copied from design/emperors.js (emperor portraits; load before arena.js)
  js/fx.js             # copied from design/fx.js (the drama layer)
  js/game.js           # lobby, battle and verdict on one page, one Socket.IO connection
  css/theme.css        # extracted from the prototypes
  offerings/           # images referenced by the pools in app/rounds.py
templates/
  game.html            # lobby, battle and verdict sections
tests/
run.py                 # dev server: .venv/bin/python run.py (port 5001; one process, rooms are in memory)
requirements.txt       # python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
requirements-dev.txt   # adds the Socket.IO client that scripts/smoke.py needs
scripts/smoke.py       # plays a whole match with two bots against any running server (the deploy check)
../render.yaml         # Render blueprint (repo root): gunicorn -w 1 --threads 100 run:app
.env.example
```

## Build order (each step should run end to end before the next)

1. **Static screens.** Port the three prototypes into Flask templates with the CSS pulled into
   `static/css/theme.css`. Pixel-match the prototypes' look and layout. Their sample text and
   numbers are placeholders: rules, limits and numbers come from `docs/` and `app/rounds.py`.
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
- Keep the fonts. The design deliberately mixes Jacquard 24 (big titles and ink stamps), Grenze Gotisch, Jersey 10,
  Doto, Cinzel Decorative (also the Latin slams in `design/fx.js`), Special Elite and Workbench,
  all Google Fonts. Do not swap them for
  system or generic fonts.
- Keep the 320×180 internal resolution and the dither pass; that is the look.
- Write small pytest tests for: scoring aggregation, damage formula, judge JSON parsing,
  timer expiry auto-submit, disconnect forfeits.

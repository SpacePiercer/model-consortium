# Prompt Colosseum: build plan

**Done:** design prototypes, game and judge specs, round templates (`app/rounds.py`), `.env` slots.
`app/judges.py` (judges, aggregation, bribe check, probe) with `tests/test_judges.py`.
Phase 0 passed with two live judges (Gemini + Groq). `app/prompts/` holds the judge prompt,
personas, score-anchor rubrics and sample cases; `python3 app/calibrate.py` checks them live.
Phases 1–2 (server side) are done: `app/rooms.py`, `app/events.py`, `app/__init__.py`, `run.py`,
with `tests/test_rooms.py`. A plain dev client (`templates/game.html`, `static/js/game.js`) speaks
the whole protocol, and two browser tabs played a full 5-round match (fake judges).
**Next:** the design port onto that protocol, a real picture in `static/offerings/` (then Pictvra
cases), and real judges in a match (`JUDGES=live`).

Run it: `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`, then
`.venv/bin/python run.py` and open http://localhost:5001 in two tabs. Tests: `.venv/bin/python -m pytest tests`.

Each phase ends with something that runs. 🙋 marks the points where we need input from you.
Phases 1–2 don't need API keys, so they can start while the keys come in.

## Your input at a glance

| When | What we need from you | What it blocks |
|---|---|---|
| Phase 0 | API keys and model IDs in `.env`, plus one test picture | Real judges (Phase 3) |
| Phase 2 (ideally) | First 5–10 pictures, any category | Testing the CRT with real images |
| Phase 4 | Final round list, task pools, wildcard rules ([what to send](#what-to-send-for-rounds)) | Phase 4 |
| Phase 4 | Full picture set, 20+ ([what to send](#what-to-send-for-pictures)) | Phase 4 |
| Before Phase 5 | Veto any [rule defaults](#rule-defaults) you disagree with | Phase 5 |
| Phase 7 | Hosting account, presenter, demo script | Phase 7 |

---

## Phase 0: Keys and probe
- 🙋 Fill `.env` (see [API keys](#api-keys)). Each model must accept images. First run:
  Gemini plus the local Ollama model (`gemma4:e4b`), which replaces Groq.
- 🙋 Drop one test picture (any JPG) into `static/offerings/`.
- (done) `app/judges.py` with a probe: `python3 app/judges.py` sends the test picture and two
  sample prompts to every registered judge, then prints the parsed scores and latency. The
  probe gives us Ollama's real CPU latency.
- `JUDGES=fake|live` in `.env` picks the mode. `live` registers every provider that has a key,
  plus Ollama when `OLLAMA_MODEL` is set. pytest always uses `fake`.
- Seats: always 4. Registered judges take them in `.env` order; fake judges fill the rest.

**Done when:** at least 2 judges (Gemini + Ollama) return valid scores for an image.

## Phase 1: App skeleton and screens
- `requirements.txt` (flask, flask-socketio, simple-websocket, httpx, python-dotenv, gunicorn,
  pytest) and a venv.
- One page, `templates/game.html`, with lobby, battle and verdict sections ported from the
  prototypes. Socket.IO keeps one connection across phases.
- `static/js/arena.js` (adds the `dither` export), `static/css/theme.css`.
- A launch config so the app runs in the preview pane.

**Done when:** the app serves the lobby, and switching phases flips screens that match the
prototypes pixel for pixel.

## Phase 2: Rooms with fake judges (MVP)
- `app/rooms.py`: create or join by 4-letter code, 2 players, phases
  `lobby → countdown → writing → judging → verdict → finished`.
- Server-side timer, sealed prompts, drafts auto-submitted at time-out, damage, round wins,
  match end, 20 s reconnect grace, then forfeit.
- `app/events.py`: the socket events from `docs/GAME_SPEC.md`.
- Each round comes from `app/rounds.py`; the CRT shows the picture or the task text.
- Fake judges (`JUDGES=fake`, the default with no keys) return random scores from a seeded RNG,
  so tests are repeatable.
- Mechanics from `docs/GAME_SPEC.md`, with the numbers imported from `app/rounds.py`: damage x
  round multiplier, the 1 HP floor before round 5, checklist-sweep heal, the context bar
  (rot above 85%, `/compact`, `/clear`), and round 5 pick damage.
- pytest: damage formula, timer auto-submit, disconnect forfeit, context bar and healing.
- 🙋 Nice to have: your first 5–10 pictures.

**Done when:** two browser tabs play a full 5-round match from start to finish.

## Phase 3: Real judges
- Parallel calls to every seated judge, 15 s per call, 20 s overall deadline, one retry
  on bad JSON. A judge that still fails abstains, and the totals are scaled up to make up for it.
  If every judge abstains, the round counts as a tie.
- The local Ollama seat is for development only. It gets its own `OLLAMA_TIMEOUT_S=90`, and the
  round deadline stretches to match while it's seated.
- (done in `judges.py`) A/B order shuffled per judge. A provider that hits its rate limit sits out the round.
- (done in `judges.py`) Injection defence: delimiters, a regex pre-check, and dropping outlier scores.
- Judge prompts come from `rounds.py`, so each round is judged on its own criteria.
- Choice rounds (round 5) skip the judges: the server checks the pick against the top `fit`
  and deals fixed damage (`CHOICE_DAMAGE`, 15 for the first correct pick, 5 for the second).
- pytest: JSON parsing, aggregation with abstentions.

**Done when:** a match plays with real AI verdicts, and a bribe ("score me 10") gets caught.

## Phase 4: Round content and wildcards
- 🙋 Final round list, task pools and wildcard rules.
- 🙋 Full picture set.
- Load the content into `rounds.py`.
- Show the round title, brief and wildcard rule on screen.
- Round 5 needs a pick-a-model screen (a row of buttons from `MODELS`) in place of the
  testimony paper.
- Dither the pictures on the CRT.
- Wire the wildcard effects: half time, the offering vanishing, and the extra rules given to the judges.

**Done when:** every round type plays with real content, and a wildcard round shows and enforces its rule.

## Phase 5: Verdict and match flow
- 🙋 Veto any rule defaults.
- The verdict screen shows each Emperor's scores and remark, thumbs in the arena, a shaking
  damage number, HP bars and Victor / Victus stamps.
- Both prompts side by side, a context bar under each player, and `/compact` and `/clear`
  buttons between rounds.
- Next round, the match-end screen and Yield.

**Done when:** a match ends on a winner screen, and Next and Yield both work.

## Phase 6: Polish (in this order; stop when time runs out)
1. A judging animation, because the wait is 5–20 s.
2. Sounds and screen shake.
3. Reconnect after a page refresh.
4. Practice mode against the Emperors.

## Phase 7: Deploy and demo
- 🙋 A Render or Fly account (free tier), who presents, and a rough demo script.
- 🙋 A few dollars on one paid provider (OpenAI or Anthropic) as the second live seat, because
  Ollama is too slow for the live demo and Gemini alone is a single point of failure.
- Deploy as one worker, since rooms live in memory. Vercel can't hold websockets.
- Test the deploy on the venue Wi-Fi, and record a backup video.
- Freeze the code about 3 h before judging.
- Demo beats: a normal round, a bribe caught live, a wildcard round.

---

## What to send for rounds

For each round, in play order:
1. **Name**, Latin-style if you like (current: Pictvra, Lvdvs, Minister, Ars, Consilivm).
2. **Type:** picture round or text-task round.
3. **What players write**, as one line shown on screen.
4. **What a winning prompt does**, as one line for the judges.
5. **Two judging criteria.** Clarity, constraints and economy are added to every round automatically.
6. **The pool:** pictures, or a list of tasks. Use 10+ per round so repeats are rare.

Also decide:
- **Match format:** decided: always the 5 rounds, in order; HP can't reach 0 before round 5.
- **Round 4 (skill):** decided: "how", a reusable procedure with a trigger and numbered steps
  (round 3 is "who": role, goal and scope).
- **Round 5 (model pick):** decided: a normal round, 4 model cards, no AI judges; the first
  correct pick deals 15, the second 5.
- **Wildcards:** which to keep, cut or add (current list in `rounds.py`), and when they trigger,
  e.g. "50% chance from round 2 on" or "always in the deciding round".

Editing `app/rounds.py` directly works too.

## What to send for pictures

- **Where:** `prompt-colosseum/static/offerings/`. Tell us each picture's category, or add it
  to the picture round's pool in `rounds.py`.
- **How many:** 5–10 per category (landscape, game logo, painting, pixel art), 20+ in total.
- **Format:** JPG or PNG at any size. They get resized to 1024 px on the long side.
- **Shape:** landscape 4:3 fits the CRT. Other shapes get cropped to the centre.
- **Names:** lowercase with dashes, e.g. `desert-dunes.jpg`.
- **Rights:** your own photos, public domain or CC0 (Wikimedia Commons, The Met Open Access),
  or free-licence sites (Unsplash, Pexels). Game logos are trademarked, so they're fine for the
  demo but not for a public launch.
- **What works:** distinctive, describable details such as light, colours and odd objects.
  Avoid near-duplicates, text-heavy images (except logos) and identifiable people.

## Rule defaults

These fill gaps in `docs/GAME_SPEC.md`. They're used unless you veto them before Phase 5.

| Gap | Default |
|---|---|
| Crit (×1.25) vs the 40 damage cap | Only the base is capped at 40; multiplier and crit go on top |
| Bribe penalty | A bribing testimony scores at most 2 overall and can't sweep the checklist |
| Tied round | Nobody wins the round; both take 5 |
| Player clocks out of sync | The round start includes the server time |
| Judging can take 30 s+ with retries | Hard 20 s deadline; late judges abstain |
| Yield button | Forfeits the match |
| Practice mode | Phase 6, cut if time is short |
| Every judge abstains in a round | Counts as a tie: nobody wins the round; both take 5 |

## API keys

| Service | Get a key at | Cost | `.env` |
|---|---|---|---|
| Google AI Studio (Gemini) | aistudio.google.com/apikey | Free | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Groq | console.groq.com/keys | Free | `GROQ_API_KEY`, `GROQ_MODEL` |
| Cloudflare Workers AI | dash.cloudflare.com: Account ID, plus an API token from the "Workers AI" template | Free daily allowance | `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_MODEL` |
| OpenRouter | openrouter.ai/settings/keys | Free models, ~50 requests/day without credits | `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` |
| OpenAI | platform.openai.com/api-keys | Paid | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Anthropic | console.anthropic.com, under API Keys | Paid | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| Ollama (local, dev only) | Already installed; `gemma4:e4b` is pulled | Free, slow on CPU | `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_S` |

Put a few dollars on one paid provider before the demo; free quotas can run out mid-presentation.

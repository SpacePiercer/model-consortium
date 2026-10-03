# Judge prompts

Everything the Emperors are told lives here, as plain files. Edit them and the next round uses
the new text (no restart). The code that stitches them together is `system_prompt()` in
`app/rounds.py`.

| File | What it is |
|---|---|
| `judge.md` | The judging procedure and prompt template. `{{placeholders}}` are filled per round: `persona`, `goal`, `rubric`, `guide`, `twist`, `count`, `keys`. Leave the JSON schema and the untrusted-input paragraph alone unless you know why. |
| `personas/<id>.md` | One Emperor's temperament: what they prize, how they break ties, how their remark sounds. Ids: `amodei`, `altman`, `zuckerberg`, `musk`. They shape tie-breaks and voice, never the rubric. |
| `rubrics/<round>.md` | Score anchors (what a 2, a 5, a 9 looks like) for each criterion of that round, one `## criterion` section each. |
| `rubrics/shared.md` | Anchors for `clarity`, `constraints`, `economy`, used when a round file has no section for that name. |
| `cases/<round>.json` | Sample testimonies with the winner we expect: a test set for the judges. |

The criteria themselves (names and one-line definitions, which also become the JSON keys the
judges answer with) live in `ROUNDS` and `SHARED` in `rounds.py`. A criterion with no anchors
still works; it just goes unguided.

## Does it still work?

```bash
python3 tests/test_prompts.py        # structure: every criterion has anchors, cases fit the limits
python3 app/calibrate.py             # live: do the real judges pick the winners we expect?
python3 app/calibrate.py minister    # one round only
```

`calibrate.py` makes real API calls (one per judge per case) and pauses 10 s between cases to
stay under Groq's free per-minute limit. A MISS means the panel's totals picked a different winner than
expected: read each judge's scores, then fix the rubric anchors or the case, whichever was wrong.

## Adding things

- **A case:** add an object to `cases/<round>.json`: `id`, `offering` (a pool id), `p1`, `p2`,
  `winner`, `why`. Keep each prompt within the round's `max_chars`. Put `bribe` in the id if
  `p1` begs the judges for marks (the test checks that exactly those cases trip the filter).
- **Pictura cases:** none yet, because they need the real pictures. Once a picture is in
  `static/offerings/`, add `cases/pictura.json` with that picture's pool id.
- **A new round:** add its entry to `ROUNDS`, then `rubrics/<id>.md` with a section per criterion.

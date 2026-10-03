# Design

Open `index.html` to browse the three screens. Each is a fixed 1440×810 stage that scales to
the window.

| File | Screen |
|---|---|
| `lobby.html` | Title, enter/join, rules of the games, seat the Emperors, CRT on standby |
| `battle.html` | Writing phase: both gladiators at typewriters, the offering on the CRT |
| `verdict.html` | Scores per Emperor, damage, revealed testimonies, next round |

## Look

PS1 / Y2K horror-arcade colosseum at dusk. Low-poly stands with flat cardboard-cutout crowd
sprites in robes, belted tunics and animal hides, low-poly caricature emperors in a Red Room lodge (red drapes, zigzag ledge), gladiators in crested helmets at typewriters,
everything rendered at 320×180 and crushed with a 4×4 ordered dither. Crisp HTML UI floats on
top (paper testimonies, marble name plates, stone buttons, a beige CRT).

## arena.js

`ArenaEngine.create(canvas, options)` renders the scene into a 320×180 canvas at ~20 fps.
Options are documented at the top of the file. Useful live changes:

```js
arena.set({ typing: 'both' });                                     // both players typing
arena.set({ mode: 'verdict', loser: 'p1',
            votes: ['p2', 'p2', 'tie', 'p2'], hype: 1 });          // verdict pose
arena.set({ seated: [1, 1, 0, 1] });                               // empty throne
arena.set({ depth: 3 });                                           // crunchier colour
```

Gladiator poses are derived from options: `typing` (hands on keys), idle, `hit` (helmet
knocked back, blood, red flash on their half), `victory` (sword raised). Emperors with a vote
raise a thumb on the side of the gladiator they favoured.

`#tv` is a 144×108 canvas inside the CRT. `tvMode: 'offering'` paints a placeholder; in the
real game draw the actual offering image into it (nearest-neighbour downscale) and dither.
`tvMode: 'static'` animates TV snow (lobby).

## Fonts (Google Fonts)

| Font | Used for |
|---|---|
| Jacquard 24 | Big titles and ink stamps only (hard to read below ~40px) |
| Grenze Gotisch | Labels, body copy, small headings, buttons (readable blackletter) |
| Jersey 10 | Gladiator names, JOIN |
| Doto | Timer, HP, scores, character count |
| Cinzel Decorative | Emperor names |
| Special Elite | Typed testimonies, paper labels |
| Workbench | Model names, CRT captions |
| Dela Gothic One | Manga-style sound effects (`fx.js`) |

## Palette

| Token | Hex |
|---|---|
| Player 1 (you) | `#B6FF4A` |
| Player 2 | `#FF4FB0` |
| Damage | `#FF3B30` |
| Gold text | `#F0D9A0` |
| Bone text | `#EFE6D2` |
| Parchment | `#F3ECD8` → `#E2D8BE` |
| Ink | `#1d1a16` |
| Marble plate | `#ECE2CB` → `#BBAD92` |
| Stone button | `#D6C29C` → `#8A7556` |
| Night | `#070506` |

## Layout anchors (stage px)

- Emperor plates (lobby only; dropped from battle and verdict): centres x = 511, 650, 790, 929; top 400; 128×44. These line up with the
  emperors drawn by `arena.js`; if you move the lodge in the renderer, move the plates.
- Battle: one big testimony sheet, left 60, top 432, 880×336, text 25px; opponent shows only a "writing…" tag under their HP bar.
- Verdict: testimony papers left 180 / 1020, top 414, 240×190; platen rollers at top 592.
- CRT: lobby left 562, top 452, 316 wide; battle left 1010, top 196, scaled 1.25. Screen 288×216.
- Seal button: left 884, top 668, 104×104.

## fx.js (drama layer)

Manga / JoJo-style effects on top of every screen. `FX.init()` once, then:

| Call | Effect |
|---|---|
| `FX.menace({x, y, w, h, color})` | floating ゴゴゴ in a zone, returns `stop()` |
| `FX.pop(text, x, y)` | one-off sound effect (オラ, ドド) |
| `FX.slam(text, {sub, color})` | giant centred impact text (ドン!) |
| `FX.lines(ms)` | radial speed lines |
| `FX.invert(n)` | negative-colour flash |
| `FX.shake(ms, px)` | stage shake |
| `FX.tbc(cb)` | sepia freeze + "TO BE CONTINUED" arrow |

Wiring in the prototypes: lobby title slam-in, 参戦! on Enter; battle menace around both
gladiators, オラ pops while typing, red timer + ゴゴゴ at 10 s, shake in the last 5 s, ドン! SEALED
on Seal; verdict ドン! entrance, menace around the winner, ドドド by the damage, To Be Continued on
Next Round, ガーン on Yield. Reduced-motion users get no loops, flashes or shakes.

## Emperors (emperors.js)

The four emperors are goofy low-poly caricatures of AI CEOs in laurel wreaths, left to right:
Dario Amodei (giant curly hair, glasses, grin, toga), Sam Altman (huge googly eyes, tunic),
Mark Zuckerberg (Caesar curls, a whole wolf on his head, pelt, gold chain) and Elon Musk (big
jaw, smirk, dark robe).

They come from an AI-generated reference render, `tools/emperors_source.jpg`, cut out as one
group by `tools/cut_emperors.py` so their overlaps stay as rendered: a hand-traced hull keeps
the torch and pillars out, the red curtain is colour-keyed away by flood fill from outside,
and near-black curtain folds are only removed inside listed gap boxes (they match Amodei's
hair and Musk's robe). The group is cropped at the ledge, downscaled to 2 texels per arena
pixel and stored as one PNG data URI (`window.EMPERORS`). Rerun with
`python design/tools/cut_emperors.py` (needs Pillow and numpy).

To sit in the arena instead of looking pasted on, `arena.js` gives the group an ink outline,
a drop shadow on the curtain, warm torchlight from the left, a contact shadow at the ledge and
the same ordered dither as the arena. Votes show as a small pixel thumbs-up beside each head on
the favoured gladiator's side. Lobby name plates sit under the faces (stage x 574, 675, 767,
882). Load `emperors.js` before `arena.js`.

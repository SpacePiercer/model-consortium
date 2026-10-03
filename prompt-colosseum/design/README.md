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
sprites, pixel-art emperors in a purple lodge, gladiators in crested helmets at typewriters,
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
| Jacquard 24 | Titles, stamps, stone buttons, wax seals |
| Jacquarda Bastarda 9 | Labels and body copy |
| Jersey 10 | Gladiator names, JOIN |
| Doto | Timer, HP, scores, character count |
| Cinzel Decorative | Emperor names |
| Special Elite | Typed testimonies, paper labels |
| Workbench | Model names, CRT captions |

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

- Emperor plates: centres x = 511, 650, 790, 929; top 400; 128×44. These line up with the
  emperors drawn by `arena.js`; if you move the lodge in the renderer, move the plates.
- Testimony papers: left 180 / 1020, top 414, 240×190; platen rollers at top 592.
- CRT: left 562, top 452, 316 wide; screen 288×216.
- Seal button: left 462, top 598, 66×66.

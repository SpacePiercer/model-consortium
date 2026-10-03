"""Cut the four emperors out of the reference render and embed them in design/emperors.js.

Source: tools/emperors_source.jpg (AI-generated "judges" render, 896x1200). The four are cut
out together so their overlaps stay exactly as rendered: a generous hand-traced hull keeps
the torch and stone pillars out, then the red curtain is colour-keyed away, flood-filled from
outside the figures (so dark hair and shaded skin survive). The result is cropped at the
ledge line and downscaled to TEXEL texels per arena pixel; arena.js adds outline, light,
shadow and the arena's dither at runtime.
Run: python design/tools/cut_emperors.py   (needs Pillow and numpy)
"""
import base64, io, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'emperors_source.jpg')
OUT_JS = os.path.join(HERE, '..', 'emperors.js')
LEDGE = 805          # source y where the box ledge will cover the figures
ARENA_PX = 0.115     # arena pixels per source pixel
TEXEL = 2            # texels per arena pixel
FACES = [170, 365, 545, 765]   # face centres (source x): Amodei, Altman, Zuckerberg, Musk

HULL = [(40, LEDGE), (52, 770), (80, 728), (92, 700), (70, 650), (30, 600), (18, 450), (30, 340), (90, 290), (200, 276), (300, 296), (345, 370), (470, 330),
        (495, 300), (560, 292), (640, 310), (668, 350), (720, 330), (800, 328), (860, 352), (886, 400),
        (886, LEDGE)]


# Gaps between the figures where the curtain folds are near-black; dark pixels connected to the
# background are removed only inside these boxes (source x0, y0, x1, y1).
GAPS = [(330, 280, 500, 560, 26), (625, 290, 700, 690, 26), (800, 320, 886, 420, 42), (18, 630, 90, 740, 26),
        (452, 590, 478, 695, 34), (250, 640, 290, 750, 34)]


def curtain_like(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    mx = np.maximum(g, b)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    # clearly red only: the darkest curtain folds match Amodei's hair and Musk's robe, so those
    # are left to the traced hull and the CUTS below
    return (r > 14) & ((r - mx) > 0.6 * np.maximum(r, 1)) & (lum < 120)


def flood(seed, allowed):
    cur = seed & allowed
    while True:
        g = cur.copy()
        g[1:] |= cur[:-1]; g[:-1] |= cur[1:]; g[:, 1:] |= cur[:, :-1]; g[:, :-1] |= cur[:, 1:]
        g &= allowed
        if (g == cur).all():
            return cur
        cur = g


if __name__ == '__main__':
    src = Image.open(SRC).convert('RGB')
    a = np.asarray(src)
    hull = Image.new('L', src.size, 0); ImageDraw.Draw(hull).polygon(HULL, fill=255)
    inside = np.asarray(hull) > 0
    lum = (0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2])
    dark_gap = np.zeros(inside.shape, bool)
    for x0, y0, x1, y1, thr in GAPS:
        dark_gap[y0:y1, x0:x1] |= lum[y0:y1, x0:x1] < thr
    allowed = curtain_like(a) | ~inside | dark_gap
    seed = np.zeros_like(inside); seed[0, :] = seed[:, 0] = seed[:, -1] = True
    bg = flood(seed, allowed)
    # open to drop curtain slivers, then strip curtain-coloured pixels left along the edges
    fg = Image.fromarray((~bg & inside).astype(np.uint8) * 255)
    fg = fg.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    fga = np.asarray(fg) > 0
    core = np.asarray(fg.filter(ImageFilter.MinFilter(9))) > 0
    fga = fga & ~(curtain_like(a) & ~core)
    xs = np.nonzero(fga[:LEDGE].any(0))[0]; ys = np.nonzero(fga[:LEDGE].any(1))[0]
    box = (int(xs[0]), int(ys[0]), int(xs[-1]) + 1, LEDGE)
    rgba = np.dstack([a, fga.astype(np.uint8) * 255])
    fig = Image.fromarray(rgba, 'RGBA').crop(box)
    k = ARENA_PX * TEXEL
    w, h = round(fig.width * k), round(fig.height * k)
    # downscale colour with premultiplied alpha so the edges do not pick up the curtain
    pm = np.asarray(fig).astype(np.float32); pm[..., :3] *= pm[..., 3:] / 255
    small = np.asarray(Image.fromarray(pm.astype(np.uint8), 'RGBA').resize((w, h), Image.BOX)).astype(np.float32)
    al = small[..., 3:]
    small[..., :3] = np.where(al > 0, small[..., :3] * 255 / np.maximum(al, 1), 0)
    small[..., 3] = np.where(al[..., 0] > 140, 255, 0)
    out = Image.fromarray(np.clip(small, 0, 255).astype(np.uint8), 'RGBA')
    out.save(os.path.join(os.environ.get('TEMP', HERE), 'emperors_preview.png'))
    buf = io.BytesIO(); out.save(buf, 'PNG', optimize=True)
    data = {'texel': TEXEL, 'w': w, 'h': h,
            'faces': [round((fx - box[0]) * k) for fx in FACES],
            'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/*\n * The four emperors (Amodei, Altman, Zuckerberg, Musk) cut out of tools/emperors_source.jpg\n'
                ' * by tools/cut_emperors.py. Generated; rerun the script instead of editing.\n'
                ' * w/h in texels (texel per arena px); faces = face-centre x in texels; bottom sits on the ledge.\n */\n')
        f.write('window.EMPERORS = ' + json.dumps(data) + ';\n')
    print('ok', w, h, data['faces'], os.path.getsize(OUT_JS))

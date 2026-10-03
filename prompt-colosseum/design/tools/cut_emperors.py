"""Cut the four emperors out of the reference render and embed them in design/emperors.js.

Sources (AI-generated "judges" renders, 896x1200): emperors_source.jpg (neutral),
emperors_happy.png (the player won the round) and emperors_mad.jpg (the player lost). Each is cut
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
OUT_JS = os.path.join(HERE, '..', 'emperors.js')
ARENA_PX = 0.115     # arena pixels per source pixel (all sources are 896x1200 at the same scale)
TEXEL = 2            # texels per arena pixel


def hull(ledge, left, right=((886, 400),)):
    """Generous outline around the four: torch and stone pillars stay outside."""
    return left + [(90, 290), (200, 276), (300, 296), (345, 370), (470, 330),
                   (495, 300), (560, 292), (640, 300), (668, 350), (720, 330), (800, 325), (860, 352)] + list(right) + [
                   (886, ledge)]


# One entry per mood. ledge = source y where the box ledge covers the figures; faces = face
# centres (source x), left to right Amodei, Altman, Zuckerberg, Musk. gaps = boxes between the
# figures where the curtain folds are near-black (x0, y0, x1, y1, luminance threshold); dark
# pixels joined to the background are removed only inside them.
MOODS = {
    'neutral': {
        'src': 'emperors_source.jpg', 'ledge': 805, 'faces': [170, 365, 545, 765],
        'left': [(40, 805), (52, 770), (80, 728), (92, 700), (70, 650), (30, 600), (18, 450), (30, 340)],
        'gaps': [(330, 280, 500, 560, 26), (625, 290, 700, 690, 26), (800, 320, 886, 420, 42), (18, 630, 90, 740, 26),
                 (452, 590, 478, 695, 34), (250, 640, 290, 750, 34)],
    },
    'happy': {   # shown when the player wins the round
        'src': 'emperors_happy.png', 'ledge': 805,   # same line as neutral, so heads don't jump
        'faces': [170, 365, 540, 760],
        'left': [(32, 872), (36, 830), (58, 775), (100, 752), (110, 690), (95, 655), (60, 640), (28, 600), (20, 450), (48, 350)],
        'right': [(874, 420), (874, 700), (886, 730)],
        'gaps': [(330, 280, 470, 500, 30), (430, 480, 486, 780, 45), (440, 300, 500, 480, 40), (640, 300, 700, 560, 38),
                 (480, 280, 660, 335, 45), (800, 300, 886, 400, 42), (18, 600, 100, 770, 34), (272, 600, 300, 790, 36)],
        'protect': [(660, 690, 896, 872)],   # Musk's maroon robe trim looks like curtain
    },
    'mad': {     # shown when the player loses the round
        'src': 'emperors_mad.jpg', 'ledge': 805,   # same line as neutral, so heads don't jump
        'faces': [168, 368, 540, 765],
        'left': [(32, 872), (36, 830), (58, 775), (100, 752), (110, 690), (95, 655), (60, 640), (28, 600), (20, 450), (48, 350)],
        'right': [(874, 420), (874, 700), (886, 730)],
        'gaps': [(330, 280, 470, 500, 30), (430, 480, 486, 780, 45), (440, 300, 500, 480, 40), (640, 300, 700, 560, 38),
                 (480, 280, 660, 335, 45), (800, 300, 886, 400, 42), (18, 600, 100, 770, 34), (272, 600, 300, 790, 36)],
        'protect': [(660, 690, 896, 872)],   # Musk's maroon robe trim looks like curtain
    },
}


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


def cut(m):
    src = Image.open(os.path.join(HERE, m['src'])).convert('RGB')
    a = np.asarray(src)
    LEDGE = m['ledge']
    hm = Image.new('L', src.size, 0); ImageDraw.Draw(hm).polygon(hull(LEDGE, m['left'], m.get('right', ((886, 400),))), fill=255)
    inside = np.asarray(hm) > 0
    lum = (0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2])
    dark_gap = np.zeros(inside.shape, bool)
    for x0, y0, x1, y1, thr in m['gaps']:
        dark_gap[y0:y1, x0:x1] |= lum[y0:y1, x0:x1] < thr
    key = curtain_like(a)
    for x0, y0, x1, y1 in m.get('protect', []):
        key[y0:y1, x0:x1] = False
    allowed = key | ~inside | dark_gap
    seed = np.zeros_like(inside); seed[0, :] = seed[:, 0] = seed[:, -1] = True
    bg = flood(seed, allowed)
    # open to drop curtain slivers, then strip curtain-coloured pixels left along the edges
    fg = Image.fromarray((~bg & inside).astype(np.uint8) * 255)
    fg = fg.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    fga = np.asarray(fg) > 0
    core = np.asarray(fg.filter(ImageFilter.MinFilter(9))) > 0
    fga = fga & ~(key & ~core)
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
    buf = io.BytesIO(); out.save(buf, 'PNG', optimize=True)
    return out, {'w': w, 'h': h, 'faces': [round((fx - box[0]) * k) for fx in m['faces']],
                 'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}


if __name__ == '__main__':
    tmp = os.environ.get('TEMP', HERE)
    cuts = {}
    for name, m in MOODS.items():
        out, cuts[name] = cut(m)
        out.save(os.path.join(tmp, 'emperors_%s_preview.png' % name))
        print(name, out.size, cuts[name]['faces'])
    data = dict(texel=TEXEL, **cuts['neutral'])
    data['moods'] = {k: v for k, v in cuts.items() if k != 'neutral'}
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/*\n * The four emperors (Amodei, Altman, Zuckerberg, Musk) cut out of the renders in tools/\n'
                ' * by tools/cut_emperors.py. Generated; rerun the script instead of editing.\n'
                ' * w/h in texels (TEXEL per arena px); faces = face-centre x in texels; bottom sits on the ledge.\n'
                ' * Top level is the neutral pose; moods.happy (player won) and moods.mad (player lost).\n */\n')
        f.write('window.EMPERORS = ' + json.dumps(data) + ';\n')
    print('ok', os.path.getsize(OUT_JS))

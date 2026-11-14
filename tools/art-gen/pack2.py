"""Pack art set v2: seamless ground/roof textures, a top-down sprite atlas and restyled item icons."""
import os, sys, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts2 import TEXTURES, SPRITES, ICONS
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from style import stylize

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
DEST = sys.argv[1]
os.makedirs(DEST, exist_ok=True)
# mean colour each terrain should land on, so painted textures keep the game's palette and contrast
TARGET = {'GRASS': (68, 94, 44), 'DIRT': (104, 86, 60), 'SAND': (196, 176, 126), 'MUD': (66, 60, 42), 'ASH': (80, 76, 72), 'GRAVEL': (116, 110, 102),
          'RUBBLE': (108, 102, 94), 'WATER': (34, 78, 106), 'ROAD': (58, 59, 63), 'CONCRETE': (116, 118, 120), 'CAMPDIRT': (80, 64, 46), 'VFLOOR': (142, 120, 88)}


def seamless(a):
    """Cross-fade the image with a copy rolled by half, so opposite edges meet."""
    n = a.shape[0]
    sh = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
    yy, xx = np.mgrid[0:n, 0:n]
    d = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy)) / (n / 2)
    w = np.clip((d - 0.04) / 0.3, 0, 1)
    w = w * w * (3 - 2 * w)
    return a * w[..., None] + sh * (1 - w[..., None])


def texture(key):
    im = Image.open(os.path.join(OUT, 'tex_' + key + '.png')).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    a = seamless(a)
    if key in TARGET:
        mean = a.reshape(-1, 3).mean(0)
        a = (a - mean) * 0.85 + np.array(TARGET[key])  # keep the detail, move the average onto the palette
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)
    name = f'tex_{key}.webp'
    out.save(os.path.join(DEST, name), 'WEBP', quality=86, method=6)
    return name


def cutout(im, lo=60):
    im = im.convert('RGBA')
    a = np.array(im)
    al = a[..., 3].astype(np.float32)
    if (al < 250).mean() < 0.05:  # no alpha produced: flood away the flat background from just inside the border
        from collections import deque
        rgb = a[..., :3].astype(np.int16); h, w = rgb.shape[:2]; m = 12
        bg = np.median(np.concatenate([rgb[m, m:-m], rgb[-m, m:-m], rgb[m:-m, m], rgb[m:-m, -m]]), axis=0)
        near = np.abs(rgb - bg).sum(-1) < 70
        mask = np.zeros((h, w), bool); q = deque()
        for x in range(w):
            for y in (0, m, h - 1 - m, h - 1): q.append((y, x))
        for y in range(h):
            for x in (0, m, w - 1 - m, w - 1): q.append((y, x))
        while q:
            y, x = q.popleft()
            if y < 0 or x < 0 or y >= h or x >= w or mask[y, x]: continue
            if not near[y, x] and not (y < m or x < m or y >= h - m or x >= w - m): continue
            mask[y, x] = True; q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
        al = np.where(mask, 0, 255).astype(np.float32)
    a[..., 3] = np.clip((al - lo) * 255 / (250 - lo), 0, 255).astype(np.uint8)
    return Image.fromarray(a)


def sprite(key, maxside):
    im = cutout(Image.open(os.path.join(OUT, 'spr_' + key + '.png')), 160)
    bb = im.getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bb)
    if key.startswith('car') and im.height > im.width:  # cars face right (angle 0)
        im = im.rotate(-90, expand=True)
    k = maxside / max(im.width, im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    return stylize(im, colors=22, outline=max(2, round(maxside / 48)))


def pack(images, width=1024, pad=2):
    x = y = rowh = 0
    place = {}
    for key, im in sorted(images.items(), key=lambda kv: -kv[1].height):
        if x + im.width + pad > width:
            x, y, rowh = 0, y + rowh + pad, 0
        place[key] = [x, y, im.width, im.height]
        x += im.width + pad
        rowh = max(rowh, im.height)
    atlas = Image.new('RGBA', (width, y + rowh), (0, 0, 0, 0))
    for key, (px, py, w, h) in place.items():
        atlas.paste(images[key], (px, py))
    return atlas, place


ground = {}
for k in TEXTURES:
    if os.path.exists(os.path.join(OUT, 'tex_' + k + '.png')):
        ground[k] = texture(k)
SIZES = {'tree1': 192, 'tree2': 192, 'tree3': 160, 'pine1': 176, 'pine2': 176, 'deadtree1': 160, 'deadtree2': 160, 'core': 160, 'car_red': 160, 'car_blue': 160, 'car_white': 160, 'car_wreck': 160}
sprites = {k: sprite(k, SIZES.get(k, 96)) for k in SPRITES if os.path.exists(os.path.join(OUT, 'spr_' + k + '.png'))}
ALIAS = {'pine2': 'pine1', 'deadtree2': 'deadtree1'}  # these came out as side views
for k in ALIAS: sprites.pop(k, None)
atlas, smap = pack(sprites)
for k, v in ALIAS.items():
    if v in smap: smap[k] = smap[v]
atlas.save(os.path.join(DEST, 'spr.webp'), 'WEBP', quality=88, method=6)


def fit_square(im, size, pad=0.06):
    bb = im.getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bb)
    s = max(im.width, im.height)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0)); c.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    inner = int(size * (1 - 2 * pad))
    c = c.resize((inner, inner), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(c, ((size - inner) // 2, (size - inner) // 2))
    return out


keys = [k for k in ICONS if os.path.exists(os.path.join(OUT, 'icon_' + k + '.png'))]
cols, S = 8, 112
items = Image.new('RGBA', (cols * S, ((len(keys) + cols - 1) // cols) * S), (0, 0, 0, 0))
imap = {}
for i, k in enumerate(keys):
    items.paste(stylize(fit_square(cutout(Image.open(os.path.join(OUT, 'icon_' + k + '.png')), 130), S), colors=18, outline=3), ((i % cols) * S, (i // cols) * S))
    imap[k] = [(i % cols) * S, (i // cols) * S, S]
items.save(os.path.join(DEST, 'items.webp'), 'WEBP', quality=88, method=6)

art_path = os.path.join(DEST, 'art.json')
art = json.load(open(art_path)) if os.path.exists(art_path) else {}
art['items'] = {'file': 'items.webp', 'map': imap}
art['ground'] = ground
art['sprites'] = {'file': 'spr.webp', 'map': smap}
art['generator'] = 'Qwen/Qwen-Image-2.1-Turbo (local, 8-step) — v2 top-down set'
json.dump(art, open(art_path, 'w'), ensure_ascii=False)
for f in sorted(os.listdir(DEST)):
    print(f, os.path.getsize(os.path.join(DEST, f)) // 1024, 'KB')

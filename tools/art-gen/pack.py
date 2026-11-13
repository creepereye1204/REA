"""Pack generated art into web atlases: assets/items.webp, assets/portraits.webp, assets/scene_*.webp + art.json."""
import os, sys, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from prompts import ICONS, PORTRAITS, BOSSES, SCENES

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
DEST = sys.argv[1]
os.makedirs(DEST, exist_ok=True)


def cutout(im):
    """Use the model's alpha if it produced one; otherwise flood-remove a flat background from the borders."""
    im = im.convert('RGBA')
    a = np.array(im)
    if (a[..., 3] < 250).mean() > 0.05:
        al = a[..., 3].astype(np.float32)
        al = np.clip((al - 60) * 255 / 195, 0, 255)  # drop the faint grid the model leaves in near-transparent pixels
        a[..., 3] = al.astype(np.uint8)
        return Image.fromarray(a)
    rgb = a[..., :3].astype(np.int16)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.abs(rgb - bg).sum(-1)
    from collections import deque
    h, w = diff.shape
    mask = np.zeros((h, w), bool)
    q = deque([(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)])
    while q:
        y, x = q.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or mask[y, x] or diff[y, x] > 60:
            continue
        mask[y, x] = True
        q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    # soften the edge a little
    alpha = np.array(Image.fromarray(alpha).filter(__import__('PIL.ImageFilter', fromlist=['x']).GaussianBlur(1.2)))
    a[..., 3] = np.minimum(a[..., 3], alpha)
    return Image.fromarray(a)


def fit_square(im, size, pad=0.06):
    bb = im.getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bb)
    s = max(im.width, im.height)
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    inner = int(size * (1 - 2 * pad))
    canvas = canvas.resize((inner, inner), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(canvas, ((size - inner) // 2, (size - inner) // 2))
    return out


def atlas(keys, size, cols, conv):
    rows = (len(keys) + cols - 1) // cols
    A = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
    m = {}
    for i, (key, src) in enumerate(keys):
        f = os.path.join(OUT, src + '.png')
        if not os.path.exists(f):
            print('missing', src); continue
        im = conv(Image.open(f))
        x, y = (i % cols) * size, (i // cols) * size
        A.paste(im, (x, y))
        m[key] = [x, y, size]
    return A, m


items, imap = atlas([(k, 'icon_' + k) for k in ICONS], 112, 8, lambda im: fit_square(cutout(im), 112))
items.save(os.path.join(DEST, 'items.webp'), 'WEBP', quality=88, method=6)
pkeys = [('por_' + k, 'por_' + k) for k in PORTRAITS] + [('boss_' + k, 'boss_' + k) for k in BOSSES]
por, pmap = atlas(pkeys, 256, 4, lambda im: im.convert('RGBA').resize((256, 256), Image.LANCZOS))
por.convert('RGB').save(os.path.join(DEST, 'portraits.webp'), 'WEBP', quality=84, method=6)
scenes = {}
for k in SCENES:
    f = os.path.join(OUT, 'scene_' + k + '.png')
    if not os.path.exists(f):
        print('missing scene', k); continue
    Image.open(f).convert('RGB').resize((1280, 720), Image.LANCZOS).save(os.path.join(DEST, f'scene_{k}.webp'), 'WEBP', quality=80, method=6)
    scenes['scene_' + k] = f'scene_{k}.webp'
json.dump({'items': {'file': 'items.webp', 'map': imap}, 'portraits': {'file': 'portraits.webp', 'map': pmap}, 'scenes': scenes,
           'generator': 'Qwen/Qwen-Image-2.1-Turbo (local, 8-step)'}, open(os.path.join(DEST, 'art.json'), 'w'), ensure_ascii=False)
for f in sorted(os.listdir(DEST)):
    print(f, os.path.getsize(os.path.join(DEST, f)) // 1024, 'KB')

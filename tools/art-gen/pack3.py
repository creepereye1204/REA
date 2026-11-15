"""Pack art set v3: top-down character sprites into assets/chr.webp and add them to art.json."""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'v2'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from prompts3 import CHARS
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from style import stylize
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
DEST = sys.argv[1]
SKIP = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else set()

def cutout(im, lo=150):
    import numpy as np
    a = np.array(im.convert('RGBA'))
    al = a[..., 3].astype('float32')
    border = np.concatenate([al[0], al[-1], al[:, 0], al[:, -1]])
    if (al < 250).mean() < 0.05 or np.median(border) > 150:  # flat/grid background: flood away light, low-saturation pixels from the border
        from collections import deque
        rgb = a[..., :3].astype('int16'); h, w = rgb.shape[:2]
        light = (rgb.min(-1) > 175) & ((rgb.max(-1) - rgb.min(-1)) < 30)
        mask = np.zeros((h, w), bool); q = deque([(y, x) for y in (0, h - 1) for x in range(w)] + [(y, x) for x in (0, w - 1) for y in range(h)])
        while q:
            y, x = q.popleft()
            if y < 0 or x < 0 or y >= h or x >= w or mask[y, x] or not light[y, x]: continue
            mask[y, x] = True; q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
        al = np.where(mask, 0, 255).astype('float32')
    a[..., 3] = np.clip((al - lo) * 255 / (250 - lo), 0, 255).astype('uint8')
    return Image.fromarray(a)

def pack(images, width=1024, pad=2):
    x = y = rowh = 0; place = {}
    for key, im in sorted(images.items(), key=lambda kv: -kv[1].height):
        if x + im.width + pad > width: x, y, rowh = 0, y + rowh + pad, 0
        place[key] = [x, y, im.width, im.height]; x += im.width + pad; rowh = max(rowh, im.height)
    atlas = Image.new('RGBA', (width, y + rowh), (0, 0, 0, 0))
    for key, (px, py, w, h) in place.items(): atlas.paste(images[key], (px, py))
    return atlas, place

BIG = {'brute', 'bloater', 'fiend', 'broodmother', 'goliath', 'x13', 'bandit_boss', 'priest'}
imgs = {}
for k in CHARS:
    f = os.path.join(OUT, 'chr_' + k + '.png')
    if k in SKIP or not os.path.exists(f): continue
    try: im = cutout(Image.open(f)); bb = im.getbbox()
    except OSError: continue  # still being written
    if not bb: continue
    im = im.crop(bb); side = 160 if k in BIG else 112
    s = side / max(im.width, im.height)
    imgs[k] = stylize(im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS), colors=24, outline=max(2, side // 48))
atlas, cmap = pack(imgs)
UPRIGHT = set(os.environ.get('UPRIGHT', '').split(','))  # 3/4-view sprites shown standing up instead of rotated
for k in cmap:
    if k in UPRIGHT: cmap[k].append(1)
for a, b in [x.split(':') for x in os.environ.get('ALIAS', '').split(',') if ':' in x]:
    if b in cmap: cmap[a] = cmap[b]
atlas.save(os.path.join(DEST, 'chr.webp'), 'WEBP', quality=90, method=6)
p = os.path.join(DEST, 'art.json'); art = json.load(open(p))
art['chars'] = {'file': 'chr.webp', 'map': cmap}
json.dump(art, open(p, 'w'), ensure_ascii=False)
print(len(cmap), 'chars', os.path.getsize(os.path.join(DEST, 'chr.webp')) // 1024, 'KB')

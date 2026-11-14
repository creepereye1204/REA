"""Make generated sprites read like hand-made game art: flat colour bands from a limited palette,
softened micro-detail and one consistent dark outline. Works on RGBA images at their final size."""
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

OUTLINE = (24, 20, 18)


def stylize(im, colors=20, outline=2, sat=0.9):
    im = im.convert('RGBA')
    a = np.array(im)
    alpha = a[..., 3]
    # 1) knock down painterly micro-texture, keep edges
    rgb = Image.fromarray(a[..., :3]).filter(ImageFilter.ModeFilter(3)).filter(ImageFilter.SMOOTH)
    rgb = ImageEnhance.Color(rgb).enhance(sat)
    # 2) flat bands: quantize only the visible pixels to a small palette
    vis = alpha > 40
    if vis.sum() > 16:
        px = np.array(rgb)[vis].reshape(-1, 1, 3)
        pal_src = Image.fromarray(px.astype('uint8'))
        q = pal_src.quantize(colors=colors, method=0, dither=0).convert('RGB')
        out = np.array(rgb)
        out[vis] = np.array(q).reshape(-1, 3)
        rgb = Image.fromarray(out)
    # 3) hard-ish alpha edge + uniform outline
    al = Image.fromarray(np.where(alpha > 110, 255, 0).astype('uint8'))
    body = Image.merge('RGBA', (*rgb.split(), al))
    if outline:
        grown = al.filter(ImageFilter.MaxFilter(outline * 2 + 1))
        base = Image.new('RGBA', im.size, OUTLINE + (0,))
        base.putalpha(grown)
        base.alpha_composite(body)
        body = base
    return body

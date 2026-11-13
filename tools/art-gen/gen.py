"""Generate game art with Qwen-Image-2.1-Turbo on an 11GB Turing GPU, in two phases to fit memory.

  python gen.py enc   -> text encoder only (split GPU/CPU), saves prompt embeddings to emb/
  python gen.py gen [keys...] -> transformer (fp8 storage) + VAE, renders out/<key>.png
"""
import os, sys, time, gc, zlib, torch
sys.path.insert(0, os.path.dirname(__file__))
from prompts import ICONS, PORTRAITS, BOSSES, SCENES, ICON_STYLE, PORTRAIT_STYLE, BOSS_STYLE, SCENE_STYLE

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, 'qimg')
EMB = os.path.join(HERE, 'emb'); OUT = os.path.join(HERE, 'out')
os.makedirs(EMB, exist_ok=True); os.makedirs(OUT, exist_ok=True)

JOBS = {}
for k, v in ICONS.items(): JOBS['icon_' + k] = (ICON_STYLE.format(v), 1024, 1024)
for k, v in PORTRAITS.items(): JOBS['por_' + k] = (PORTRAIT_STYLE.format(v), 1024, 1024)
for k, v in BOSSES.items(): JOBS['boss_' + k] = (BOSS_STYLE.format(v), 1024, 1024)
for k, v in SCENES.items(): JOBS['scene_' + k] = (SCENE_STYLE.format(v), 1536, 864)


def enc():
    from diffusers import QwenImage21Pipeline
    from transformers import AutoModelForImageTextToText
    te = AutoModelForImageTextToText.from_pretrained(os.path.join(MODEL, 'text_encoder'), dtype=torch.float16,
                                                     device_map='auto', max_memory={0: '9GiB', 'cpu': '40GiB'})
    pipe = QwenImage21Pipeline.from_pretrained(MODEL, text_encoder=te, transformer=None, vae=None, dtype=torch.float16)
    for key, (prompt, w, h) in JOBS.items():
        f = os.path.join(EMB, key + '.pt')
        if os.path.exists(f): continue
        t = time.time()
        with torch.no_grad():
            pe, pm, ipm = pipe.encode_prompt(prompt, device=torch.device('cuda'))
        torch.save({'pe': pe.cpu(), 'pm': None if pm is None else pm.cpu()}, f)
        print('enc', key, tuple(pe.shape), f'{time.time() - t:.1f}s', flush=True)


def decode(pipe, latents, w, h):
    # mirrors the pipeline's own post-processing, run separately so the denoiser's activations are freed first
    import inspect
    latents = pipe._unpack_latents(latents, h, w, pipe.vae_scale_factor)
    latents = latents.to(pipe.vae.dtype)
    mean = torch.tensor(pipe.vae.config.latents_mean).view(1, pipe.vae.config.z_dim, 1, 1, 1).to(latents.device, latents.dtype)
    std = torch.tensor(pipe.vae.config.latents_std).view(1, pipe.vae.config.z_dim, 1, 1, 1).to(latents.device, latents.dtype)
    latents = latents * std + mean
    image = pipe.vae.decode(latents, return_dict=False)[0][:, :, 0]
    return pipe.image_processor.postprocess(image, output_type='pil')[0]


def gen(keys):
    from diffusers import QwenImage21Pipeline, AutoModel
    cd = torch.float16 if os.environ.get('CD', 'fp16') == 'fp16' else torch.float32
    tr = AutoModel.from_pretrained(os.path.join(MODEL, 'transformer'), dtype=cd)
    tr.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=cd)
    pipe = QwenImage21Pipeline.from_pretrained(MODEL, text_encoder=None, transformer=tr, dtype=torch.float16)
    pipe.transformer.to('cuda'); pipe.vae.to('cuda', torch.float32)
    try: pipe.vae.enable_tiling()
    except Exception as ex: print('no vae tiling', ex)
    keys = keys or list(JOBS)
    for key in keys:
        f = os.path.join(OUT, key + '.png')
        if os.path.exists(f): continue
        prompt, w, h = JOBS[key]
        d = torch.load(os.path.join(EMB, key + '.pt'))
        t = time.time()
        with torch.no_grad():
            lat = pipe(output_type='latent', prompt_embeds=d['pe'].to('cuda', pipe.transformer.dtype if False else (torch.float16 if os.environ.get('CD', 'fp16') == 'fp16' else torch.float32)), prompt_embeds_mask=None if d['pm'] is None else d['pm'].to('cuda'),
                       width=w, height=h, generator=torch.Generator('cpu').manual_seed(zlib.crc32(key.encode()))).images
            torch.cuda.empty_cache()
            img = decode(pipe, lat, w, h)
        img.save(f)
        print('gen', key, img.mode, img.size, f'{time.time() - t:.1f}s', flush=True)


if __name__ == '__main__':
    {'enc': lambda: enc(), 'gen': lambda: gen(sys.argv[2:])}[sys.argv[1]]()

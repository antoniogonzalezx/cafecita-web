"""
Genera las servilletas del servilletero a partir de las stories de PRODUCT/CONTENT/stories.

Para cada frase de API/cafecita_quotes_final.csv con story generada
(PRODUCT/CONTENT/stories, la crea PRODUCT/pipeline.py):
  · recorta la servilleta de la story y quita el fondo azul  → napkins/NN.webp
  · exporta la story completa para descargar/compartir      → stories/NN.jpg
  · escribe el índice                                        → napkins.json

Uso:  python3 servilletero/tools/build_napkins.py
      (normalmente lo lanza PRODUCT/pipeline.py al publicar)
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STORIES_DIR = os.path.join(ROOT, "PRODUCT", "CONTENT", "stories")
APP_DIR = os.path.join(ROOT, "servilletero")

sys.path.insert(0, os.path.join(ROOT, "PRODUCT"))
from catalog import load_pieces  # noqa: E402

BG = np.array([63, 72, 244], dtype=np.float32)   # azul de las stories
NAPKIN_ZONE = (0, 0, 900, 1340)                    # por encima de la marca de agua


def key_out_blue(img):
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    dist = np.linalg.norm(arr - BG, axis=2)
    alpha = np.clip((dist - 45) / 50, 0, 1)
    # bordes semitransparentes: quitar el tinte azul
    paper = np.array([242, 241, 237], dtype=np.float32)
    edge = (alpha > 0) & (alpha < 1)
    arr[edge] = paper * 0.85 + arr[edge] * 0.15
    out = Image.fromarray(np.dstack([arr, alpha * 255]).astype(np.uint8))
    # come 1 px del borde para que no quede filo azul
    out.putalpha(out.getchannel("A").filter(ImageFilter.MinFilter(3)))
    return out


def main(pieces=None):
    """pieces: frases a publicar (por defecto, todas las que tienen story)."""
    if pieces is None:
        pieces = [p for p in load_pieces()
                  if os.path.exists(os.path.join(STORIES_DIR, p.story_name))]
    os.makedirs(os.path.join(APP_DIR, "napkins"), exist_ok=True)
    os.makedirs(os.path.join(APP_DIR, "stories"), exist_ok=True)
    manifest = []
    for p in pieces:
        src = os.path.join(STORIES_DIR, p.story_name)
        if not os.path.exists(src):
            print(f"  ⚠ falta {src}")
            continue
        story = Image.open(src).convert("RGB")
        nid = f"{p.num:02d}"

        napkin = key_out_blue(story.crop(NAPKIN_ZONE))
        napkin = napkin.crop(napkin.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())
        napkin.save(os.path.join(APP_DIR, "napkins", f"{nid}.webp"), "WEBP", quality=90)
        story.save(os.path.join(APP_DIR, "stories", f"{nid}.jpg"), "JPEG", quality=90)

        manifest.append({
            "id": nid,
            "quote": p.quote,
            "author": p.author.name,
            "napkin": f"napkins/{nid}.webp",
            "story": f"stories/{nid}.jpg",
            "size": list(napkin.size),
        })
        print(f"  ✓ {nid} {p.author.name} (t{p.template}) → {napkin.size}")

    # quita servilletas de frases que ya no se publican
    keep = {m["id"] for m in manifest}
    for path in glob.glob(os.path.join(APP_DIR, "napkins", "[0-9]*.webp")) + \
            glob.glob(os.path.join(APP_DIR, "stories", "[0-9]*.jpg")):
        if os.path.splitext(os.path.basename(path))[0] not in keep:
            os.remove(path)

    with open(os.path.join(APP_DIR, "napkins.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\n{len(manifest)} servilletas listas")
    return manifest


if __name__ == "__main__":
    main()

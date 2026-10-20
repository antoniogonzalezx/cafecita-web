"""
Recorta las servilletas en blanco de las plantillas de story para rotular las noticias encima.

Para cada PRODUCT/TEMPLATES/stories_template_preview/N.png (900 × 1600, servilleta sobre azul):
  · quita el fondo azul y recorta la servilleta      → templates/N.webp
  · busca dónde empieza la solapa (el canto de abajo) → templates.json

Uso:  python3 servilletero/tools/build_templates.py
"""
import glob
import json
import os

import numpy as np
from PIL import Image

from build_napkins import APP_DIR, NAPKIN_ZONE, ROOT, key_out_blue

SRC = os.path.join(ROOT, "PRODUCT", "TEMPLATES", "stories_template_preview")


def find_fold(napkin):
    """El canto de la solapa es el salto de brillo horizontal más marcado entre el 55 % y el 80 % del alto."""
    lum = np.asarray(napkin.convert("L"), dtype=np.float32)
    h, w = lum.shape
    rows = lum[:, int(w * 0.2):int(w * 0.8)].mean(axis=1)
    grad = np.abs(rows[2:] - rows[:-2])
    lo, hi = int(h * 0.55), int(h * 0.8)
    return (lo + int(np.argmax(grad[lo:hi])) + 1) / h


def main():
    os.makedirs(os.path.join(APP_DIR, "templates"), exist_ok=True)
    manifest = []
    for path in sorted(glob.glob(os.path.join(SRC, "*.png")), key=lambda p: int(os.path.basename(p)[:-4])):
        n = os.path.basename(path)[:-4]
        napkin = key_out_blue(Image.open(path).convert("RGB").crop(NAPKIN_ZONE))
        box = napkin.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        napkin = napkin.crop(box)
        napkin.save(os.path.join(APP_DIR, "templates", f"{n}.webp"), "WEBP", quality=88)
        fold = round(find_fold(napkin), 4)
        manifest.append({"src": f"templates/{n}.webp", "size": list(napkin.size), "box": list(box), "fold": fold})
        print(f"  ✓ plantilla {n}: {napkin.size}, solapa al {fold:.0%}")
    with open(os.path.join(APP_DIR, "templates.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()

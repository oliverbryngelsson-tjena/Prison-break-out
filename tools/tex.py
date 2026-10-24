"""Texture processing for the Rocketbox character pipeline.

Reads a JSON list of jobs on stdin and writes PNG files.
Job kinds:
  color  - diffuse map, optional recolouring of masked regions
  normal - tangent-space normal map (resized)
  rough  - converts a Rocketbox specular map into a glTF metallic/roughness map
  rgba   - colour + alpha (hair/eyelash cards)

Run with: python3 -I tools/tex.py < jobs.json
"""
import json
import sys

import numpy as np
from PIL import Image, ImageFilter


def load(path):
    im = Image.open(path)
    im.load()
    return im


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def recolor(img, mask_path, rules, keys=None, protect_skin=False):
    rgb = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    mask_im = load(mask_path).convert("L").resize(img.size, Image.NEAREST)
    mask = np.asarray(mask_im).copy()
    hsv = np.asarray(img.convert("RGB").convert("HSV")).astype(np.float32) / 255.0
    hue, sat, val = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    H, W = mask.shape
    yy, xx = np.mgrid[0:H, 0:W]
    u, v = xx / W, yy / H
    # Colour-keyed region overrides, e.g. rubber boots -> shoes, glove cuffs -> skin.
    for key in keys or []:
        sel = (hue >= key["hue"][0]) & (hue <= key["hue"][1]) & (sat >= key.get("sat", [0, 1])[0]) & (val >= key.get("val", [0, 1])[0])
        x0, y0, x1, y1 = key.get("rect", [0, 0, 1, 1])
        sel &= (u >= x0) & (u <= x1) & (v >= y0) & (v <= y1)
        sel &= mask > 0
        mask[sel] = key["to"]
    if protect_skin:
        # Bare skin (e.g. forearms with pushed-up sleeves) keeps its original colour.
        skin = (hue > 4) & (hue < 38) & (sat > 0.18) & (sat < 0.62) & (val > 0.42) & (mask == 1)
        skin_im = Image.fromarray((skin * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
        mask[np.asarray(skin_im) > 127] = 0
    out = rgb.copy()
    lum = luminance(rgb)
    for key, rule in rules.items():
        region = mask == int(key)
        if not region.any():
            continue
        # Soften the region border so recoloured seams do not show hard edges.
        soft = Image.fromarray((region * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
        alpha = (np.asarray(soft).astype(np.float32) / 255.0)[..., None]
        mean_l = max(float(np.median(lum[region])), 0.02)
        mode = rule.get("mode", "tint")
        target = np.array(rule["color"], dtype=np.float32) / 255.0
        if mode == "tint":
            # Keep the fabric shading (folds, stitching, dirt) by modulating the
            # target colour with the original luminance relative to its median.
            ratio = np.clip(lum / mean_l, 0.2, 2.2) ** rule.get("contrast", 0.9)
            col = target[None, None, :] * ratio[..., None]
            keep = rule.get("keep", 0.08)
            col = col * (1 - keep) + rgb * keep
        elif mode == "skin":
            ratio = np.clip(lum / mean_l, 0.55, 1.4) ** 0.45
            col = target[None, None, :] * ratio[..., None]
        else:
            continue
        out = out * (1 - alpha) + np.clip(col, 0, 1) * alpha
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")


def skin_tone(head_path):
    """Median skin colour from the face texture (used to paint bare hands)."""
    im = load(head_path).convert("RGB").resize((256, 256))
    hsv = np.asarray(im.convert("HSV")).astype(np.float32)
    rgb = np.asarray(im).astype(np.float32)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    sel = (h < 40) & (s > 0.2) & (s < 0.65) & (v > 0.35) & (v < 0.95)
    if sel.sum() < 50:
        return [190, 140, 115]
    return [int(x) for x in np.median(rgb[sel], axis=0)]


def run(job):
    kind = job["kind"]
    size = job.get("size", 1024)
    img = load(job["src"])
    if kind == "color":
        img = img.convert("RGB")
        if job.get("recolor"):
            rules = job["recolor"]["rules"]
            for rule in rules.values():
                if rule.get("color") == "SKIN":
                    rule["color"] = skin_tone(job["recolor"]["head"])
            img = recolor(img, job["recolor"]["mask"], rules, job["recolor"].get("keys"), job["recolor"].get("protectSkin", False))
        img = img.resize((size, size), Image.LANCZOS)
        img.save(job["out"])
    elif kind == "normal":
        img = img.convert("RGB").resize((size, size), Image.LANCZOS)
        if job.get("flipGreen"):
            a = np.asarray(img).copy()
            a[..., 1] = 255 - a[..., 1]
            img = Image.fromarray(a)
        if job.get("flattenMask"):
            # Flatten normals where gloves were replaced by bare skin.
            a = np.asarray(img).astype(np.float32)
            m = np.asarray(load(job["flattenMask"]["mask"]).convert("L").resize((size, size), Image.NEAREST))
            sel = m == int(job["flattenMask"]["value"])
            flat = np.array([128, 128, 255], dtype=np.float32)
            a[sel] = a[sel] * 0.35 + flat * 0.65
            img = Image.fromarray(a.astype(np.uint8))
        img.save(job["out"])
    elif kind == "rough":
        spec = np.asarray(img.convert("L").resize((size, size), Image.LANCZOS)).astype(np.float32) / 255.0
        lo, hi = job.get("range", [0.38, 0.92])
        # Brighter specular => smoother surface.
        rough = hi - np.clip(spec * 2.2, 0, 1) * (hi - lo)
        o = np.zeros((size, size, 3), dtype=np.uint8)
        o[..., 0] = 255  # occlusion (unused)
        o[..., 1] = (rough * 255).astype(np.uint8)
        o[..., 2] = 0  # metalness
        Image.fromarray(o, "RGB").save(job["out"])
    elif kind == "rgba":
        img = img.convert("RGBA").resize((size, size), Image.LANCZOS)
        img.save(job["out"])
    else:
        raise ValueError(kind)


def main():
    jobs = json.load(sys.stdin)
    for job in jobs:
        run(job)
        print("ok", job["out"], flush=True)


if __name__ == "__main__":
    main()

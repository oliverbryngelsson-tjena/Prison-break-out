"""Records dialogue lines with Kokoro-82M (called by tools/voices.mjs).

stdin: JSON list of {key, voice, speed, lang, text, target}. argv: model.onnx voices.npz out_dir.
stdout: JSON {key: {f: file, d: seconds, t: target, e: mouth envelope}}.
Each line is sped up if needed so it fits the time the game gives it, which keeps co-op in sync.
"""
import json
import os
import subprocess
import sys

import numpy as np
from kokoro_onnx import Kokoro

RATE = 30  # mouth envelope frames per second
DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'


def envelope(a: np.ndarray, sr: int) -> str:
    hop = sr // RATE
    n = max(1, len(a) // hop)
    rms = np.sqrt(np.array([np.mean(a[i * hop:(i + 1) * hop] ** 2) for i in range(n)]) + 1e-12)
    ref = np.percentile(rms, 95) or 1e-6
    v = np.clip(rms / ref, 0, 1) ** 0.7
    v[rms < ref * 0.12] = 0  # silence: mouth closed
    return ''.join(DIGITS[int(round(x * 35))] for x in v)


def main() -> None:
    model, voices, out = sys.argv[1:4]
    jobs = json.load(sys.stdin)
    tts = Kokoro(model, voices)
    result = {}
    for i, j in enumerate(jobs):
        target = float(j['target'])
        room = max(0.8, target - 0.18)
        speed = float(j['speed'])
        a, sr = tts.create(j['text'], voice=j['voice'], speed=speed, lang=j['lang'])
        d = len(a) / sr
        if d > room:
            speed = min(1.45, speed * d / room * 1.03)
            a, sr = tts.create(j['text'], voice=j['voice'], speed=speed, lang=j['lang'])
            d = len(a) / sr
        a = a.astype(np.float32)
        rms = float(np.sqrt(np.mean(a ** 2)) or 1e-6)
        a = a * min(0.075 / rms, 0.95 / (float(np.max(np.abs(a))) or 1e-6))
        path = os.path.join(out, j['key'] + '.mp3')
        pcm = (np.clip(a, -1, 1) * 32767).astype('<i2').tobytes()
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', 'pipe:0',
                        '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '40k', path], input=pcm, check=True)
        result[j['key']] = {'f': j['key'] + '.mp3', 'd': round(d, 3), 't': round(target, 2), 'e': envelope(a, sr)}
        print(f"{i + 1}/{len(jobs)} {j['voice']} {d:.1f}s/{target:.1f}s x{speed:.2f} {j['text'][:50]}", file=sys.stderr)
    json.dump(result, sys.stdout)


if __name__ == '__main__':
    main()

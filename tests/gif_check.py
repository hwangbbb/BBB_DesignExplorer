"""Decode tests/out/test.gif with Pillow and compare every frame with the expected pixels."""
import json, sys, os
from PIL import Image, ImageSequence
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'out')
meta = json.load(open(os.path.join(d, 'meta.json')))
w, h, n = meta['w'], meta['h'], meta['n']
exp = open(os.path.join(d, 'expected.bin'), 'rb').read()
im = Image.open(os.path.join(d, 'test.gif'))
assert im.size == (w, h), im.size
frames = [f.convert('RGB').tobytes() for f in ImageSequence.Iterator(im)]
assert len(frames) == n, ('frames', len(frames))
for i, f in enumerate(frames):
    e = exp[i * w * h * 3:(i + 1) * w * h * 3]
    bad = sum(1 for a, b in zip(f, e) if a != b)
    assert bad == 0, f'frame {i}: {bad} channel values differ'
im.seek(5)
assert im.info.get('duration') == 1500, im.info
print(f'ok: {n} frames decode exactly, loop={im.info.get("loop")}, last delay {im.info.get("duration")} ms')

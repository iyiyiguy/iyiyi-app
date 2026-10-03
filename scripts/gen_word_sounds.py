#!/usr/bin/env python3
"""Synthesize original UI sounds for "What's The Word" (no samples used).

Soft key clicks, tile-flip pops, a bright solve chime, an error buzz, a clock tick and
a short results fanfare - all additive sine/triangle synthesis with fast envelopes.

Output: mono 16-bit WAV files in assets/sounds/word_*.wav (each well under 60 KB).

    python3 scripts/gen_word_sounds.py

Requires numpy + scipy. Deterministic (fixed seed).
"""
import os
import numpy as np
from scipy.io import wavfile

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'sounds')
rng = np.random.default_rng(77)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(dur, attack=0.004, decay=0.12):
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def tone(freq, dur, attack=0.004, decay=0.12, harmonics=(1, 0.35, 0.12)):
    t = t_axis(dur)
    x = sum(a * np.sin(2 * np.pi * freq * (i + 1) * t) for i, a in enumerate(harmonics))
    return x * env(dur, attack, decay)


def place(buf, x, at):
    i = int(SR * at)
    end = min(len(buf), i + len(x))
    buf[i:end] += x[: end - i]
    return buf


def save(name, x, gain=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    # tiny fade-out to avoid clicks
    n = min(len(x), int(SR * 0.008))
    x[-n:] *= np.linspace(1, 0, n)
    wavfile.write(os.path.join(OUT, name), SR, (x * 32767).astype(np.int16))


def key():
    d = 0.045
    t = t_axis(d)
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.5
    body = np.sin(2 * np.pi * 1450 * t) * np.exp(-t / 0.012)
    return click + body


def flip():
    d = 0.09
    t = t_axis(d)
    f = 520 + 600 * np.exp(-t / 0.015)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.002, 0.03)


def correct():
    buf = np.zeros(int(SR * 0.75))
    for i, f in enumerate([659.25, 783.99, 987.77, 1318.51]):  # E5 G5 B5 E6
        place(buf, tone(f, 0.5, 0.003, 0.16 if i < 3 else 0.3), i * 0.07)
    return buf


def wrong():
    buf = np.zeros(int(SR * 0.3))
    t = t_axis(0.13)
    sq = np.sign(np.sin(2 * np.pi * 150 * t)) * 0.4 + np.sin(2 * np.pi * 150 * t)
    place(buf, sq * env(0.13, 0.003, 0.06), 0)
    place(buf, sq * env(0.13, 0.003, 0.06) * 0.8, 0.12)
    return buf


def fail():
    buf = np.zeros(int(SR * 0.7))
    for i, f in enumerate([392.0, 329.63, 261.63]):
        place(buf, tone(f, 0.4, 0.004, 0.14, (1, 0.5, 0.2)), i * 0.12)
    return buf


def tick():
    d = 0.06
    t = t_axis(d)
    return np.sin(2 * np.pi * 2200 * t) * np.exp(-t / 0.008) + rng.standard_normal(len(t)) * np.exp(-t / 0.002) * 0.3


def go():
    buf = np.zeros(int(SR * 0.45))
    place(buf, tone(880, 0.4, 0.003, 0.12), 0)
    place(buf, tone(1760, 0.4, 0.003, 0.08) * 0.4, 0)
    return buf


def count():
    return tone(587.33, 0.22, 0.003, 0.06)


def win():
    buf = np.zeros(int(SR * 1.3))
    notes = [(523.25, 0), (659.25, 0.1), (783.99, 0.2), (1046.5, 0.32)]
    for f, at in notes:
        place(buf, tone(f, 0.9, 0.004, 0.22 if at < 0.3 else 0.45), at)
    # sparkle
    for i in range(8):
        f = rng.uniform(2200, 3600)
        place(buf, tone(f, 0.15, 0.002, 0.03, (1,)) * 0.25, 0.35 + i * 0.06)
    return buf


def combo():
    buf = np.zeros(int(SR * 0.4))
    t = t_axis(0.3)
    f = 600 + 900 * (t / 0.3)
    place(buf, np.sin(2 * np.pi * np.cumsum(f) / SR) * env(0.3, 0.01, 0.12), 0)
    return buf


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save('word_key.wav', key(), 0.45)
    save('word_flip.wav', flip(), 0.5)
    save('word_correct.wav', correct(), 0.75)
    save('word_wrong.wav', wrong(), 0.6)
    save('word_fail.wav', fail(), 0.65)
    save('word_tick.wav', tick(), 0.5)
    save('word_go.wav', go(), 0.7)
    save('word_count.wav', count(), 0.6)
    save('word_win.wav', win(), 0.75)
    save('word_combo.wav', combo(), 0.6)
    for f in sorted(os.listdir(OUT)):
        if f.startswith('word_'):
            print(f, os.path.getsize(os.path.join(OUT, f)))

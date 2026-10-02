#!/usr/bin/env python3
"""Synthesize original Laser Tag weapon / game sound effects (no samples used).

Every sound is built from scratch: layered noise bursts with a fast attack and
exponential decay, a low-frequency "thump" (pitch-swept sine), a band-passed
"crack", and a short synthetic reverb tail (noise impulse response).

Output: mono 16-bit WAV files in assets/sounds/, each kept under 60 KB.

    python3 scripts/gen_gun_sounds.py

Requires numpy + scipy (pip install --break-system-packages numpy scipy).
Seeds are fixed so re-running produces identical files.
"""
import os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'sounds')
MAX_BYTES = 60 * 1024
rng = np.random.default_rng(1234)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(dur, attack=0.0015, decay=0.05):
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def bandpass(x, lo, hi, order=4):
    hi = min(hi, SR / 2 - 100)
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)


def lowpass(x, f, order=4):
    return sosfilt(butter(order, min(f, SR / 2 - 100), btype='low', fs=SR, output='sos'), x)


def highpass(x, f, order=4):
    return sosfilt(butter(order, f, btype='high', fs=SR, output='sos'), x)


def sweep(dur, f0, f1, curve=0.03):
    """Sine whose pitch falls exponentially from f0 to f1."""
    t = t_axis(dur)
    f = f1 + (f0 - f1) * np.exp(-t / curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def reverb(x, length=0.5, decay=0.12, mix=0.25, tone=4000):
    ir = noise(length) * np.exp(-t_axis(length) / decay)
    ir = lowpass(ir, tone)
    wet = fftconvolve(x, ir)[: len(x) + int(SR * length)]
    wet /= np.max(np.abs(wet)) + 1e-9
    dry = np.pad(x, (0, len(wet) - len(x)))
    dry /= np.max(np.abs(dry)) + 1e-9
    return dry * (1 - mix) + wet * mix


def pad_to(x, n):
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def mix(*parts):
    n = max(len(p) for p in parts)
    return sum(pad_to(p, n) for p in parts)


MAX_SECONDS = 1.3


def finish(x, peak=0.9, fade=0.03):
    x = x - np.mean(x)
    x = np.tanh(x / (np.max(np.abs(x)) + 1e-9) * 1.6)  # gentle saturation = punch
    # Trim the silent end (below about -50 dB) and cap the length to keep files small.
    loud = np.nonzero(np.abs(x) > 0.003)[0]
    end = min(len(x), (loud[-1] + 1) if len(loud) else len(x), int(SR * MAX_SECONDS))
    x = x[:end].copy()
    n = int(SR * fade)
    if n and len(x) > n:
        x[-n:] *= np.linspace(1, 0, n)
    return (x / (np.max(np.abs(x)) + 1e-9) * peak)


def gunshot(dur, crack_band, crack_decay, thump_f, thump_decay, body_decay, body_lp, verb_len, verb_decay, verb_mix,
            crack_gain=1.0, thump_gain=0.8, body_gain=0.6):
    crack = bandpass(noise(dur), *crack_band) * env(dur, 0.0008, crack_decay) * crack_gain
    thump = sweep(dur, thump_f * 2.2, thump_f, 0.02) * env(dur, 0.002, thump_decay) * thump_gain
    body = lowpass(noise(dur), body_lp) * env(dur, 0.001, body_decay) * body_gain
    dry = mix(crack, thump, body)
    return reverb(dry, verb_len, verb_decay, verb_mix)


def write(name, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    path = os.path.join(OUT, f'{name}.wav')
    wavfile.write(path, SR, pcm)
    size = os.path.getsize(path)
    assert size < MAX_BYTES, f'{name}.wav is {size} bytes (limit {MAX_BYTES})'
    print(f'{name:14s} {len(pcm) / SR:5.2f}s {size / 1024:5.1f} KB')


def main():
    os.makedirs(OUT, exist_ok=True)

    # Pistol: sharp, bright crack, short room tail.
    write('pistol', finish(gunshot(0.3, (1800, 7500), 0.012, 110, 0.035, 0.03, 2500, 0.35, 0.07, 0.22, crack_gain=1.2)))
    # SMG (both SMGs): lighter and quick so rapid fire stays clean.
    write('smg', finish(gunshot(0.16, (2200, 8000), 0.008, 140, 0.02, 0.018, 3000, 0.18, 0.04, 0.15, thump_gain=0.5, body_gain=0.4)))
    # Burst rifle: mid-weight.
    write('rifle', finish(gunshot(0.28, (1500, 6500), 0.012, 95, 0.04, 0.04, 2200, 0.3, 0.07, 0.22)))
    # Assault rifle: punchier low end.
    write('ar', finish(gunshot(0.32, (1200, 6000), 0.014, 80, 0.055, 0.05, 1800, 0.35, 0.08, 0.25, thump_gain=1.1, body_gain=0.8)))
    # DMR / marksman: heavy crack and a long outdoor tail.
    write('dmr', finish(gunshot(1.0, (1000, 7000), 0.02, 70, 0.08, 0.07, 1600, 0.9, 0.3, 0.38, crack_gain=1.4, thump_gain=1.2)))
    # Sniper: biggest crack, longest echo.
    write('sniper', finish(gunshot(1.15, (900, 7000), 0.025, 60, 0.1, 0.09, 1400, 1.0, 0.35, 0.42, crack_gain=1.5, thump_gain=1.3)))
    # Scatter blaster / shotgun: boomy, low-passed, wide.
    boom = gunshot(0.6, (600, 3500), 0.03, 55, 0.12, 0.12, 900, 0.6, 0.18, 0.3, crack_gain=0.8, thump_gain=1.5, body_gain=1.2)
    write('shotgun', finish(lowpass(boom, 5000)))
    # Minigun: tiny dry shot (it fires very fast).
    write('minigun', finish(gunshot(0.11, (1500, 6500), 0.006, 120, 0.018, 0.02, 2500, 0.1, 0.03, 0.1, thump_gain=0.6)))

    # Railgun: charge whine, electric zap, ringing whine.
    d = 0.9
    t = t_axis(d)
    charge_len = 0.18
    f_charge = np.where(t < charge_len, 500 + 2600 * (t / charge_len) ** 1.6, 3100)
    whine = np.sin(2 * np.pi * np.cumsum(f_charge) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 38 * t))
    whine *= np.where(t < charge_len, (t / charge_len) ** 2, np.exp(-(t - charge_len) / 0.25)) * 0.45
    zap_t = np.maximum(t - charge_len, 0)
    zap_f = 180 + 3800 * np.exp(-zap_t / 0.05)
    zap = np.sign(np.sin(2 * np.pi * np.cumsum(zap_f) / SR)) * (t >= charge_len) * np.exp(-zap_t / 0.09) * 0.5
    crackle = highpass(noise(d), 2500) * (t >= charge_len) * np.exp(-zap_t / 0.04)
    rail = mix(whine, lowpass(zap, 6000), crackle)
    write('railgun', finish(reverb(rail, 0.4, 0.12, 0.2, 7000), peak=0.85))

    # Dry fire / empty click: small metallic tick.
    d = 0.08
    click = highpass(noise(d), 3000) * env(d, 0.0003, 0.003)
    ping = np.sin(2 * np.pi * 3200 * t_axis(d)) * env(d, 0.0005, 0.012) * 0.4
    write('empty', finish(mix(click, ping), peak=0.6))

    # Hit thud: being hit / landing a hit.
    d = 0.22
    thud = sweep(d, 180, 70, 0.03) * env(d, 0.002, 0.06) + lowpass(noise(d), 600) * env(d, 0.001, 0.03) * 0.6
    write('hit', finish(thud, peak=0.85))

    # Bomb planted alert: two-tone electronic alarm.
    d = 0.9
    t = t_axis(d)
    tone = np.where((t * 6).astype(int) % 2 == 0, 880, 1320)
    alarm = np.sign(np.sin(2 * np.pi * np.cumsum(tone) / SR)) * 0.35 + np.sin(2 * np.pi * np.cumsum(tone) / SR) * 0.4
    alarm *= np.minimum(1, t / 0.01) * np.where(t > d - 0.1, (d - t) / 0.1, 1)
    write('planted', finish(lowpass(alarm, 5000), peak=0.75))

    # Countdown beep.
    d = 0.09
    write('beep', finish(np.sin(2 * np.pi * 1600 * t_axis(d)) * env(d, 0.002, 0.04), peak=0.6))

    # Defused: rising three-note chime.
    notes = []
    for f in (660, 880, 1320):
        dn = 0.16
        notes.append(np.sin(2 * np.pi * f * t_axis(dn)) * env(dn, 0.004, 0.08))
    write('defused', finish(np.concatenate(notes), peak=0.7))

    # Explosion: long low boom.
    d = 1.2
    ex = lowpass(noise(d), 700) * env(d, 0.004, 0.35) + sweep(d, 90, 30, 0.15) * env(d, 0.004, 0.4) * 1.2
    write('explosion', finish(reverb(ex, 0.5, 0.2, 0.3, 1500)))

    # Mini-game tap pop.
    d = 0.07
    pop = sweep(d, 1400, 700, 0.01) * env(d, 0.001, 0.02)
    write('tap', finish(pop, peak=0.6))


if __name__ == '__main__':
    main()

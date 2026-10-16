"""Synthesizes iYiYi Studio's built-in drum kits from scratch (no third-party samples).
8 kits x 8 pads, 44.1 kHz 16-bit mono WAV. Run: python3 gen.py <outdir>"""
import sys, os, json
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 44100
rng = np.random.default_rng(7)

def t(sec):
    return np.arange(int(SR * sec)) / SR

def env_exp(n_sec, decay, attack=0.001):
    x = t(n_sec)
    e = np.exp(-x / decay)
    a = int(SR * attack)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e

def hp(x, f, order=4):
    return sosfilt(butter(order, f, 'hp', fs=SR, output='sos'), x)

def lp(x, f, order=4):
    return sosfilt(butter(order, f, 'lp', fs=SR, output='sos'), x)

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'bp', fs=SR, output='sos'), x)

def sat(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)

def noise(sec):
    return rng.uniform(-1, 1, int(SR * sec))

def sweep_sine(sec, f0, f1, tau):
    x = t(sec)
    f = f1 + (f0 - f1) * np.exp(-x / tau)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph)

def fade_tail(x, ms=8):
    n = min(len(x), int(SR * ms / 1000))
    x[-n:] *= np.linspace(1, 0, n)
    return x

def norm(x, peak=0.89):
    m = np.max(np.abs(x)) or 1.0
    return fade_tail(x / m * peak)

def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out

def small_room(x, mix_amt=0.18):
    # cheap early-reflection room: a few short taps + lowpassed tail
    out = x.copy()
    for d, g in ((0.011, 0.5), (0.019, 0.35), (0.029, 0.25), (0.041, 0.18)):
        k = int(SR * d)
        out[k:] += x[:-k] * g * mix_amt * 2
    return out

# ---- voices -------------------------------------------------------------------------
def kick_808(length=1.2, f0=150, f1=48, tau=0.045, decay=0.45, drive=1.6):
    body = sweep_sine(length, f0, f1, tau) * env_exp(length, decay)
    click = hp(noise(0.006), 2500) * env_exp(0.006, 0.0015) * 0.35
    return norm(sat(mix(body, click), drive))

def kick_punch(length=0.5, f0=210, f1=55, tau=0.028, decay=0.16, drive=2.4):
    body = sweep_sine(length, f0, f1, tau) * env_exp(length, decay)
    knock = sweep_sine(0.05, 900, 300, 0.01) * env_exp(0.05, 0.008) * 0.35
    click = hp(noise(0.01), 3000) * env_exp(0.01, 0.002) * 0.4
    return norm(sat(mix(body, knock, click), drive))

def kick_909(length=0.6):
    body = sweep_sine(length, 260, 52, 0.022) * env_exp(length, 0.22)
    click = bp(noise(0.012), 2000, 9000) * env_exp(0.012, 0.0025) * 0.55
    return norm(sat(mix(body, click), 1.8))

def kick_soft(length=0.55):
    body = sweep_sine(length, 140, 50, 0.04) * env_exp(length, 0.2)
    return norm(lp(sat(body, 1.2), 2500))

def snare(length=0.35, tone=190, tone_decay=0.06, noise_decay=0.11, bright=1800, body_amt=0.6, room=False):
    x = t(length)
    tone_s = (np.sin(2 * np.pi * tone * x) + 0.5 * np.sin(2 * np.pi * tone * 1.6 * x)) * env_exp(length, tone_decay) * body_amt
    n = hp(noise(length), bright) * env_exp(length, noise_decay)
    s = mix(tone_s, n)
    if room:
        s = small_room(s, 0.3)
    return norm(sat(s, 1.3))

def clap(length=0.4, decay=0.12):
    out = np.zeros(int(SR * length))
    for i, off in enumerate((0, 0.009, 0.019, 0.028)):
        k = int(SR * off)
        burst = bp(noise(length - off), 900, 5500) * env_exp(length - off, 0.006 if i < 3 else decay)
        out[k:k + len(burst)] += burst
    return norm(small_room(out, 0.2))

def hat(length=0.09, decay=0.025, f=7000):  # noqa
    n = noise(length)
    metal = sum(np.sign(np.sin(2 * np.pi * fr * t(length))) for fr in (3150, 4160, 5300, 6600, 8200, 9800)) / 6
    s = lp(hp(0.6 * n + 0.4 * metal, f), 12500, 2) * env_exp(length, decay)
    return norm(s, 0.7)

def open_hat(length=0.55, decay=0.22):
    return hat(length, decay, 6500)

def shaker(length=0.16):
    n = bp(noise(length), 5000, 12000)
    e = env_exp(length, 0.05, attack=0.012)
    return norm(n * e, 0.6)

def rim(length=0.12):
    x = t(length)
    s = (np.sin(2 * np.pi * 1700 * x) + 0.6 * np.sin(2 * np.pi * 820 * x)) * env_exp(length, 0.012)
    s = mix(s, hp(noise(0.01), 4000) * env_exp(0.01, 0.002) * 0.6)
    return norm(s, 0.75)

def tom(length=0.5, f0=180, f1=110):
    s = sweep_sine(length, f0, f1, 0.08) * env_exp(length, 0.18)
    return norm(sat(mix(s, hp(noise(0.02), 1500) * env_exp(0.02, 0.004) * 0.2), 1.3))

def ride(length=1.2):
    x = t(length)
    partials = sum(np.sin(2 * np.pi * fr * x + rng.uniform(0, 6)) * a for fr, a in ((420, .5), (1150, .4), (2730, .3), (3911, .25), (5120, .2), (7060, .15)))
    s = hp(partials * 0.6 + hp(noise(length), 6000) * 0.25, 300) * env_exp(length, 0.5)
    return norm(s, 0.6)

def conga(length=0.35, f=330):
    s = sweep_sine(length, f * 1.25, f, 0.015) * env_exp(length, 0.09)
    return norm(sat(s, 1.2), 0.8)

def cowbell(length=0.35):
    x = t(length)
    s = (np.sign(np.sin(2 * np.pi * 545 * x)) + np.sign(np.sin(2 * np.pi * 815 * x))) * 0.5
    s = bp(s, 500, 3000) * env_exp(length, 0.08)
    return norm(s, 0.7)

def bell_perc(length=0.6, f=880):
    x = t(length)
    s = (np.sin(2 * np.pi * f * x + 2.0 * np.sin(2 * np.pi * f * 3.5 * x) * env_exp(length, 0.05))) * env_exp(length, 0.2)
    return norm(s, 0.7)

def snap(length=0.15):
    s = bp(noise(length), 1500, 7000) * env_exp(length, 0.018)
    return norm(small_room(s, 0.25), 0.75)

def keys_chord(length=1.4, root=220.0):
    x = t(length)
    notes = [root, root * 2 ** (3 / 12), root * 2 ** (7 / 12), root * 2 ** (10 / 12)]
    s = np.zeros_like(x)
    for f in notes:
        s += np.sin(2 * np.pi * f * x) + 0.3 * np.sin(2 * np.pi * 2 * f * x) * env_exp(length, 0.15)
    s *= env_exp(length, 0.6, attack=0.004)
    wob = 1 + 0.004 * np.sin(2 * np.pi * 5 * x)  # tape wobble via slight AM
    return norm(lp(s * wob, 3200), 0.7)

def vinyl_perc(length=0.25):
    s = bp(noise(length), 300, 2500) * env_exp(length, 0.03)
    s = mix(s, np.sin(2 * np.pi * 95 * t(length)) * env_exp(length, 0.07) * 0.7)
    return norm(lp(s, 3000), 0.8)


# ---- Atlanta trap / church-keys voices (original synthesis, styles only) --------------
def kick_hard(length=0.45):
    body = sweep_sine(length, 240, 52, 0.02) * env_exp(length, 0.14)
    knock = sweep_sine(0.04, 1400, 400, 0.008) * env_exp(0.04, 0.006) * 0.4
    click = hp(noise(0.008), 3500) * env_exp(0.008, 0.0015) * 0.5
    return norm(sat(mix(body, knock, click), 3.0))

def glide_808(length=2.4, start=98.0, end=49.0, glide=0.09, decay=1.1, drive=3.2):
    # long distorted 808 with a fast pitch drop into the note, plus 2nd harmonic grit
    x = t(length)
    f = end + (start - end) * np.exp(-x / glide)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) + 0.18 * np.sin(2 * ph)
    e = env_exp(length, decay, attack=0.002)
    click = hp(noise(0.006), 2500) * env_exp(0.006, 0.0015) * 0.3
    s = sat(mix(tone * e, click), drive)
    return norm(lp(s, 5200, 2))

def snare_crisp(length=0.24):
    x = t(length)
    body = (np.sin(2 * np.pi * 240 * x) + 0.4 * np.sin(2 * np.pi * 410 * x)) * env_exp(length, 0.03) * 0.55
    n = hp(noise(length), 2600) * env_exp(length, 0.07)
    crack = bp(noise(0.012), 3000, 9000) * env_exp(0.012, 0.003) * 0.7
    return norm(sat(mix(body, n, crack), 1.8))

def clap_stack(length=0.42):
    return norm(mix(clap(length, 0.1), snare_crisp(0.22) * 0.45))

def riser(length=1.6):
    x = t(length)
    n = noise(length)
    sweep = np.zeros_like(x)
    # band of noise opening up over time = classic "swell" into the drop
    for i, f in enumerate(np.linspace(600, 9000, 8)):
        seg = slice(int(i * len(x) / 8), int((i + 1) * len(x) / 8))
        sweep[seg] = bp(n, f * 0.7, min(f * 1.4, 19000))[seg]
    e = (x / length) ** 2.2
    return norm(small_room(sweep * e, 0.4), 0.75)

def pluck_bell(length=0.9, f=1046.5):
    x = t(length)
    s = np.sin(2 * np.pi * f * x + 1.4 * np.sin(2 * np.pi * f * 2.0 * x) * env_exp(length, 0.08)) * env_exp(length, 0.32)
    s += 0.25 * np.sin(2 * np.pi * f * 4.07 * x) * env_exp(length, 0.05)
    return norm(small_room(s, 0.3), 0.7)

def organ_chord(length=1.6, root=261.63):
    # drawbar-style organ: stacked harmonics with a little rotating-speaker wobble
    x = t(length)
    notes = [root, root * 2 ** (4 / 12), root * 2 ** (7 / 12), root * 2 ** (11 / 12)]
    s = np.zeros_like(x)
    for f in notes:
        for h, a in ((1, 1.0), (2, 0.6), (3, 0.35), (4, 0.25), (6, 0.12), (8, 0.08)):
            s += a * np.sin(2 * np.pi * f * h * x + rng.uniform(0, 6))
    lfo = 1 + 0.12 * np.sin(2 * np.pi * 6.2 * x)
    e = np.minimum(1, x / 0.01) * np.where(x > length - 0.25, np.maximum(0, (length - x) / 0.25), 1)
    return norm(lp(sat(s * lfo * e * 0.25, 1.4), 6000), 0.7)

def piano_note(length=1.6, f=523.25):
    x = t(length)
    s = np.zeros_like(x)
    for h in range(1, 9):
        fh = f * h * np.sqrt(1 + 0.0004 * h * h)  # slight string stiffness
        s += np.sin(2 * np.pi * fh * x) * env_exp(length, 0.9 / h ** 0.7) / h ** 1.1
    hammer = bp(noise(0.01), 1500, 6000) * env_exp(0.01, 0.002) * 0.25
    return norm(small_room(mix(s, hammer), 0.25), 0.7)

def tambourine(length=0.28):
    x = t(length)
    jingle = sum(np.sin(2 * np.pi * fr * x + rng.uniform(0, 6)) for fr in (5300, 6900, 8100, 9600, 11200)) / 5
    n = hp(noise(length), 6500)
    s = (0.55 * jingle + 0.6 * n) * env_exp(length, 0.06, attack=0.003)
    return norm(s, 0.6)

def bed_squeak(length=0.22):
    # springy chirp: quick pitch rise then fall, with wobble (the Jersey Club "squeak")
    x = t(length)
    f = 950 + 700 * np.sin(np.pi * np.minimum(x / 0.13, 1)) + 25 * np.sin(2 * np.pi * 38 * x)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    e = env_exp(length, 0.07, attack=0.004)
    grit = bp(noise(length), 1500, 4000) * e * 0.12
    return norm(sat(tone * e + grit, 1.5), 0.7)

def hey_chant(length=0.32):
    # synthetic "hey": breathy onset, then a buzzy voice through 'e' formants
    x = t(length)
    f0 = 210 - 50 * (x / length)
    ph = np.cumsum(f0) / SR
    saw = 2 * (ph % 1) - 1
    voiced = sum(bp(saw, fc * 0.85, fc * 1.15) * g for fc, g in ((530, 1.0), (1840, 0.6), (2480, 0.4)))
    breath = bp(noise(length), 1200, 5000) * np.exp(-x / 0.03) * 0.6
    e = np.minimum(1, x / 0.025) * np.exp(-np.maximum(0, x - 0.12) / 0.07)
    s = small_room(sat((voiced * 1.6 + breath) * e, 1.6), 0.35)
    return norm(s, 0.75)

KITS = {
    'trap': ('Trap', [
        ('kick', '808 Kick', kick_808()),
        ('snare', 'Snare', snare(0.3, 210, 0.04, 0.09, 2200, 0.5)),
        ('clap', 'Clap', clap()),
        ('hat', 'Hi-Hat', hat(0.07, 0.018)),
        ('openhat', 'Open Hat', open_hat(0.45, 0.16)),
        ('rim', 'Rim', rim()),
        ('perc', 'Bell', bell_perc(0.7, 988)),
        ('bass', '808 Long', kick_808(2.2, 120, 41, 0.06, 0.9, 2.0)),
    ]),
    'boombap': ('Boom Bap', [
        ('kick', 'Kick', kick_punch()),
        ('snare', 'Snare', snare(0.4, 180, 0.07, 0.14, 1400, 0.8, room=True)),
        ('hat', 'Hi-Hat', hat(0.1, 0.03, 6000)),
        ('openhat', 'Open Hat', open_hat(0.5, 0.2)),
        ('shaker', 'Shaker', shaker()),
        ('rim', 'Rim', rim()),
        ('tom', 'Tom', tom()),
        ('ride', 'Ride', ride()),
    ]),
    'house': ('House', [
        ('kick', 'Kick', kick_909()),
        ('clap', 'Clap', clap(0.45, 0.15)),
        ('hat', 'Closed Hat', hat(0.08, 0.02, 7500)),
        ('openhat', 'Open Hat', open_hat(0.4, 0.13)),
        ('ride', 'Ride', ride(1.0)),
        ('rim', 'Rim', rim()),
        ('conga', 'Conga', conga()),
        ('cowbell', 'Cowbell', cowbell()),
    ]),
    'lofi': ('Lo-fi', [
        ('kick', 'Kick', kick_soft()),
        ('snare', 'Brush Snare', norm(lp(snare(0.4, 170, 0.05, 0.16, 900, 0.5, room=True), 5000))),
        ('hat', 'Dusty Hat', norm(lp(hat(0.1, 0.03, 5000), 9000), 0.6)),
        ('snap', 'Snap', snap()),
        ('shaker', 'Shaker', norm(lp(shaker(), 8000), 0.55)),
        ('perc', 'Vinyl Thump', vinyl_perc()),
        ('tom', 'Low Tom', norm(lp(tom(0.5, 140, 90), 3000))),
        ('keys', 'Keys Chord', keys_chord()),
    ]),
    'atl': ('ATL 808', [
        ('kick', 'Hard Kick', kick_hard()),
        ('snare', 'Crisp Snare', snare_crisp()),
        ('clap', 'Clap Stack', clap_stack()),
        ('hat', 'Tight Hat', hat(0.045, 0.011, 8000)),
        ('openhat', 'Open Hat', open_hat(0.38, 0.12)),
        ('perc', 'Pluck Bell', pluck_bell()),
        ('bass', '808 Glide', glide_808()),
        ('fx', 'Riser', riser()),
    ]),
    'church': ('Church Keys', [
        ('kick', 'Kick', kick_punch(0.5, 200, 50, 0.025, 0.18, 2.6)),
        ('snare', 'Snare', snare(0.3, 220, 0.035, 0.1, 2400, 0.55)),
        ('clap', 'Big Clap', norm(small_room(clap(0.5, 0.14), 0.35))),
        ('hat', 'Hi-Hat', hat(0.06, 0.016, 7500)),
        ('openhat', 'Open Hat', open_hat(0.42, 0.15)),
        ('perc', 'Tambourine', tambourine()),
        ('keys', 'Organ Chord', organ_chord()),
        ('bass', '808', glide_808(2.0, 70.0, 55.0, 0.05, 0.8, 2.2)),
    ]),
    'piano': ('Piano Bells', [
        ('kick', 'Kick', kick_808(0.9, 160, 50, 0.04, 0.3, 2.0)),
        ('snare', 'Snare', snare_crisp(0.26)),
        ('clap', 'Clap', clap()),
        ('hat', 'Hi-Hat', hat(0.05, 0.013, 8000)),
        ('keys', 'Piano C', piano_note(1.6, 523.25)),
        ('perc', 'Piano E♭', piano_note(1.6, 622.25)),
        ('bell', 'Bell G', pluck_bell(0.9, 783.99)),
        ('bass', '808', glide_808(2.2, 90.0, 49.0, 0.07, 1.0, 2.6)),
    ]),
    'jersey': ('Jersey Club', [
        ('kick', 'Club Kick', kick_hard(0.38)),
        ('clap', 'Clap', norm(mix(clap(0.36, 0.09), snap(0.12) * 0.5))),
        ('snare', 'Snare', snare_crisp(0.2)),
        ('squeak', 'Squeak', bed_squeak()),
        ('hat', 'Hi-Hat', hat(0.05, 0.012, 8000)),
        ('openhat', 'Open Hat', open_hat(0.32, 0.1)),
        ('vox', 'Hey!', hey_chant()),
        ('bass', '808 Hit', glide_808(0.9, 110.0, 55.0, 0.04, 0.35, 2.6)),
    ]),
}

def main(out):
    os.makedirs(out, exist_ok=True)
    manifest = {}
    for kid, (name, pads) in KITS.items():
        manifest[kid] = {'name': name, 'pads': []}
        for pid, label, data in pads:
            fn = f'{kid}_{pid}.wav'
            wavfile.write(os.path.join(out, fn), SR, (np.clip(data, -1, 1) * 32767).astype(np.int16))
            manifest[kid]['pads'].append({'id': pid, 'label': label, 'file': fn, 'sec': round(len(data) / SR, 3)})
    json.dump(manifest, open(os.path.join(out, 'kits.json'), 'w'), indent=1)
    print('wrote', sum(len(k['pads']) for k in manifest.values()), 'sounds')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'out')

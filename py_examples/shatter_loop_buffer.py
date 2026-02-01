import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = np.arange(n, dtype=np.float32)/sr

    energy = float(p.get("energy", 0.6))

    # Build a short "loop buffer" (20–80 ms) from noisy harmonics
    loop_ms = rng.uniform(20, 80) * (0.85 + 0.4*energy)
    L = int(max(32, min(n, loop_ms*sr/1000)))
    lt = np.arange(L, dtype=np.float32)/sr

    base = rng.uniform(120, 900) * (1.0 + 0.25*energy)
    partials = 6 + int(rng.integers(0, 8))
    buf = np.zeros(L, np.float32)
    for k in range(1, partials+1):
        amp = 1.0/(k**(1.15 + 0.25*rng.random()))
        ph = rng.random()*6.28318
        buf += (np.sin(2*np.pi*(base*k)*lt + ph) * amp).astype(np.float32)

    # Add a little grit
    buf += (rng.standard_normal(L).astype(np.float32) * (0.06 + 0.12*energy))
    buf = np.tanh(buf * (1.5 + 1.2*energy)).astype(np.float32)

    # "Shatter": random dropouts and splices inside the buffer
    drops = 3 + int(10*energy)
    for _ in range(drops):
        a = int(rng.integers(0, max(1, L-8)))
        w = int(rng.integers(3, max(4, int(L*0.12))))
        b = min(L, a+w)
        if rng.random() < 0.65:
            buf[a:b] *= 0.0
        else:
            buf[a:b] *= rng.uniform(-0.4, 0.4)

    # Read buffer with jittered playhead + occasional reverse jumps
    y = np.zeros(n, np.float32)
    idx = rng.integers(0, L)
    speed = (0.8 + 0.8*rng.random()) * (1.0 + 0.4*(energy-0.5))

    for i in range(n):
        if rng.random() < (0.006 + 0.02*energy):   # skip / jump
            idx = (idx + rng.integers(-L//2, L//2)) % L
        if rng.random() < (0.003 + 0.015*energy): # reverse blip
            speed = -speed
        # jitter
        j = int(idx + rng.normal(0, 0.6 + 1.8*energy))
        y[i] = buf[j % L]
        idx = (idx + speed) % L

    # Gentle envelope so it doesn't click too hard (but still crisp)
    env = (1.0 - np.exp(-t*120.0)) * np.exp(-t*(5.0 + 7.0*(1-energy)))
    y = np.tanh(y*(1.3 + 0.7*energy)) * env.astype(np.float32) * 0.75

    # Stereo offset
    d = int((0.001 + 0.004*rng.random())*sr)
    yR = np.concatenate([np.zeros(d, np.float32), y[:-d]]) if d < n else y.copy()
    return np.stack([y, yR], axis=1).astype(np.float32)

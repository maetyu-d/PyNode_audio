import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    t = (np.arange(n, dtype=np.float32) / sr)

    energy = float(p.get("energy", 0.8))
    # Pitch drop
    f0 = 160.0 + 60.0*energy
    f1 = 42.0 + 18.0*energy
    k = np.clip(t / max(1e-4, dur*0.25), 0.0, 1.0)
    f = f0 * (1.0 - k) + f1 * k
    ph = 2*np.pi*np.cumsum(f, dtype=np.float64) / sr
    ph = ph.astype(np.float32)

    # Click
    click = rng.standard_normal(n).astype(np.float32)
    click *= np.exp(-t*140.0).astype(np.float32)

    # Body
    body = np.sin(ph).astype(np.float32)
    body = np.tanh(body * (2.2 + 1.2*energy)).astype(np.float32)

    env = (1.0 - np.exp(-t*140.0)) * np.exp(-t*(7.0 + 5.0*(1-energy)))
    env = env.astype(np.float32)

    y = (0.9*body + 0.18*click) * env * (0.9 + 0.4*energy)
    y = np.clip(y, -1.0, 1.0).astype(np.float32)

    # Stereo: subtle width
    d = int(0.0015 * sr)
    yR = np.concatenate([np.zeros(d, np.float32), y[:-d]]) if d < n else y.copy()
    return np.stack([y, yR], axis=1).astype(np.float32)

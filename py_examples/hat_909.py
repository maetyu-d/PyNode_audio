import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.6))
    # Metal-ish partials
    base = 380.0 + 180.0*energy
    ratios = np.array([1.0, 1.39, 1.71, 2.13, 2.52, 3.01], np.float32)
    y = np.zeros(n, np.float32)
    for r in ratios:
        y += np.sin(2*np.pi*(base*r)*t + rng.random()*6.28318).astype(np.float32)
    y *= (1.0/len(ratios))

    # Add filtered noise
    noise = rng.standard_normal(n).astype(np.float32)
    noise = noise - np.concatenate([np.zeros(1, np.float32), noise[:-1]])
    y = 0.65*y + 0.35*noise

    env = (1.0 - np.exp(-t*400.0)) * np.exp(-t*(45.0 + 10.0*(1-energy)))
    y = np.tanh(y * 2.2) * env.astype(np.float32) * (0.7 + 0.5*energy)
    y = y.astype(np.float32)

    # Stereo shimmer
    pan = (0.5 + 0.45*np.sin(2*np.pi*(2.0 + 1.0*rng.random())*t + rng.random()*6.28318)).astype(np.float32)
    return np.stack([y*(1-pan), y*pan], axis=1).astype(np.float32)

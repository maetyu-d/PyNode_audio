import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    t = (np.arange(n, dtype=np.float32) / sr)

    energy = float(p.get("energy", 0.7))

    # Noise burst + tonal ring
    noise = rng.standard_normal(n).astype(np.float32)
    # A crude bandpass by differentiating then smoothing
    noise = noise - np.concatenate([np.zeros(1, np.float32), noise[:-1]])
    noise = np.convolve(noise, np.ones(9, np.float32)/9.0, mode="same").astype(np.float32)

    f = 175.0 + 60.0*energy
    ph = 2*np.pi*f*t
    tone = (np.sin(ph) + 0.35*np.sin(2*ph)).astype(np.float32)

    envN = (1.0 - np.exp(-t*180.0)) * np.exp(-t*(22.0 + 10.0*(1-energy)))
    envT = (1.0 - np.exp(-t*120.0)) * np.exp(-t*(10.0 + 6.0*(1-energy)))
    envN = envN.astype(np.float32)
    envT = envT.astype(np.float32)

    y = (0.75*noise*envN + 0.35*tone*envT) * (0.85 + 0.35*energy)
    y = np.tanh(y*1.6).astype(np.float32)
    return np.stack([y,y], axis=1).astype(np.float32)

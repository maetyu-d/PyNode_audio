import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.6))
    # Grain cloud from windowed noise + sine bursts
    y = np.zeros(n, np.float32)
    grains = int(6 + 18*energy)
    for _ in range(grains):
        pos = rng.uniform(0.0, max(1e-4, dur-0.02))
        glen = rng.uniform(0.008, 0.03)
        a = int(pos*sr)
        b = min(n, a + int(glen*sr))
        if b <= a+4: 
            continue
        win = np.hanning(b-a).astype(np.float32)
        f = rng.uniform(250.0, 4500.0)
        segt = (np.arange(b-a, dtype=np.float32)/sr)
        tone = np.sin(2*np.pi*f*segt + rng.random()*6.28318).astype(np.float32)
        src = 0.55*tone + 0.45*rng.standard_normal(b-a).astype(np.float32)
        y[a:b] += src * win * rng.uniform(0.2, 0.9)

    # Tiny bit of saturation
    env = (1.0 - np.exp(-t*80.0)) * np.exp(-t*(6.0 + 3.0*(1-energy)))
    y = np.tanh(y*(1.4+0.8*energy)) * env.astype(np.float32) * 0.55
    # Stereo skew
    d = int((0.001 + 0.004*rng.random())*sr)
    yR = np.concatenate([np.zeros(d, np.float32), y[:-d]]) if d < n else y.copy()
    return np.stack([y, yR], axis=1).astype(np.float32)

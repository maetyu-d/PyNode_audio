import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.6))
    noise = rng.standard_normal(n).astype(np.float32)

    # Sweep "filter" by integrating noise (crude lowpass) with moving coefficient
    fc0 = 80.0 + 60.0*energy
    fc1 = 8000.0
    k = np.clip(t / max(1e-4, dur), 0.0, 1.0)
    fc = fc0*(1-k) + fc1*k
    a = np.exp(-2*np.pi*fc/sr).astype(np.float32)

    y = np.empty(n, np.float32)
    z = np.float32(0)
    for i in range(n):
        z = (1-a[i])*noise[i] + a[i]*z
        y[i]=z

    # Add pitch component
    f = 120.0*(1-k) + 1600.0*k
    ph = 2*np.pi*np.cumsum(f, dtype=np.float64)/sr
    tone = np.sin(ph).astype(np.float32)*0.25

    env = (1.0 - np.exp(-t*30.0)) * np.exp(-(dur - t)*0.0)
    y = np.tanh((y*0.7 + tone)*(1.1+0.9*energy)) * env.astype(np.float32) * 0.55

    pan = (0.5 + 0.45*np.sin(2*np.pi*(0.12+0.05*rng.random())*t + rng.random()*6.28318)).astype(np.float32)
    return np.stack([y*(1-pan), y*pan], axis=1).astype(np.float32)

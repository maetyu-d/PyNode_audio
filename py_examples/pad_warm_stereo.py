import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.5))
    x = int(p.get("x", 0))
    root = 110.0 * (2.0 ** ((x % 12)/12.0))

    det = 0.0035 + 0.002*energy
    f1 = root*(1.0-det)
    f2 = root*(1.0+det)
    f3 = root*1.5*(1.0-0.7*det)

    y = (np.sin(2*np.pi*f1*t) + np.sin(2*np.pi*f2*t) + 0.7*np.sin(2*np.pi*f3*t)).astype(np.float32)
    y *= (1.0/2.7)

    # Slow chorus
    lfo = np.sin(2*np.pi*(0.18+0.05*rng.random())*t + rng.random()*6.28318).astype(np.float32)
    dl = (0.004 + 0.002*lfo)  # seconds
    d = (dl*sr).astype(np.int32)
    yL = y.copy()
    yR = np.zeros_like(y)
    for i in range(n):
        j = i - d[i]
        yR[i] = y[j] if j >= 0 else 0.0

    # Envelope
    a = max(0.01, dur*0.18)
    r = max(0.02, dur*0.30)
    env = np.minimum(1.0, t/a) * np.minimum(1.0, (dur-t)/r)
    env = np.clip(env, 0.0, 1.0).astype(np.float32)

    yL = np.tanh(yL*(1.3+0.6*energy)) * env * 0.35
    yR = np.tanh(yR*(1.3+0.6*energy)) * env * 0.35
    return np.stack([yL, yR], axis=1).astype(np.float32)

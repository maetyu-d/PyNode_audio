import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.7))
    x = int(p.get("x", 0))
    base = 220.0 * (2.0 ** ((x % 8)/12.0))

    mod_ratio = 2.0 + 1.0*(x % 3)
    idx0 = 6.0 + 10.0*energy
    idx = idx0 * np.exp(-t*(4.0+2.0*(1-energy))).astype(np.float32)

    mod = np.sin(2*np.pi*(base*mod_ratio)*t).astype(np.float32)
    car = np.sin(2*np.pi*base*t + idx*mod).astype(np.float32)

    env = (1.0 - np.exp(-t*180.0)) * np.exp(-t*(2.2 + 0.6*(1-energy)))
    env = env.astype(np.float32)
    y = np.tanh(car*(1.4+0.6*energy)) * env * 0.5

    # Ping-pong-ish stereo
    pan = (0.5 + 0.48*np.sin(2*np.pi*(0.9+0.2*rng.random())*t + rng.random()*6.28318)).astype(np.float32)
    return np.stack([y*(1-pan), y*pan], axis=1).astype(np.float32)

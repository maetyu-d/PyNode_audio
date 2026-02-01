import numpy as np

def synth(sr, dur, seed, p):
    rng = np.random.default_rng(seed)
    n = int(sr*dur)
    t = (np.arange(n, dtype=np.float32)/sr)

    energy = float(p.get("energy", 0.7))
    x = int(p.get("x", 0))
    # Scale-ish mapping by node index
    notes = np.array([36, 38, 41, 43, 45, 48, 50], np.int32)
    midi = notes[x % len(notes)] + int(12*(rng.random() < 0.25))
    f = (440.0 * (2.0 ** ((midi - 69)/12.0))).astype(np.float32)

    # Saw-ish via harmonics (cheap)
    y = np.zeros(n, np.float32)
    maxH = 18
    for h in range(1, maxH+1):
        y += (np.sin(2*np.pi*(f*h)*t) / h).astype(np.float32)
    y *= (2.0/np.pi)

    # One-pole lowpass sweep
    fc0 = 140.0 + 80.0*energy
    fc1 = 1800.0 + 1400.0*energy
    k = np.clip(t / max(1e-4, dur*0.35), 0.0, 1.0)
    fc = fc0*(1-k) + fc1*k
    a = np.exp(-2*np.pi*fc/sr).astype(np.float32)
    out = np.empty(n, np.float32)
    z = np.float32(0)
    for i in range(n):
        z = (1-a[i])*y[i] + a[i]*z
        out[i] = z

    env = (1.0 - np.exp(-t*140.0)) * np.exp(-t*(3.8 + 2.2*(1-energy)))
    out = np.tanh(out * (2.0 + 1.2*energy)) * env.astype(np.float32) * (0.6 + 0.5*energy)
    return out.astype(np.float32)

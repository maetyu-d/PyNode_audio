import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr
    energy=float(p.get("energy",0.6))

    # Make a tiny buffer from crushed noise (like degraded digital residue)
    L=int(max(64, min(n, int(sr*(0.012 + 0.06*rng.random())))))
    buf=rng.standard_normal(L).astype(np.float32)

    # Bit-reduce + sample-rate-reduce inside buffer
    crush = 3 + int(rng.integers(2, 11))
    buf = np.floor(buf*crush)/crush
    hold = 1 + int(rng.integers(1, 10))
    for i in range(0, L, hold):
        buf[i:i+hold] = buf[i]

    # Add a tiny resonant sinus to give "loop identity"
    f = rng.uniform(250, 2500)
    lt=np.arange(L,dtype=np.float32)/sr
    buf = 0.78*buf + 0.22*np.sin(2*np.pi*f*lt + rng.random()*6.28318).astype(np.float32)
    buf = np.tanh(buf*(1.2+1.1*energy)).astype(np.float32)

    # Stutter engine: alternate between forward micro-reads and hard re-triggers
    y=np.zeros(n,np.float32)
    idx=0
    burst=int(6 + 40*energy)   # how often to retrigger (in samples, on average)
    step=1.0

    for i in range(n):
        if rng.random() < (1.0/max(8, burst)):
            # hard re-trigger near a transient region
            idx = int(rng.integers(0, L))
            step = rng.choice([0.5, 1.0, 1.0, 1.5, -1.0])
        # occasional tiny freeze (repeat same sample)
        if rng.random() < (0.015 + 0.03*energy):
            step = 0.0
        if rng.random() < (0.02 + 0.02*energy):
            step = 1.0

        j = int(idx + rng.normal(0, 0.9 + 2.2*energy))
        y[i] = buf[j % L]
        idx = (idx + step) % L

    env=(1.0-np.exp(-t*140.0))*np.exp(-t*(7.0+9.0*(1-energy)))
    y=np.tanh(y*(1.8+0.8*energy))*env.astype(np.float32)*0.7
    return np.stack([y,y],axis=1).astype(np.float32)

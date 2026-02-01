import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)

    energy=float(p.get("energy",0.5))

    y=np.zeros(n,np.float32)

    # Sparse clicks
    clicks=int(2+12*energy)
    for _ in range(clicks):
        i=rng.integers(0,n)
        y[i]+=rng.uniform(-1,1)

    # Tiny exponential blur -> crisp impulse tails
    k=int(0.002*sr)
    if k>1:
        tail=np.exp(-np.arange(k)/ (0.0004*sr)).astype(np.float32)
        y=np.convolve(y,tail,mode="same")

    y=np.tanh(y*2.0)*0.5
    return np.stack([y,y],axis=1).astype(np.float32)

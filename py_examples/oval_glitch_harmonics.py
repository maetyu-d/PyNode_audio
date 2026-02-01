import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr

    energy=float(p.get("energy",0.6))
    base=180+rng.uniform(0,800)

    # Cluster of partials with random dropouts
    y=np.zeros(n,np.float32)
    partials=8+int(10*energy)
    for k in range(1,partials):
        amp=1.0/(k**1.2)
        ph=rng.random()*6.28
        tone=np.sin(2*np.pi*(base*k)*t+ph).astype(np.float32)
        mask=(rng.random(n)>0.985).astype(np.float32)
        y+=tone*amp*mask

    env=np.exp(-t*(10+15*(1-energy))).astype(np.float32)
    y=np.tanh(y*2.2)*env*0.7
    return np.stack([y,y],axis=1).astype(np.float32)

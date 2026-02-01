import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr

    energy=float(p.get("energy",0.7))

    y=np.zeros(n,np.float32)

    # CD-skip micrograin fragments
    grains=int(5+25*energy)
    for _ in range(grains):
        pos=rng.uniform(0,dur*0.9)
        glen=rng.uniform(0.002,0.012)
        a=int(pos*sr)
        b=min(n,a+int(glen*sr))
        if b<=a+4: 
            continue

        win=np.hanning(b-a).astype(np.float32)
        f=rng.uniform(400,6000)
        segt=np.arange(b-a,dtype=np.float32)/sr
        frag=np.sin(2*np.pi*f*segt+rng.random()*6.28).astype(np.float32)

        # Bitcrush fragment
        crush=4+int(rng.integers(2,10))
        frag=np.floor(frag*crush)/crush

        y[a:b]+=frag*win*rng.uniform(0.2,0.8)

    env=np.exp(-t*(6+12*(1-energy))).astype(np.float32)
    y=np.tanh(y*1.6)*env*0.6

    # Stereo offset
    d=int(0.002*sr)
    yR=np.concatenate([np.zeros(d,np.float32),y[:-d]]) if d<n else y.copy()
    return np.stack([y,yR],axis=1).astype(np.float32)

import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr

    energy=float(p.get("energy",0.6))
    f=220.0*(1.0+3.0*energy)

    # Hard gated sine pulse train
    phase=2*np.pi*f*t
    tone=np.sin(phase).astype(np.float32)

    rate=6+int(40*energy)
    gate=((np.sin(2*np.pi*rate*t)>0).astype(np.float32))

    # Quantised amplitude steps (digital aesthetic)
    q=np.floor((tone*0.5+0.5)*6)/6
    y=(q*2-1)*gate

    env=np.exp(-t*(20+30*(1-energy))).astype(np.float32)
    y=y*env*0.55

    return np.stack([y,y],axis=1).astype(np.float32)

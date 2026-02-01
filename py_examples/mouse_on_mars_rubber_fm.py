import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr

    energy=float(p.get("energy",0.7))
    f0=110+440*energy
    f1=f0*(1.0+rng.uniform(0.1,0.7))

    # Wobbly FM tone
    mod=np.sin(2*np.pi*f1*t).astype(np.float32)
    idx=4+12*energy
    car=np.sin(2*np.pi*f0*t + idx*mod).astype(np.float32)

    # Cartoonish envelope
    env=(1-np.exp(-t*80))*np.exp(-t*(3+5*(1-energy)))
    env=env.astype(np.float32)

    # Quirky distortion
    y=np.tanh(car*(1.8+0.8*np.sin(2*np.pi*3*t)))*env*0.55
    pan=0.5+0.45*np.sin(2*np.pi*(0.3+rng.random())*t+rng.random()*6.28)
    return np.stack([y*(1-pan),y*pan],axis=1).astype(np.float32)

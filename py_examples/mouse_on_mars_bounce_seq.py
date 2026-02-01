import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr

    energy=float(p.get("energy",0.5))
    steps=8
    # Micro-step pitch hopping
    notes=np.array([220,277,330,370,415,494,554,659],np.float32)
    seq=rng.choice(notes,size=steps,replace=True)

    y=np.zeros(n,np.float32)
    step_len=n//steps
    for i,f in enumerate(seq):
        a=i*step_len
        b=min(n,(i+1)*step_len)
        segt=np.arange(b-a,dtype=np.float32)/sr
        tone=np.sin(2*np.pi*f*segt).astype(np.float32)
        env=np.exp(-segt*(18+10*(1-energy))).astype(np.float32)
        y[a:b]+=tone*env

    y=np.tanh(y*(1.6+energy))*0.5
    return np.stack([y,y],axis=1).astype(np.float32)

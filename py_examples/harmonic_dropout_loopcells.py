import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr
    energy=float(p.get("energy",0.6))

    # A bank of partials whose amplitudes are "cellular" (randomly switching)
    base=rng.uniform(70, 480)*(1.0+0.35*energy)
    partials=10+int(14*energy)
    freqs=base*np.arange(1, partials+1, dtype=np.float32)

    # Create a micro-loop of amplitude states
    L=int(max(32, min(n, int(sr*(0.02 + 0.05*rng.random())))))
    states=rng.random((partials, L)).astype(np.float32)
    # Convert to dropout masks with clumps
    thresh=0.72-0.35*energy
    mask=(states>thresh).astype(np.float32)
    # smear clumps (cheap)
    for k in range(1,4):
        mask[:,k:]+=0.6*mask[:,:-k]
    mask=np.clip(mask,0,1)

    # Render tone with time-varying masks (vectorised-ish)
    ph=2*np.pi*freqs[:,None]*t[None,:]
    tone=np.sin(ph).astype(np.float32)
    # Index mask by time modulo loop length
    mi=(np.arange(n)%L).astype(np.int32)
    amps=mask[:,mi]*(1.0/np.sqrt(np.arange(1,partials+1, dtype=np.float32)))[:,None]
    y=(tone*amps).sum(axis=0).astype(np.float32)

    # Add tiny bit of noise "CD dust"
    y += rng.standard_normal(n).astype(np.float32) * (0.02 + 0.05*energy)

    # Quantise slightly for digital edges
    q=6+int(10*energy)
    y=np.floor(y*q)/q

    env=np.exp(-t*(4.0+8.0*(1-energy))).astype(np.float32)
    y=np.tanh(y*(1.7+0.7*energy))*env*0.85

    # Subtle stereo flutter
    pan=(0.5+0.48*np.sin(2*np.pi*(0.25+0.3*rng.random())*t+rng.random()*6.28318)).astype(np.float32)
    return np.stack([y*(1-pan), y*pan], axis=1).astype(np.float32)

import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr
    energy=float(p.get("energy",0.6))

    # Create a pseudo "tape loop" source: filtered noise + a few tones
    src=np.zeros(n,np.float32)
    noise=rng.standard_normal(n).astype(np.float32)
    # simple 1-pole lowpass
    fc=600+5200*energy
    a=np.exp(-2*np.pi*fc/sr).astype(np.float32)
    z=np.float32(0)
    for i in range(n):
        z=(1-a)*noise[i] + a*z
        src[i]=z
    for f in [rng.uniform(140,360), rng.uniform(420,1100), rng.uniform(900,2800)]:
        src += (0.15*np.sin(2*np.pi*f*t + rng.random()*6.28318)).astype(np.float32)
    src=np.tanh(src*(0.9+0.8*energy)).astype(np.float32)

    # Granular re-read with skips, like broken looping
    y=np.zeros(n,np.float32)
    grains=int(8+30*energy)
    for _ in range(grains):
        # pick a tiny region and re-spray it
        pos=rng.uniform(0, max(1e-4, dur-0.03))
        glen=rng.uniform(0.006, 0.03)
        a0=int(pos*sr)
        b0=min(n, a0+int(glen*sr))
        if b0<=a0+8: 
            continue
        seg=src[a0:b0]
        win=np.hanning(len(seg)).astype(np.float32)

        # destination position (can collide / overlap)
        dst=rng.uniform(0, max(1e-4, dur-0.03))
        a1=int(dst*sr)
        b1=min(n, a1+len(seg))
        if b1<=a1+8:
            continue

        # tape-skip: random read offset and direction
        if rng.random()<0.35+0.25*energy:
            seg=seg[::-1].copy()
        # slight rate warp via index jitter (nearest-neighbor)
        idx=(np.arange(b1-a1) * (0.85+0.35*rng.random())).astype(np.int32)
        idx=np.clip(idx, 0, len(seg)-1)
        chunk=seg[idx]*win[:len(idx)]*rng.uniform(0.25, 0.9)

        y[a1:b1] += chunk.astype(np.float32)

    # Add a few hard discontinuities (CD skip feel)
    cuts=2+int(6*energy)
    for _ in range(cuts):
        a=int(rng.integers(0, max(1, n-32)))
        w=int(rng.integers(8, max(9, int(sr*0.01))))
        b=min(n,a+w)
        if rng.random()<0.5:
            y[a:b]=0
        else:
            y[a:b]=y[a]  # freeze

    env=(1.0-np.exp(-t*60.0))*np.exp(-t*(2.6+5.0*(1-energy)))
    y=np.tanh(y*(1.5+0.9*energy))*env.astype(np.float32)*0.75

    # Stereo: tiny time shift + polarity quirks
    d=int((0.001+0.006*rng.random())*sr)
    yR=np.concatenate([np.zeros(d,np.float32), y[:-d]]) if d<n else y.copy()
    if rng.random()<0.33:
        yR = -yR
    return np.stack([y,yR],axis=1).astype(np.float32)

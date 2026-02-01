import numpy as np

def synth(sr, dur, seed, p):
    rng=np.random.default_rng(seed)
    n=int(sr*dur)
    t=np.arange(n,dtype=np.float32)/sr
    energy=float(p.get("energy",0.6))

    # Build a source loop by mixing a few sharp transients and short ringing
    L=int(max(64, min(n, int(sr*(0.018 + 0.07*rng.random())))))
    src=np.zeros(L,np.float32)
    # transients
    clicks=3+int(8*energy)
    for _ in range(clicks):
        i=int(rng.integers(0,L))
        src[i]+=rng.uniform(-1,1)
    # ringing
    lt=np.arange(L,dtype=np.float32)/sr
    f=rng.uniform(300,5000)
    src += (0.25*np.sin(2*np.pi*f*lt + rng.random()*6.28318)).astype(np.float32)
    src = np.convolve(src, np.exp(-np.arange(int(0.002*sr))/ (0.00045*sr)).astype(np.float32), mode="same").astype(np.float32)
    src=np.tanh(src*(1.8+0.9*energy)).astype(np.float32)

    # Slice table: choose slice boundaries in the loop
    slices=4+int(8*energy)
    cuts=np.sort(rng.integers(0,L,size=slices))
    cuts=np.unique(np.concatenate([[0], cuts, [L]]))
    if len(cuts)<3:
        cuts=np.array([0, L//2, L], np.int32)

    # Build output by selecting slices, sometimes reversing and repeating
    y=np.zeros(n,np.float32)
    pos=0
    while pos < n:
        si=int(rng.integers(0, len(cuts)-1))
        a=int(cuts[si]); b=int(cuts[si+1])
        seg=src[a:b]
        if seg.size<8:
            pos += 1
            continue
        if rng.random()<0.45+0.2*energy:
            seg=seg[::-1]
        reps=1 + int(rng.integers(0, 3 + int(6*energy)))
        seg=np.tile(seg, reps)

        # Apply a short window per chunk to keep edges crisp but not explosive
        m=seg.size
        w=np.ones(m, np.float32)
        k=min(m//2, int(0.0025*sr))
        if k>2:
            ramp=np.hanning(k*2).astype(np.float32)
            w[:k]=ramp[:k]
            w[-k:]=ramp[-k:]
        seg=(seg*w)*rng.uniform(0.35, 0.95)

        end=min(n, pos+m)
        y[pos:end]+=seg[:end-pos].astype(np.float32)
        # jump ahead with gaps (shattered)
        gap=int(rng.integers(0, int(sr*(0.0005 + 0.006*energy))))
        pos=end+gap

    env=(1.0-np.exp(-t*140.0))*np.exp(-t*(5.5+7.5*(1-energy)))
    y=np.tanh(y*(1.5+0.9*energy))*env.astype(np.float32)*0.85

    # Pingpong-ish stereo by alternating polarity
    d=int((0.001+0.004*rng.random())*sr)
    yR=np.concatenate([np.zeros(d,np.float32), y[:-d]]) if d<n else y.copy()
    if (int(p.get("hop",0)) % 2)==1:
        yR=-yR
    return np.stack([y,yR],axis=1).astype(np.float32)

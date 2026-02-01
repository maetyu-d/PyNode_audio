Minimalist / Glitch / Microsound synth examples inspired by:
- Oval (clicks, CD-skip grains)
- Mouse on Mars (quirky FM + rubbery digital tone)
- Alva Noto (sine pulses, precise noise, quantised artifacts)

These are *original* educational synth patches in that general aesthetic.
Each defines:

    import numpy as np
    def synth(sr, dur, seed, p):
        return float32 array (n,) or (n,2)

Use small durations (0.05–0.3s) for best effect.

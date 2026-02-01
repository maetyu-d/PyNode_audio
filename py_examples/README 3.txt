Deeper "shattered loops" microsound examples (Oval-adjacent aesthetic).
Original patches that make loop-like fragments, stutters, dropouts, and digital skipping.

API:
    import numpy as np
    def synth(sr, dur, seed, p):
        return float32 array (n,) or (n,2) in [-1,1]

Tips:
- These are designed to sound best on short event durations (0.06–0.35s),
  but they also work longer if your graph latencies create repetition.
- Many use an internal "micro-loop buffer" and re-read it with jittered indices.

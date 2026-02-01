These are example Python synth scripts for the browser app.
Each file defines:

    import numpy as np
    def synth(sr, dur, seed, p):
        ...
        return np.ndarray float32 shape (n,) or (n,2) in [-1,1]

Notes:
- Use only NumPy (Pyodide ships it in the app).
- `p` is a dict with keys like: x (node index), emitter, hop, energy, seed.
- Keep it fast: avoid huge Python loops unless you must.

"""
Reference check: run the steps of the original fitGaLa.ipynb (with x_0 started
at the spectral maximum) and compare with py/gala_web.fit_spectrum.

    python tests/reference_fit.py
"""
import sys, pathlib
import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py"))
from gala.models import fastGaLa                       # noqa: E402
from gala.utils import GALA_BOUNDS, GALA_P0, jacobian_nm_to_eV  # noqa: E402
from gala_web import fit_spectrum, fastGaLa_web        # noqa: E402

# 1) fastGaLa_web equals the original fastGaLa wherever the original is finite.
rng = np.random.default_rng(0)
xs = np.linspace(1.8, 3.2, 2000)
worst = 0.0
for _ in range(2000):
    p = [rng.uniform(2.0, 3.0), rng.uniform(1, 200), rng.uniform(1, 200),
         rng.uniform(1, 200), 0.0, 1.0]
    with np.errstate(all="ignore"):
        a = fastGaLa(xs, *p)
    b = fastGaLa_web(xs, *p)
    if np.all(np.isfinite(a)):
        worst = max(worst, np.max(np.abs(a - b)))
print(f"fastGaLa_web vs fastGaLa (2000 random parameter sets): max |diff| = {worst:.1e}")
assert worst < 1e-12


def notebook_fit(df):
    df = df.copy()
    df["energy"], df["intensity"] = jacobian_nm_to_eV(
        df["wavelength"].values, df["intensity"].values)
    df["intensity"] /= np.max(df["intensity"].values)
    p0 = list(GALA_P0)
    p0[0] = df["energy"].iloc[df["intensity"].argmax()]
    with np.errstate(all="ignore"):
        if not np.all(np.isfinite(fastGaLa(df["energy"].values, *p0))):
            # The original fastGaLa overflows at this start point (0 * inf).
            # Start sigma at 20 meV instead; the optimum is the same.
            print("  (original fastGaLa is NaN at the default start; notebook "
                  "fit uses sigma start = 20 meV)")
            p0[1] = 20
    popt, pcov = curve_fit(fastGaLa, df["energy"], df["intensity"],
                           p0=p0, bounds=GALA_BOUNDS)
    return popt, np.sqrt(np.diag(pcov))


files = {
    "examplePL.csv": pd.read_csv(ROOT / "data/examplePL.csv", header=0,
                                 names=["wavelength", "intensity"]),
    "examplePL_subpopulation.txt": pd.read_csv(
        ROOT / "data/examplePL_subpopulation.txt",
        names=["wavelength", "intensity"]),
}
ok = True
for name, df in files.items():
    ref, ref_err = notebook_fit(df)
    web = fit_spectrum(df["wavelength"].values, df["intensity"].values)
    rel = np.max(np.abs(np.array(web["popt"]) - ref) / np.maximum(np.abs(ref), 1e-12))
    print(f"\n{name}")
    for n, v, e in zip(web["names"], ref, ref_err):
        print(f"  {n:6s} = {v:.8g} ± {e:.3g}")
    print(f"  R2 = {web['r2']:.6f}, max relative difference website vs notebook = {rel:.2e}")
    ok &= rel < 1e-6
print("\nPASS" if ok else "\nFAIL")
sys.exit(0 if ok else 1)

"""
Browser-side fitting routine for the GaLa website.

This module runs inside Pyodide (in a Web Worker). It wraps the original,
unmodified model code from https://github.com/leoluber/gala
(``gala/models.py`` and ``gala/utils.py``, copied to ``py/gala/``) and
reproduces the preprocessing and fitting steps of the ``fitGaLa.ipynb``
notebook:

1. wavelength (nm) -> energy (eV) with the Jacobian (optional),
2. normalization to the spectral maximum (optional),
3. ``scipy.optimize.curve_fit`` with start values and bounds,
   where the start value of x_0 is set to the energy of the spectral maximum.

The JavaScript side calls :func:`fit_json` with a JSON string and receives a
JSON string back, so no Python objects cross the worker boundary.

Default start values and bounds live in :data:`MODEL_DEFAULTS` below.
"""

import json
import warnings

import numpy as np
from scipy.optimize import curve_fit, OptimizeWarning
from scipy.special import erfcx

from gala.models import GaLx
from gala.utils import GALA_BOUNDS, GALA_P0, HC_EV_NM, jacobian_nm_to_eV


# =============================================================================
# Numerically safe evaluation of fastGaLa
# =============================================================================

def _gauss_times_erfcx(x, sigma, z):
    """
    exp(-x^2 / (2 sigma^2)) * erfcx(z), evaluated without 0 * inf.

    For z < -20, erfcx(z) = 2 exp(z^2) to double precision, so the product
    equals 2 exp(z^2 - x^2 / (2 sigma^2)), which we evaluate in one exp().
    Elsewhere this is exactly the expression used in gala/models.py.
    """
    a = -x**2 / (2 * sigma**2)
    with np.errstate(over="ignore", invalid="ignore", under="ignore"):
        direct = np.exp(a) * erfcx(z)
        safe = 2.0 * np.exp(a + z**2)
    return np.where(z < -20, safe, direct)


def fastGaLa_web(x, x_0, sigma, w_h, w_l, y=0, A=1):
    """
    Same closed form as ``gala.models.fastGaLa`` (identical values wherever
    the original is finite), but without the 0 * inf overflow that makes the
    original return NaN when the data reach far into the tails relative to
    sigma (e.g. examplePL_subpopulation.txt with the default sigma = 10 meV).
    tests/reference_fit.py checks that both agree.
    """
    x = np.asarray(x) * 1000
    x = x - x_0 * 1000
    L = _gauss_times_erfcx(x, sigma, (x + sigma**2 / w_l) / (np.sqrt(2) * sigma))
    R = _gauss_times_erfcx(x, sigma, (-x + sigma**2 / w_h) / (np.sqrt(2) * sigma))
    f = L + R
    if not np.all(np.isfinite(f)) or np.max(f) == 0:
        return np.full_like(x, np.nan, dtype=float)
    return A * f / np.max(f) + y


# =============================================================================
# Model registry
# =============================================================================
# To add a model later, add an entry here and the matching entry in
# js/models.js (labels and units shown in the UI).

MODEL_DEFAULTS = {
    "GaLa": {
        "function": fastGaLa_web,  # see above; same math as fastGaLa
        "names": ["x_0", "sigma", "w_h", "w_l", "y", "A"],
        "p0": list(GALA_P0),
        "lower": list(GALA_BOUNDS[0]),
        "upper": list(GALA_BOUNDS[1]),
    },
    # GaLx: same start values and bounds as GaLa, with gamma in place of w_l.
    # Note the different parameter order of GaLx(x, x_0, sigma, gamma, w_h, y, A).
    # This is an assumption; change the numbers here if needed.
    "GaLx": {
        "function": GaLx,
        "names": ["x_0", "sigma", "gamma", "w_h", "y", "A"],
        "p0": [2.4, 10, 10, 10, 0.0, 1.0],
        "lower": [0.5, 1.0, 1.0, 1.0, 0.0, 0.99],
        "upper": [3.5, 200, 200, 200, 0.00001, 1.01],
    },
}

# Parameters for which we warn when the fit ends at a bound. y and A have
# deliberately narrow bounds (they are practically fixed), so no warning there.
SHAPE_PARAMS = {"x_0", "sigma", "w_h", "w_l", "gamma"}


def defaults_json():
    """Return the default parameters of all models as JSON (for the UI)."""
    out = {}
    for key, m in MODEL_DEFAULTS.items():
        out[key] = {k: m[k] for k in ("names", "p0", "lower", "upper")}
    return json.dumps(out)


# =============================================================================
# Preprocessing
# =============================================================================

def preprocess(x, intensity, unit="nm", jacobian=True, normalize=True,
               e_range=None):
    """
    Convert raw data to a normalized energy-domain spectrum.

    Returns (energy, intensity, in_range_mask). Energy is ascending.
    Normalization uses the maximum inside the fit range.
    """
    x = np.asarray(x, dtype=float)
    intensity = np.asarray(intensity, dtype=float)

    if unit == "nm":
        if jacobian:
            energy, inten = jacobian_nm_to_eV(x, intensity)
        else:
            energy = (HC_EV_NM / x)[::-1]
            inten = intensity[::-1]
    else:
        energy, inten = x, intensity

    order = np.argsort(energy, kind="stable")
    energy, inten = energy[order], inten[order]

    mask = np.isfinite(energy) & np.isfinite(inten)
    if e_range is not None:
        lo, hi = e_range
        if lo is not None:
            mask &= energy >= lo
        if hi is not None:
            mask &= energy <= hi

    if normalize:
        peak = np.max(inten[mask]) if np.any(mask) else np.nan
        if not np.isfinite(peak) or peak <= 0:
            raise ValueError("Cannot normalize: the maximum intensity in the "
                             "fit range is not positive.")
        inten = inten / peak

    return energy, inten, mask


# =============================================================================
# Fitting
# =============================================================================

def _finite_or_none(v):
    v = float(v)
    return v if np.isfinite(v) else None


def fit_spectrum(x, intensity, model="GaLa", unit="nm", jacobian=True,
                 normalize=True, e_range=None, params=None, auto_x0=True):
    """
    Fit one spectrum. ``params`` is a list (one entry per model parameter) of
    dicts with keys p0, lower, upper, fixed. Missing entries use defaults.
    Returns a plain dict (JSON serializable).
    """
    spec = MODEL_DEFAULTS[model]
    func = spec["function"]
    names = spec["names"]
    n = len(names)

    p0 = list(spec["p0"])
    lower = list(spec["lower"])
    upper = list(spec["upper"])
    fixed = [False] * n
    if params:
        for i, p in enumerate(params[:n]):
            if p is None:
                continue
            p0[i] = float(p.get("p0", p0[i]))
            lower[i] = float(p.get("lower", lower[i]))
            upper[i] = float(p.get("upper", upper[i]))
            fixed[i] = bool(p.get("fixed", False))

    energy, inten, mask = preprocess(x, intensity, unit, jacobian, normalize,
                                     e_range)
    e_fit, i_fit = energy[mask], inten[mask]
    messages = []

    n_free = n - sum(fixed)
    if len(e_fit) <= n_free:
        raise ValueError(f"Only {len(e_fit)} data points in the fit range; "
                         f"at least {n_free + 1} are needed.")

    # Start value of x_0 at the spectral maximum (as recommended in utils.py).
    if auto_x0 and not fixed[0]:
        p0[0] = float(e_fit[np.argmax(i_fit)])

    for i in range(n):
        if fixed[i]:
            continue
        if lower[i] >= upper[i]:
            raise ValueError(f"Lower bound of {names[i]} must be smaller than "
                             f"its upper bound.")
        if not lower[i] <= p0[i] <= upper[i]:
            clipped = min(max(p0[i], lower[i]), upper[i])
            messages.append(f"Start value of {names[i]} ({p0[i]:g}) was "
                            f"outside its bounds and was set to {clipped:g}.")
            p0[i] = clipped

    free_idx = [i for i in range(n) if not fixed[i]]

    def wrapped(xx, *free):
        full = list(p0)
        for k, i in enumerate(free_idx):
            full[i] = free[k]
        return func(xx, *full)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", OptimizeWarning)
        try:
            popt_free, pcov_free = curve_fit(
                wrapped, e_fit, i_fit,
                p0=[p0[i] for i in free_idx],
                bounds=([lower[i] for i in free_idx],
                        [upper[i] for i in free_idx]),
            )
        except RuntimeError as err:
            raise ValueError(f"The fit did not converge: {err}") from None
    for w in caught:
        if issubclass(w.category, OptimizeWarning):
            messages.append("Uncertainties could not be estimated "
                            "(covariance of the parameters is undefined).")

    popt = list(p0)
    perr = [0.0] * n
    diag = np.sqrt(np.abs(np.diag(pcov_free)))
    for k, i in enumerate(free_idx):
        popt[i] = float(popt_free[k])
        perr[i] = _finite_or_none(diag[k])

    fit_at_data = func(energy, *popt)
    resid = i_fit - func(e_fit, *popt)
    if not np.all(np.isfinite(resid)):
        raise ValueError("The fitted model is not finite on the data.")
    ssr = float(np.sum(resid**2))
    sst = float(np.sum((i_fit - np.mean(i_fit))**2))
    dof = max(len(e_fit) - n_free, 1)

    at_bound = []
    for i in free_idx:
        span = upper[i] - lower[i]
        if names[i] in SHAPE_PARAMS and (
                popt[i] - lower[i] <= 1e-6 * span
                or upper[i] - popt[i] <= 1e-6 * span):
            at_bound.append(names[i])
            messages.append(f"{names[i]} ended at a bound "
                            f"({popt[i]:.6g}). Consider widening the bounds.")

    # Smooth model curve over the whole data range for plotting.
    e_dense = np.linspace(energy.min(), energy.max(), 800)
    fit_dense = func(e_dense, *popt)

    return {
        "model": model,
        "names": names,
        "popt": popt,
        "perr": perr,
        "fixed": fixed,
        "p0_used": p0,
        "lower": lower,
        "upper": upper,
        "r2": _finite_or_none(1 - ssr / sst) if sst > 0 else None,
        "rms": float(np.sqrt(ssr / len(e_fit))),
        "red_chi2": ssr / dof,
        "n_points": int(len(e_fit)),
        "n_free": n_free,
        "at_bound": at_bound,
        "messages": messages,
        "energy": energy.tolist(),
        "intensity": inten.tolist(),
        "in_range": mask.tolist(),
        "fit": [_finite_or_none(v) for v in fit_at_data],
        "fit_dense_energy": e_dense.tolist(),
        "fit_dense": [_finite_or_none(v) for v in fit_dense],
    }


def fit_json(request_json):
    """JSON in, JSON out wrapper used by the Web Worker."""
    req = json.loads(request_json)
    try:
        res = fit_spectrum(
            req["x"], req["y"],
            model=req.get("model", "GaLa"),
            unit=req.get("unit", "nm"),
            jacobian=req.get("jacobian", True),
            normalize=req.get("normalize", True),
            e_range=req.get("range"),
            params=req.get("params"),
            auto_x0=req.get("auto_x0", True),
        )
        return json.dumps({"ok": True, "result": res})
    except Exception as err:  # reported to the user as a readable message
        return json.dumps({"ok": False, "error": str(err)})

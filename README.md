# GaLa Lineshape Fitting (website)

A static website that fits photoluminescence (PL) spectra of semiconductor nanocrystals with the
**GaLa lineshape** (a Gaussian convolved with an asymmetric Laplace tail function). It replaces the
Jupyter notebook of [leoluber/gala](https://github.com/leoluber/gala): drop in a file, get a fit in seconds,
no Python installation needed. All computation runs in the browser; data never leaves the user's computer.

If you use GaLa, please cite:

> L. Luber, L. Reim, D. Benedikt, A. Singldinger, A. S. Urban, *Photoluminescence as a Quantitative Probe of
> Semiconductor Nanocrystals*, Nano Lett. 2026. https://doi.org/10.1021/acs.nanolett.6c04076

## How it works

| Part | File |
|---|---|
| Page layout | `index.html`, `css/style.css` |
| UI, state, tables, series analysis | `js/main.js` |
| Plotly figures (screen and export) | `js/plots.js` |
| Export (CSV, PNG, SVG, PDF, ZIP) | `js/export.js` |
| File parser (pure JS) | `js/parser.js` |
| Time/temperature from file names | `js/series.js` |
| Library versions, citation text | `js/config.js` |
| Parameter labels in the UI | `js/models.js` |
| Web Worker that loads Pyodide and runs fits | `js/worker.js` |
| **Original model code** (unchanged copy) | `py/gala/models.py`, `py/gala/utils.py` |
| **Fit routine and defaults** | `py/gala_web.py` |

The browser loads [Pyodide](https://pyodide.org) 0.29.3 (Python in WebAssembly) with numpy and scipy inside a
Web Worker, so the page never freezes. The first visit downloads about 30 MB (cached by the browser afterwards) and takes roughly 5–20 s; a fit then
takes about 20–150 ms.

External libraries (all pinned, from jsDelivr): Pyodide 0.29.3, Plotly.js 2.35.2, KaTeX 0.16.11, JSZip 3.10.1,
jsPDF 2.5.2. Versions are set in `index.html` and `js/config.js`.

### Changing default start values and bounds

Edit `MODEL_DEFAULTS` in `py/gala_web.py`. GaLa uses `GALA_P0` and `GALA_BOUNDS` from the original
`py/gala/utils.py`; GaLx has its own entry (same numbers, with `gamma` in place of `w_l`). Users can also change
everything in the **Advanced settings** panel on the page.

### One deviation from the original code: numerical overflow in `fastGaLa`

`fastGaLa` in the original repository computes `exp(-x²/2σ²) · erfcx(z)`. Far out in the low- or high-energy
tail (relative to σ), `exp(...)` underflows to 0 and `erfcx(z)` overflows to infinity, so the product is
`0 · inf = NaN` and `curve_fit` stops with *"Residuals are not finite in the initial point"*.
This happens for `data/examplePL_subpopulation.txt` with the default start σ = 10 meV, also in the original notebook.

`py/gala_web.py` therefore uses `fastGaLa_web`: the same closed form, but for `z < -20` it uses the
exact identity `erfcx(z) = 2·exp(z²)` (to double precision) and evaluates the product as one `exp()`.
`tests/reference_fit.py` checks that both functions agree wherever the original is finite
(max. difference 7e-18 over 2000 random parameter sets). GaLx is used unchanged.

## Reference results

Fitting the repository examples (GaLa, x_0 started at the spectral maximum, default bounds).
The website gives the same numbers as the original notebook within 1e-8 relative (checked in Chromium with Pyodide):

| File | E_G (eV) | σ (meV) | w_h (meV) | w_l (meV) | R² |
|---|---|---|---|---|---|
| examplePL.csv | 2.4130277 ± 0.0000958 | 15.5999 ± 0.130 | 27.2960 ± 0.172 | 39.2849 ± 0.166 | 0.999904 |
| examplePL_subpopulation.txt* | 2.4730451 ± 0.0000868 | 20.0810 ± 0.115 | 35.6556 ± 0.150 | 40.2938 ± 0.142 | 0.999929 |

\* The original notebook fails on this file with the default start values (see above). The reference uses the
original `fastGaLa` started at σ = 20 meV, which converges to the same optimum as the website.

Run the check (needs numpy, scipy, pandas):

```bash
python tests/reference_fit.py
```

## Tests

```bash
node tests/run-tests.mjs        # parser and file-name tests (Node 18+)
python tests/reference_fit.py   # fit results vs. the original notebook
```

`tests/data/` contains a synthetic test spectrum shaped like a real measurement (`LR23_5s.txt`: no header, comma
separated, 400–600 nm, noisy tails with negative values) and the same numbers saved with a header, instrument
metadata, tabs, semicolons, whitespace, CRLF line endings and decimal commas. All variants must parse to identical
numbers. Two files test the error messages.

## Run locally

The page must be served over HTTP (not opened as a `file://`), because it loads a Web Worker and Python files:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Choose branch `main` and folder `/ (root)`, then **Save**.
4. After a minute the site is live at `https://<user>.github.io/<repository>/`.

No build step is needed. The empty `.nojekyll` file tells GitHub Pages to serve the files as they are.

## License

Website code: see `LICENSE`. The model code in `py/gala/` is copied from
[leoluber/gala](https://github.com/leoluber/gala) (MIT License, © 2026 Leo Luber, see `py/gala/LICENSE`).

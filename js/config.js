/**
 * Pinned versions of all external libraries (loaded from the jsDelivr CDN).
 * Change a version here and in index.html (script tags) together.
 */
export const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';

export const CITATION = {
  text: 'L. Luber, L. Reim, D. Benedikt, A. Singldinger, A. S. Urban, ' +
    'Photoluminescence as a Quantitative Probe of Semiconductor Nanocrystals, ' +
    'Nano Lett. 2026. https://doi.org/10.1021/acs.nanolett.6c04076',
  bibtex: `@article{Luber2026GaLa,
  author  = {Luber, L. and Reim, L. and Benedikt, D. and Singldinger, A. and Urban, A. S.},
  title   = {Photoluminescence as a Quantitative Probe of Semiconductor Nanocrystals},
  journal = {Nano Letters},
  year    = {2026},
  doi     = {10.1021/acs.nanolett.6c04076}
}`,
  doi: 'https://doi.org/10.1021/acs.nanolett.6c04076',
};

/** First line of every exported CSV file. */
export const CSV_CITE_LINE =
  '# Fitted with the GaLa lineshape. If you use these results, please cite: ' + CITATION.text;

export const HC_EV_NM = 1239.841984;

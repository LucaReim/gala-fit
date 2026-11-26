/**
 * UI metadata for the lineshape models. Start values and bounds come from
 * py/gala_web.py (MODEL_DEFAULTS) when the fitting engine has loaded; the
 * numbers here are only used to label the parameters.
 */
export const MODELS = {
  GaLa: {
    label: 'GaLa (recommended)',
    params: [
      { key: 'x_0', label: 'E<sub>G</sub>', plain: 'E_G', unit: 'eV', digits: 5,
        about: 'Center of the Gaussian, the characteristic emission energy of the ensemble.' },
      { key: 'sigma', label: 'σ', plain: 'sigma', unit: 'meV', digits: 3,
        about: 'Standard deviation of the Gaussian (inhomogeneous broadening).' },
      { key: 'w_h', label: 'w<sub>h</sub>', plain: 'w_h', unit: 'meV', digits: 3,
        about: 'Width of the exponential tail on the high-energy side.' },
      { key: 'w_l', label: 'w<sub>l</sub>', plain: 'w_l', unit: 'meV', digits: 3,
        about: 'Width of the exponential tail on the low-energy side.' },
      { key: 'y', label: 'y', plain: 'y', unit: '', digits: 4, about: 'Constant baseline.' },
      { key: 'A', label: 'A', plain: 'A', unit: '', digits: 4, about: 'Peak amplitude.' },
    ],
  },
  GaLx: {
    label: 'GaLx',
    params: [
      { key: 'x_0', label: 'E<sub>G</sub>', plain: 'E_G', unit: 'eV', digits: 5 },
      { key: 'sigma', label: 'σ', plain: 'sigma', unit: 'meV', digits: 3 },
      { key: 'gamma', label: 'γ', plain: 'gamma', unit: 'meV', digits: 3 },
      { key: 'w_h', label: 'w<sub>h</sub>', plain: 'w_h', unit: 'meV', digits: 3 },
      { key: 'y', label: 'y', plain: 'y', unit: '', digits: 4 },
      { key: 'A', label: 'A', plain: 'A', unit: '', digits: 4 },
    ],
  },
};

/** Parameters shown in series plots, in display order. */
export const SERIES_PARAMS = {
  GaLa: ['x_0', 'sigma', 'w_h', 'w_l'],
  GaLx: ['x_0', 'sigma', 'gamma', 'w_h'],
};

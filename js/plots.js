/**
 * Plotly figure builders. Each function returns {data, layout} so the same
 * figure can be drawn on the page or rendered off-screen for export.
 */
import { MODELS, SERIES_PARAMS } from './models.js';
import { HC_EV_NM } from './config.js';

/** Plot colors, read from the CSS tokens (or a fixed light theme for export). */
export function plotTheme(forExport = false) {
  if (forExport) {
    return { bg: '#ffffff', text: '#1c1d26', grid: '#e4e6ee', data: '#4f7fd9', fit: '#1c1d26',
      accent: '#7b4fd0', muted: '#9a9cab', font: 'Arial, Helvetica, sans-serif' };
  }
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { bg: v('--surface'), text: v('--text'), grid: v('--border'), data: v('--data'),
    fit: v('--fit'), accent: v('--accent'), muted: v('--muted'),
    font: getComputedStyle(document.body).fontFamily };
}

function axisStyle(t, extra = {}) {
  return { gridcolor: t.grid, zerolinecolor: t.grid, linecolor: t.grid, color: t.text,
    ticks: 'outside', tickcolor: t.grid, mirror: true, showline: true, ...extra };
}

function baseLayout(t) {
  return {
    paper_bgcolor: t.bg, plot_bgcolor: t.bg,
    font: { family: t.font, color: t.text, size: 12 },
    margin: { l: 64, r: 20, t: 36, b: 52 },
    showlegend: true,
    legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.06, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'closest',
  };
}

/**
 * Linear + log plot of data and fit, with residuals below.
 * @param {object} spec  spectrum entry with .name and .result (from gala_web)
 * @param {object} opts  {narrow:boolean, forExport:boolean}
 */
export function spectrumFigure(spec, { narrow = false, forExport = false } = {}) {
  const t = plotTheme(forExport);
  const r = spec.result;
  const modelLabel = r.model;
  const E = r.energy, I = r.intensity, inR = r.in_range;
  const eIn = [], iIn = [], eOut = [], iOut = [], res = [], eRes = [];
  for (let k = 0; k < E.length; k++) {
    if (inR[k]) {
      eIn.push(E[k]); iIn.push(I[k]);
      if (r.fit[k] !== null) { eRes.push(E[k]); res.push(I[k] - r.fit[k]); }
    } else { eOut.push(E[k]); iOut.push(I[k]); }
  }
  const pos = (xs, ys) => {
    const a = [], b = [];
    xs.forEach((x, k) => { if (ys[k] > 0) { a.push(x); b.push(ys[k]); } });
    return [a, b];
  };
  const [eInPos, iInPos] = pos(eIn, iIn);
  const [eOutPos, iOutPos] = pos(eOut, iOut);
  const [eFitPos, fitPos] = pos(r.fit_dense_energy, r.fit_dense.map((v) => v ?? 0));

  const hover = 'E = %{x:.4f} eV (%{customdata:.1f} nm)<br>I = %{y:.4g}<extra></extra>';
  const nm = (xs) => xs.map((x) => HC_EV_NM / x);
  const dataMarker = { color: t.data, size: 5, opacity: 0.75 };
  const outMarker = { color: t.muted, size: 4, opacity: 0.5 };
  const fitLine = { color: t.fit, width: 1.6 };

  const data = [
    { x: eIn, y: iIn, customdata: nm(eIn), type: 'scatter', mode: 'markers', name: 'Data', marker: dataMarker,
      hovertemplate: hover, legendgroup: 'd' },
    { x: eOut, y: iOut, customdata: nm(eOut), type: 'scatter', mode: 'markers', name: 'Outside fit range',
      marker: outMarker, hovertemplate: hover, legendgroup: 'o', showlegend: eOut.length > 0 },
    { x: r.fit_dense_energy, y: r.fit_dense, type: 'scatter', mode: 'lines', name: `${modelLabel} fit`,
      line: fitLine, hoverinfo: 'skip', legendgroup: 'f' },
    { x: eInPos, y: iInPos, customdata: nm(eInPos), xaxis: 'x2', yaxis: 'y2', type: 'scatter', mode: 'markers',
      marker: dataMarker, hovertemplate: hover, showlegend: false, legendgroup: 'd' },
    { x: eOutPos, y: iOutPos, customdata: nm(eOutPos), xaxis: 'x2', yaxis: 'y2', type: 'scatter', mode: 'markers',
      marker: outMarker, hovertemplate: hover, showlegend: false, legendgroup: 'o' },
    { x: eFitPos, y: fitPos, xaxis: 'x2', yaxis: 'y2', type: 'scatter', mode: 'lines', line: fitLine,
      hoverinfo: 'skip', showlegend: false, legendgroup: 'f' },
    { x: eRes, y: res, xaxis: 'x3', yaxis: 'y3', type: 'scatter', mode: 'markers', name: 'Residual',
      marker: { color: t.accent, size: 4, opacity: 0.8 }, showlegend: false,
      hovertemplate: 'E = %{x:.4f} eV<br>data − fit = %{y:.3g}<extra></extra>' },
  ];

  // Log axis range: from the smallest positive data value up to just above 1.
  const posVals = iInPos.length ? iInPos : [1e-3];
  const ymin = Math.max(Math.min(...posVals) * 0.6, 1e-6);
  const ymax = Math.max(...posVals, ...fitPos.filter((v) => v > 0), 1) * 1.4;
  const xr = [Math.min(...E), Math.max(...E)];
  const pad = (xr[1] - xr[0]) * 0.02;
  const xrange = [xr[0] - pad, xr[1] + pad];

  const layout = baseLayout(t);
  const xTitle = { text: 'Energy (eV)' };
  if (narrow) {
    Object.assign(layout, {
      xaxis: axisStyle(t, { domain: [0, 1], anchor: 'y', range: xrange, title: xTitle }),
      yaxis: axisStyle(t, { domain: [0.70, 1], title: { text: 'Intensity (norm.)' } }),
      xaxis2: axisStyle(t, { domain: [0, 1], anchor: 'y2', matches: 'x', title: xTitle }),
      yaxis2: axisStyle(t, { domain: [0.36, 0.62], type: 'log', range: [Math.log10(ymin), Math.log10(ymax)],
        title: { text: 'Intensity (log)' }, exponentformat: 'power' }),
      xaxis3: axisStyle(t, { domain: [0, 1], anchor: 'y3', matches: 'x', title: xTitle }),
      yaxis3: axisStyle(t, { domain: [0, 0.22], title: { text: 'Residual' }, zeroline: true }),
    });
  } else {
    Object.assign(layout, {
      xaxis: axisStyle(t, { domain: [0, 0.47], anchor: 'y', range: xrange, title: xTitle }),
      yaxis: axisStyle(t, { domain: [0.34, 1], title: { text: 'Intensity (normalized)' } }),
      xaxis2: axisStyle(t, { domain: [0.55, 1], anchor: 'y2', matches: 'x', title: xTitle }),
      yaxis2: axisStyle(t, { domain: [0.34, 1], anchor: 'x2', type: 'log',
        range: [Math.log10(ymin), Math.log10(ymax)], title: { text: 'Intensity (log scale)' }, exponentformat: 'power' }),
      xaxis3: axisStyle(t, { domain: [0, 1], anchor: 'y3', matches: 'x', title: xTitle }),
      yaxis3: axisStyle(t, { domain: [0, 0.2], title: { text: 'Residual' }, zeroline: true }),
    });
  }
  layout.annotations = [
    { text: 'Linear', xref: 'x domain', yref: 'y domain', x: 0.02, y: 0.98, showarrow: false, font: { color: t.muted } },
    { text: 'Logarithmic', xref: 'x2 domain', yref: 'y2 domain', x: 0.02, y: 0.98, showarrow: false, font: { color: t.muted } },
  ];
  if (forExport) {
    layout.title = { text: spec.name, x: 0.01, xanchor: 'left', font: { size: 13 } };
    layout.margin.t = 56;
  }
  return { data, layout };
}

/** Value-vs-parameter plot for series analysis. */
export function seriesParamFigure(points, model, paramKey, kind, { forExport = false } = {}) {
  const t = plotTheme(forExport);
  const meta = MODELS[model].params.find((p) => p.key === paramKey);
  const idx = MODELS[model].params.findIndex((p) => p.key === paramKey);
  const pts = [...points].sort((a, b) => a.value - b.value);
  const layout = baseLayout(t);
  layout.showlegend = false;
  layout.margin = { l: 70, r: 16, t: 30, b: 50 };
  layout.title = { text: `${meta.plain}${meta.unit ? ` (${meta.unit})` : ''}`, x: 0.02, font: { size: 13 } };
  layout.xaxis = axisStyle(t, { title: { text: kind === 'time' ? 'Time (s)' : 'Temperature (K)' } });
  layout.yaxis = axisStyle(t, { title: { text: `${meta.plain}${meta.unit ? ` (${meta.unit})` : ''}` },
    exponentformat: 'none' });
  return {
    data: [{
      x: pts.map((p) => p.value), y: pts.map((p) => p.result.popt[idx]),
      error_y: { type: 'data', array: pts.map((p) => p.result.perr[idx] ?? 0), visible: true, color: t.accent, thickness: 1.2 },
      text: pts.map((p) => p.name), type: 'scatter', mode: 'lines+markers',
      line: { color: t.accent, width: 1 }, marker: { color: t.accent, size: 7 },
      hovertemplate: '%{text}<br>%{x:.4g}: %{y:.5g}<extra></extra>',
    }],
    layout,
  };
}

/** All normalized spectra of a series in one plot, colored by value. */
export function seriesSpectraFigure(points, kind, { forExport = false, log = false } = {}) {
  const t = plotTheme(forExport);
  const pts = [...points].sort((a, b) => a.value - b.value);
  const n = pts.length;
  const color = (k) => {
    // simple perceptual ramp from purple to orange (GaLa colors)
    const f = n > 1 ? k / (n - 1) : 0;
    const c0 = [91, 47, 180], c1 = [235, 140, 60];
    const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
    return `rgb(${c.join(',')})`;
  };
  const unit = kind === 'time' ? 's' : 'K';
  const data = pts.map((p, k) => ({
    x: p.result.energy, y: p.result.intensity.map((v) => (log && v <= 0 ? null : v)), type: 'scatter', mode: 'lines',
    name: `${formatValue(p.value)} ${unit}`, line: { color: color(k), width: 1.4 },
    hovertemplate: `${p.name}<br>E = %{x:.4f} eV<br>I = %{y:.4g}<extra></extra>`,
  }));
  const layout = baseLayout(t);
  layout.title = { text: 'Normalized spectra', x: 0.02, font: { size: 13 } };
  layout.legend = { bgcolor: 'rgba(0,0,0,0)' };
  layout.xaxis = axisStyle(t, { title: { text: 'Energy (eV)' } });
  layout.yaxis = axisStyle(t, { title: { text: 'Intensity (normalized)' }, type: log ? 'log' : 'linear' });
  return { data, layout };
}

export function formatValue(v) {
  if (!Number.isFinite(v)) return '';
  return Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(3) : String(Number(v.toPrecision(5)));
}

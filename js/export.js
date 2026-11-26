/**
 * Export: builds the files the user ticked and downloads them
 * (a single file directly, several files as one ZIP via JSZip).
 */
import { MODELS, SERIES_PARAMS } from './models.js';
import { CITATION, CSV_CITE_LINE, HC_EV_NM } from './config.js';
import { spectrumFigure, seriesParamFigure, seriesSpectraFigure } from './plots.js';

const PLOT_W = 1200, PLOT_H = 720;

const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[^\w.\-]+/g, '_');
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => [CSV_CITE_LINE, ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';

function paramsCsv(ctx) {
  const fitted = ctx.spectra.filter((s) => s.result);
  const meta = MODELS[ctx.model].params;
  const s = ctx.settings;
  const header = ['file', 'model'];
  if (ctx.series.enabled) header.push(ctx.series.kind === 'time' ? 'time_s' : 'temperature_K');
  meta.forEach((m) => header.push(`${m.plain}${m.unit ? `_${m.unit}` : ''}`, `${m.plain}_err`));
  header.push('E_G_nm', 'E_G_nm_err', 'R2', 'RMS', 'reduced_chi2_unit_weights', 'n_points',
    'x_unit', 'jacobian', 'normalized', 'range_min_eV', 'range_max_eV', 'auto_start_E_G',
    'start_values', 'lower_bounds', 'upper_bounds', 'fixed', 'warnings');
  const rows = [header];
  for (const spec of fitted) {
    const r = spec.result;
    const row = [spec.name, r.model];
    if (ctx.series.enabled) row.push(ctx.seriesValue(spec).value);
    r.popt.forEach((v, i) => row.push(v, r.fixed[i] ? 0 : r.perr[i]));
    const eg = r.popt[0];
    row.push(HC_EV_NM / eg, r.perr[0] === null ? null : HC_EV_NM / eg ** 2 * r.perr[0],
      r.r2, r.rms, r.red_chi2, r.n_points, spec.unit, s.jacobian, s.normalize,
      s.range.min, s.range.max, s.autoX0, r.p0_used.join(' '), r.lower.join(' '), r.upper.join(' '),
      r.fixed.map((f) => (f ? 1 : 0)).join(' '), r.messages.join(' | '));
    rows.push(row);
  }
  return csv(rows);
}

function curvesCsv(spec) {
  const r = spec.result;
  const rows = [['energy_eV', 'wavelength_nm', 'intensity_normalized', 'fit', 'residual', 'in_fit_range']];
  r.energy.forEach((e, k) => {
    const f = r.fit[k];
    rows.push([e, HC_EV_NM / e, r.intensity[k], f, f === null ? null : r.intensity[k] - f, r.in_range[k] ? 1 : 0]);
  });
  return csv(rows);
}

function preprocessedCsv(spec) {
  const r = spec.result;
  const rows = [['energy_eV', 'wavelength_nm', r.normalized === false ? 'intensity' : 'intensity_normalized']];
  r.energy.forEach((e, k) => rows.push([e, HC_EV_NM / e, r.intensity[k]]));
  return csv(rows);
}

function dataUrlToBlob(url) {
  const [head, body] = url.split(',');
  const mime = head.match(/data:([^;]+)/)[1];
  if (head.includes(';base64')) {
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

async function figureFiles(fig, base, formats) {
  const out = [];
  const opts = { width: PLOT_W, height: PLOT_H };
  if (formats.includes('png') || formats.includes('pdf')) {
    const png = await Plotly.toImage(fig, { ...opts, format: 'png', scale: 2 });
    if (formats.includes('png')) out.push({ name: `${base}.png`, blob: dataUrlToBlob(png) });
    if (formats.includes('pdf')) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [PLOT_W * 0.75, PLOT_H * 0.75], compress: true });
      doc.addImage(png, 'PNG', 0, 0, PLOT_W * 0.75, PLOT_H * 0.75, undefined, 'FAST');
      doc.setProperties({ title: base, subject: `Please cite: ${CITATION.text}` });
      out.push({ name: `${base}.pdf`, blob: doc.output('blob') });
    }
  }
  if (formats.includes('svg')) {
    const svg = await Plotly.toImage(fig, { ...opts, format: 'svg' });
    out.push({ name: `${base}.svg`, blob: dataUrlToBlob(svg) });
  }
  return out;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * @param {object} ctx      {spectra, model, settings, series, seriesValue, seriesPoints}
 * @param {string[]} choices values of the ticked export checkboxes
 * @param {(text:string)=>void} status
 */
export async function runExport(ctx, choices, status) {
  const fitted = ctx.spectra.filter((s) => s.result);
  if (!choices.length) { status('Please tick at least one item.'); return; }
  if (!fitted.length) { status('Nothing to export yet: no successful fits.'); return; }

  const files = [];
  const multi = fitted.length > 1;
  const dir = (folder, name) => (multi ? `${folder}/${name}` : name);
  if (choices.includes('params')) files.push({ name: 'gala_fit_parameters.csv', text: paramsCsv(ctx) });
  if (choices.includes('curves')) {
    for (const s of fitted) files.push({ name: dir('fitted_curves', `${stem(s.name)}_fit.csv`), text: curvesCsv(s) });
  }
  if (choices.includes('preprocessed')) {
    for (const s of fitted) files.push({ name: dir('preprocessed', `${stem(s.name)}_energy.csv`), text: preprocessedCsv(s) });
  }
  const formats = ['png', 'svg', 'pdf'].filter((f) => choices.includes(f));
  if (formats.length) {
    let k = 0;
    for (const s of fitted) {
      status(`Rendering plot ${++k} of ${fitted.length}…`);
      const fig = spectrumFigure(s, { forExport: true });
      for (const f of await figureFiles(fig, stem(s.name), formats)) files.push({ name: dir('plots', f.name), blob: f.blob });
    }
  }
  if (choices.includes('series') && ctx.series.enabled && ctx.seriesPoints.length) {
    status('Rendering series plots…');
    for (const key of SERIES_PARAMS[ctx.model]) {
      const fig = seriesParamFigure(ctx.seriesPoints, ctx.model, key, ctx.series.kind, { forExport: true });
      for (const f of await figureFiles(fig, `series_${key}`, ['png', 'svg'])) files.push({ name: `series/${f.name}`, blob: f.blob });
    }
    const sf = seriesSpectraFigure(ctx.seriesPoints, ctx.series.kind, { forExport: true });
    for (const f of await figureFiles(sf, 'series_spectra', ['png', 'svg'])) files.push({ name: `series/${f.name}`, blob: f.blob });
  }

  if (files.length === 1) {
    const f = files[0];
    download(f.blob || new Blob([f.text], { type: 'text/csv' }), f.name.split('/').pop());
  } else {
    status('Creating ZIP…');
    const zip = new JSZip();
    zip.file('CITATION.txt', `If you use these results, please cite:\n\n${CITATION.text}\n\nBibTeX:\n${CITATION.bibtex}\n`);
    for (const f of files) zip.file(f.name, f.blob || f.text);
    download(await zip.generateAsync({ type: 'blob' }), 'gala_export.zip');
  }
  status(`Downloaded ${files.length} file${files.length === 1 ? '' : 's'}.`);
}

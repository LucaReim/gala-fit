/**
 * GaLa Lineshape Fitting – UI, state, plotting and export wiring.
 *
 * Data flow:  file -> parser.js (JS) -> worker.js (Pyodide, py/gala_web.py)
 *             -> result -> plots.js (Plotly) / tables / export.js
 */
import { parseSpectrum, detectUnit } from './parser.js';
import { valueFromFileName } from './series.js';
import { MODELS, SERIES_PARAMS } from './models.js';
import { PYODIDE_INDEX_URL, CITATION, HC_EV_NM } from './config.js';
import { spectrumFigure, seriesParamFigure, seriesSpectraFigure, formatValue } from './plots.js';
import { runExport } from './export.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  defaults: null,          // start values and bounds per model, from Python
  model: 'GaLa',
  settings: null,          // see defaultSettings()
  spectra: [],             // see addSpectrum()
  selectedId: null,
  series: { enabled: false, kind: 'time' },
};
let nextId = 1;

function defaultSettings() {
  const params = {};
  for (const [key, d] of Object.entries(state.defaults)) {
    params[key] = d.p0.map((p0, i) => ({ p0, lower: d.lower[i], upper: d.upper[i], fixed: false }));
  }
  return { params, autoX0: true, unitMode: 'auto', jacobian: true, normalize: true, range: { min: null, max: null } };
}

// ---------------------------------------------------------------------------
// Worker (fitting engine)
// ---------------------------------------------------------------------------
// Allows local testing against a self-hosted Pyodide copy: ?pyodide=<url>
const pyodideURL = new URLSearchParams(location.search).get('pyodide') || PYODIDE_INDEX_URL;
const worker = new Worker(new URL('./worker.js', import.meta.url));
const pending = new Map();
let msgId = 0;

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'status') { setEngineStatus('loading', msg.text); return; }
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); p(msg); }
};
worker.onerror = (e) => setEngineStatus('error', `The fitting engine crashed: ${e.message || 'unknown error'}. Please reload the page.`);

function callWorker(type, payload = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    worker.postMessage({ id, type, ...payload });
  });
}

const engineReady = (async () => {
  const t0 = performance.now();
  const res = await callWorker('init', { indexURL: pyodideURL });
  if (!res.ok) {
    setEngineStatus('error', `Could not load the fitting engine (${res.error}). Check your internet connection and reload the page.`);
    throw new Error(res.error);
  }
  state.defaults = res.defaults;
  state.settings = defaultSettings();
  buildParamTable();
  setEngineStatus('ready', `Fitting engine ready (loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s).`);
})();

function setEngineStatus(kind, text) {
  const el = $('#engine-status');
  el.className = `engine-status ${kind}`;
  el.querySelector('.engine-text').textContent = text;
}

// ---------------------------------------------------------------------------
// Fit queue: one fit at a time in the worker, the UI stays responsive.
// ---------------------------------------------------------------------------
let queue = Promise.resolve();

function buildRequest(spec) {
  const s = state.settings;
  return {
    x: spec.raw.x, y: spec.raw.y, model: state.model, unit: spec.unit,
    jacobian: s.jacobian, normalize: s.normalize, auto_x0: s.autoX0,
    range: s.range.min === null && s.range.max === null ? null : [s.range.min, s.range.max],
    params: s.params[state.model],
  };
}

function fitSpectra(specs) {
  for (const spec of specs) {
    spec.status = 'busy';
    queue = queue.then(async () => {
      try { await engineReady; } catch { spec.status = 'error'; spec.error = 'Fitting engine not available.'; renderAll(); return; }
      if (!state.spectra.includes(spec)) return;  // removed meanwhile
      const res = await callWorker('fit', { request: buildRequest(spec) });
      if (res.ok) {
        spec.result = res.result;
        spec.error = null;
        spec.status = res.result.messages.length ? 'warn' : 'ok';
        spec.ms = res.ms;
      } else {
        spec.result = null;
        spec.error = res.error;
        spec.status = 'error';
      }
      renderList();
      if (spec.id === state.selectedId) renderView();
      renderSummary();
      scheduleSeries();
    });
  }
  renderList();
  if (specs.some((s) => s.id === state.selectedId)) renderView();
  return queue;
}

// Series plots are re-drawn at most every 150 ms while a batch is fitting.
let seriesTimer = null;
function scheduleSeries() {
  clearTimeout(seriesTimer);
  seriesTimer = setTimeout(renderSeries, 150);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
function addSpectrum(name, text) {
  let parsed;
  try {
    parsed = parseSpectrum(text);
  } catch (err) {
    showFileError(`${name}: ${err.message}`);
    return null;
  }
  const det = detectUnit(parsed.x, parsed.headerText);
  const s = state.settings;
  const spec = {
    id: nextId++, name, raw: { x: parsed.x, y: parsed.y }, parseInfo: parsed,
    unitAuto: det, unit: s && s.unitMode !== 'auto' ? s.unitMode : det.unit,
    status: 'pending', result: null, error: null, seriesValue: {},
  };
  state.spectra.push(spec);
  return spec;
}

async function handleFiles(fileList) {
  clearFileErrors();
  const files = [...fileList].filter((f) => f.size < 20e6 || (showFileError(`${f.name}: file is larger than 20 MB.`), false));
  const added = [];
  for (const f of files) {
    try {
      const spec = addSpectrum(f.name, await f.text());
      if (spec) added.push(spec);
    } catch (err) {
      showFileError(`${f.name}: could not read the file (${err.message}).`);
    }
  }
  afterAdd(added);
}

async function loadExamples() {
  clearFileErrors();
  const names = ['examplePL.csv', 'examplePL_subpopulation.txt'];
  const added = [];
  for (const n of names) {
    try {
      const resp = await fetch(`data/${n}`);
      if (!resp.ok) throw new Error(resp.statusText);
      const spec = addSpectrum(n, await resp.text());
      if (spec) added.push(spec);
    } catch (err) {
      showFileError(`Could not load example ${n} (${err.message}).`);
    }
  }
  afterAdd(added);
}

function afterAdd(added) {
  if (!added.length) return;
  if (!state.selectedId || !state.spectra.find((s) => s.id === state.selectedId)) state.selectedId = added[0].id;
  $('#results').hidden = false;
  $('#clear-btn').hidden = false;
  fitSpectra(added);
  renderAll();
}

function showFileError(text) {
  const div = document.createElement('div');
  div.className = 'msg error';
  div.textContent = text;
  $('#file-errors').append(div);
}
function clearFileErrors() { $('#file-errors').replaceChildren(); }

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const selected = () => state.spectra.find((s) => s.id === state.selectedId);
const paramMeta = () => MODELS[state.model].params;

function renderAll() {
  renderList();
  renderView();
  renderSummary();
  renderSeries();
}

function renderList() {
  const ul = $('#spectrum-list');
  ul.replaceChildren(...state.spectra.map((spec) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(spec.id === state.selectedId));
    b.title = spec.name;
    const dot = document.createElement('span');
    dot.className = `dot ${spec.status === 'busy' || spec.status === 'pending' ? 'busy' : spec.status}`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = spec.name;
    b.append(dot, name);
    b.onclick = () => { state.selectedId = spec.id; renderList(); renderView(); };
    li.append(b);
    return li;
  }));
  $('#spectrum-count').textContent = `(${state.spectra.length})`;
}

function message(kind, text) {
  const d = document.createElement('div');
  d.className = `msg ${kind}`;
  d.textContent = text;
  return d;
}

function fmt(v, digits) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) return v.toExponential(Math.max(digits - 1, 2));
  return v.toFixed(digits);
}

/**
 * Format a value and its uncertainty consistently: the uncertainty with two
 * significant digits and the value rounded to the same decimal place
 * (but never fewer decimals than the parameter's default).
 */
function fmtPair(v, err, digits) {
  if (err === null || err === undefined || !Number.isFinite(err) || err <= 0) return [fmt(v, digits), err === 0 ? '' : '–'];
  if (!Number.isFinite(v)) return ['–', '–'];
  const dec = Math.max(0, 1 - Math.floor(Math.log10(err)));
  if (dec > 8 || Math.abs(v) < 1e-3 && v !== 0) return [v.toExponential(3), err.toExponential(1)];
  const d = Math.max(dec, Math.min(digits, dec + 2));
  return [v.toFixed(Math.max(d, 0)), err.toFixed(dec)];
}

function isNarrow() { return window.matchMedia('(max-width: 640px)').matches; }

function renderView() {
  const spec = selected();
  const plotDiv = $('#plot-main');
  if (!spec) { if (window.Plotly) Plotly.purge(plotDiv); return; }
  $('#view-title').textContent = spec.name;
  $$('.unit-toggle .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === spec.unit)));

  const msgs = $('#view-messages');
  const list = [];
  const p = spec.parseInfo;
  const info = [`${p.x.length} data points`, `${p.separator} separated`];
  if (p.decimalComma) info.push('decimal comma');
  if (p.skippedLines) info.push(`${p.skippedLines} header/other lines skipped`);
  if (p.extraColumns) info.push('extra columns ignored');
  info.push(`x column read as ${spec.unit === 'nm' ? 'wavelength (nm)' : 'energy (eV)'}${spec.unitAuto.confident ? '' : ' (please check)'}`);
  list.push(message('info', info.join(' · ')));
  for (const w of p.warnings) list.push(message('warn', w));
  if (spec.status === 'busy' || spec.status === 'pending') list.push(message('info', 'Fitting…'));
  if (spec.error) list.push(message('error', `Fit failed: ${spec.error}`));
  if (spec.result) for (const m of spec.result.messages) list.push(message('warn', m));
  msgs.replaceChildren(...list);

  const table = $('#result-table');
  if (!spec.result) {
    table.replaceChildren();
    $('#fit-quality').textContent = '';
    if (window.Plotly) Plotly.purge(plotDiv);
    return;
  }
  const r = spec.result;
  const fig = spectrumFigure(spec, { narrow: isNarrow() });
  if (window.Plotly) {
    Plotly.react(plotDiv, fig.data, fig.layout, { responsive: true, displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'autoScale2d'], toImageButtonOptions: { filename: spec.name.replace(/\.[^.]+$/, '') } });
    attachRangePicker(plotDiv);
  }

  // Result table
  const meta = MODELS[r.model].params;
  const rows = [['<th>Parameter</th><th>Value</th><th>± 1σ</th><th>Unit</th><th></th>']];
  meta.forEach((m, i) => {
    const note = r.fixed[i] ? 'fixed' : r.at_bound.includes(m.key) ? 'at bound' : '';
    const [val, err] = r.fixed[i] ? [fmt(r.popt[i], m.digits), ''] : fmtPair(r.popt[i], r.perr[i], m.digits);
    rows.push(`<td>${m.label}</td><td class="num">${val}</td>` +
      `<td class="num">${err}</td><td>${m.unit}</td><td class="flag">${note}</td>`);
  });
  const eg = r.popt[0], egErr = r.perr[0];
  const lam = HC_EV_NM / eg;
  const lamErr = egErr === null ? null : HC_EV_NM / eg ** 2 * egErr;
  const [lv, le] = fmtPair(lam, lamErr, 2);
  rows.push(`<td>E<sub>G</sub> as wavelength</td><td class="num">${lv}</td><td class="num">${le}</td><td>nm</td><td></td>`);
  table.innerHTML = rows.map((r0, k) => (k === 0 ? `<thead><tr>${r0}</tr></thead><tbody>` : `<tr>${r0}</tr>`)).join('') + '</tbody>';
  $('#fit-quality').textContent = `Fit quality: R² = ${fmt(r.r2, 6)} · RMS of residuals = ${fmt(r.rms, 5)} · ` +
    `reduced χ² (unit weights) = ${r.red_chi2.toExponential(3)} · ${r.n_points} points, ${r.n_free} free parameters` +
    (spec.ms ? ` · fit time ${spec.ms.toFixed(0)} ms` : '');
}

function renderSummary() {
  const card = $('#summary-card');
  if (state.spectra.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const meta = paramMeta();
  const shown = meta.slice(0, 4);
  let html = '<thead><tr><th>File</th>' + shown.map((m) => `<th>${m.label}${m.unit ? ` (${m.unit})` : ''}</th>`).join('') +
    '<th>R²</th><th>Status</th></tr></thead><tbody>';
  for (const spec of state.spectra) {
    const r = spec.result && spec.result.model === state.model ? spec.result : null;
    html += `<tr><td>${escapeHtml(spec.name)}</td>`;
    html += shown.map((m, i) => `<td class="num">${r ? fmtPair(r.popt[i], r.perr[i], m.digits).join(' ± ') : '–'}</td>`).join('');
    const status = spec.status === 'error' ? 'failed' : spec.status === 'warn' ? 'warning' : spec.status === 'ok' ? 'ok' : 'fitting…';
    html += `<td class="num">${r ? fmt(r.r2, 5) : '–'}</td><td>${status}</td></tr>`;
  }
  $('#summary-table').innerHTML = html + '</tbody>';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Series analysis
// ---------------------------------------------------------------------------
function seriesValue(spec) {
  const k = state.series.kind;
  if (spec.seriesValue[k] === undefined) {
    const v = valueFromFileName(spec.name, k);
    spec.seriesValue[k] = v ? { value: v.value, matched: v.matched, manual: false } : { value: null, matched: '', manual: false };
  }
  return spec.seriesValue[k];
}

export function seriesPoints() {
  if (!state.series.enabled) return [];
  return state.spectra
    .filter((s) => s.result && s.result.model === state.model && Number.isFinite(seriesValue(s).value))
    .map((s) => ({ name: s.name, value: seriesValue(s).value, result: s.result }));
}

function renderSeries() {
  const content = $('#series-content');
  content.hidden = !state.series.enabled;
  $('#export-series-label').hidden = !state.series.enabled;
  if (!state.series.enabled) return;
  const kind = state.series.kind;
  const unit = kind === 'time' ? 's' : 'K';

  // Table with editable values
  const missing = [];
  let html = `<thead><tr><th>File</th><th>Read from name</th><th>${kind === 'time' ? 'Time (s)' : 'Temperature (K)'}</th></tr></thead><tbody>`;
  state.spectra.forEach((spec) => {
    const v = seriesValue(spec);
    if (!Number.isFinite(v.value)) missing.push(spec.name);
    html += `<tr><td>${escapeHtml(spec.name)}</td><td>${v.manual ? 'edited' : escapeHtml(v.matched || 'not found')}</td>` +
      `<td><input type="number" step="any" data-series-id="${spec.id}" value="${Number.isFinite(v.value) ? v.value : ''}" aria-label="${kind} value for ${escapeHtml(spec.name)}"></td></tr>`;
  });
  $('#series-table').innerHTML = html + '</tbody>';
  $$('#series-table input').forEach((inp) => {
    inp.onchange = () => {
      const spec = state.spectra.find((s) => s.id === Number(inp.dataset.seriesId));
      const val = inp.value === '' ? null : Number(inp.value);
      spec.seriesValue[kind] = { value: val, matched: '', manual: true };
      renderSeriesPlots();
      renderSeriesMessages();
    };
  });
  renderSeriesMessages(missing);
  renderSeriesPlots();
}

function renderSeriesMessages(missing) {
  const kind = state.series.kind;
  if (!missing) missing = state.spectra.filter((s) => !Number.isFinite(seriesValue(s).value)).map((s) => s.name);
  const msgs = [];
  if (missing.length) {
    msgs.push(message('warn', `No ${kind} value found in the file name of: ${missing.join(', ')}. ` +
      `These spectra are excluded from the series plots. Enter a value in the table to include them.`));
  }
  $('#series-messages').replaceChildren(...msgs);
}

function renderSeriesPlots() {
  if (!window.Plotly) return;
  const pts = seriesPoints();
  const grid = $('#series-params');
  const keys = SERIES_PARAMS[state.model];
  if (grid.children.length !== keys.length) {
    grid.replaceChildren(...keys.map(() => document.createElement('div')));
  }
  const config = { responsive: true, displaylogo: false };
  keys.forEach((key, i) => {
    const fig = seriesParamFigure(pts, state.model, key, state.series.kind);
    Plotly.react(grid.children[i], fig.data, fig.layout, config);
  });
  const sf = seriesSpectraFigure(pts, state.series.kind);
  Plotly.react($('#series-spectra'), sf.data, sf.layout, config);
}

// ---------------------------------------------------------------------------
// Advanced settings
// ---------------------------------------------------------------------------
function buildParamTable() {
  const tbody = $('#param-table tbody');
  const ps = state.settings.params[state.model];
  tbody.replaceChildren(...paramMeta().map((m, i) => {
    const tr = document.createElement('tr');
    const p = ps[i];
    tr.innerHTML = `<td>${m.label}${m.unit ? ` <span class="muted small">(${m.unit})</span>` : ''}</td>` +
      ['p0', 'lower', 'upper'].map((f) => `<td><input type="number" step="any" data-i="${i}" data-f="${f}" value="${p[f]}" aria-label="${m.plain} ${f}"></td>`).join('') +
      `<td><input type="checkbox" data-i="${i}" data-f="fixed" ${p.fixed ? 'checked' : ''} aria-label="Fix ${m.plain}"></td>`;
    return tr;
  }));
  updateX0Field();
}

function updateX0Field() {
  const inp = $('#param-table input[data-i="0"][data-f="p0"]');
  if (!inp) return;
  const auto = $('#auto-x0').checked && !state.settings.params[state.model][0].fixed;
  inp.disabled = auto;
  inp.title = auto ? 'Set automatically to the energy of the spectral maximum' : '';
}

function readSettingsFromForm() {
  const s = state.settings;
  $$('#param-table input').forEach((inp) => {
    const p = s.params[state.model][Number(inp.dataset.i)];
    if (inp.dataset.f === 'fixed') p.fixed = inp.checked;
    else if (inp.value !== '' && Number.isFinite(Number(inp.value))) p[inp.dataset.f] = Number(inp.value);
  });
  s.autoX0 = $('#auto-x0').checked;
  s.jacobian = $('#jacobian').checked;
  s.normalize = $('#normalize').checked;
  const num = (v) => (v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  s.range = { min: num($('#range-min').value), max: num($('#range-max').value) };
  s.unitMode = $('input[name="unit"]:checked').value;
  for (const spec of state.spectra) {
    if (s.unitMode !== 'auto') spec.unit = s.unitMode;
    else if (!spec.unitManual) spec.unit = spec.unitAuto.unit;
  }
}

function validateSettings() {
  const errs = [];
  const { range } = state.settings;
  if (range.min !== null && range.max !== null && range.min >= range.max) errs.push('Fit range: Min must be smaller than Max.');
  paramMeta().forEach((m, i) => {
    const p = state.settings.params[state.model][i];
    if (!p.fixed && p.lower >= p.upper) errs.push(`${m.plain}: lower bound must be smaller than upper bound.`);
  });
  return errs;
}

function refitAll() {
  if (!state.settings) return;
  readSettingsFromForm();
  const errs = validateSettings();
  clearFileErrors();
  if (errs.length) { errs.forEach(showFileError); return; }
  fitSpectra(state.spectra);
}

let pickingRange = false;
function attachRangePicker(plotDiv) {
  if (plotDiv._galaPicker) return;
  plotDiv._galaPicker = true;
  plotDiv.on('plotly_selected', (ev) => {
    if (!pickingRange || !ev || !ev.range) return;
    const xr = ev.range.x || ev.range.x2 || ev.range.x3;
    if (!xr) return;
    $('#range-min').value = Math.min(...xr).toFixed(4);
    $('#range-max').value = Math.max(...xr).toFixed(4);
    pickingRange = false;
    Plotly.relayout(plotDiv, { dragmode: 'zoom' });
    $('#advanced').open = true;
    refitAll();
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function wire() {
  const dz = $('#drop-zone');
  const fi = $('#file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFiles(fi.files); fi.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  // Dropping a file anywhere else on the page should not open it in the browser.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (!dz.contains(e.target)) handleFiles(e.dataTransfer.files); });

  $('#example-btn').addEventListener('click', loadExamples);
  $('#clear-btn').addEventListener('click', () => {
    state.spectra = [];
    state.selectedId = null;
    $('#results').hidden = true;
    $('#clear-btn').hidden = true;
    clearFileErrors();
    renderAll();
  });

  $$('input[name="model"]').forEach((r) => r.addEventListener('change', async () => {
    await engineReady.catch(() => {});
    if (state.settings) readSettingsFromForm();
    state.model = r.value;
    $('#galx-info').classList.toggle('active', state.model === 'GaLx');
    if (state.settings) { buildParamTable(); $('#series-params').replaceChildren(); fitSpectra(state.spectra); }
  }));

  $$('.unit-toggle .seg').forEach((b) => b.addEventListener('click', () => {
    const spec = selected();
    if (!spec || spec.unit === b.dataset.unit) return;
    spec.unit = b.dataset.unit;
    spec.unitManual = true;
    fitSpectra([spec]);
  }));

  $('#refit-btn').addEventListener('click', refitAll);
  $('#reset-btn').addEventListener('click', () => {
    if (!state.defaults) return;
    state.settings = defaultSettings();
    $('#auto-x0').checked = true;
    $('#jacobian').checked = true;
    $('#normalize').checked = true;
    $('#normalize-hint').hidden = true;
    $('#range-min').value = '';
    $('#range-max').value = '';
    $('input[name="unit"][value="auto"]').checked = true;
    state.spectra.forEach((s) => { s.unitManual = false; });
    buildParamTable();
  });
  $('#auto-x0').addEventListener('change', updateX0Field);
  $('#param-table').addEventListener('change', (e) => {
    if (e.target.dataset.f === 'fixed') {
      state.settings.params[state.model][Number(e.target.dataset.i)].fixed = e.target.checked;
      updateX0Field();
    }
  });
  $('#normalize').addEventListener('change', (e) => { $('#normalize-hint').hidden = e.target.checked; });
  $('#range-clear').addEventListener('click', () => { $('#range-min').value = ''; $('#range-max').value = ''; refitAll(); });
  $('#range-pick').addEventListener('click', () => {
    const div = $('#plot-main');
    if (!selected() || !selected().result || !window.Plotly) return;
    pickingRange = true;
    Plotly.relayout(div, { dragmode: 'select', selectdirection: 'h' });
    $('#view-messages').prepend(message('info', 'Drag horizontally across a plot to select the fit range.'));
    div.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#series-enable').addEventListener('change', (e) => { state.series.enabled = e.target.checked; renderSeries(); });
  $$('input[name="series-kind"]').forEach((r) => r.addEventListener('change', () => { state.series.kind = r.value; renderSeries(); }));

  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.copy === 'bibtex' ? CITATION.bibtex : CITATION.text;
    const fb = $('.copy-feedback');
    try {
      await navigator.clipboard.writeText(text);
      fb.textContent = b.dataset.copy === 'bibtex' ? 'BibTeX copied.' : 'Citation copied.';
    } catch {
      fb.textContent = 'Copy failed. Please select the text manually.';
    }
    setTimeout(() => { fb.textContent = ''; }, 2500);
  }));

  $('#download-btn').addEventListener('click', async () => {
    const choices = $$('input[name="export"]:checked').map((c) => c.value)
      .filter((c) => c !== 'series' || state.series.enabled);
    const status = $('#export-status');
    const btn = $('#download-btn');
    btn.disabled = true;
    try {
      await runExport({ spectra: state.spectra, model: state.model, settings: state.settings,
        series: state.series, seriesValue, seriesPoints: seriesPoints() }, choices, (t) => { status.textContent = t; });
    } catch (err) {
      status.textContent = `Export failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('gala-theme', root.dataset.theme); } catch { /* storage unavailable */ }
    renderView();
    renderSeriesPlots();
  });

  let resizeTimer = null;
  let lastNarrow = isNarrow();
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isNarrow() !== lastNarrow) { lastNarrow = isNarrow(); renderView(); } }, 200);
  });
}

function initTheme() {
  try {
    const t = localStorage.getItem('gala-theme');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  } catch { /* storage unavailable */ }
}

function renderFormulas() {
  if (!window.katex) return;
  $$('.formula[data-tex]').forEach((el) => {
    try { katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false }); } catch { el.textContent = el.dataset.tex; }
  });
}

initTheme();
wire();
renderFormulas();
engineReady.then(() => { if (state.spectra.length) renderAll(); }).catch(() => {});

// Exposed for automated tests in the browser console.
window.__gala = { state, engineReady };

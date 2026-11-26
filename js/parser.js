/**
 * Spectrum file parser (pure JavaScript, no DOM access, unit-testable in Node).
 *
 * Accepts two-or-more-column text files with:
 *   - any number of header / metadata / comment lines (skipped),
 *   - comma, tab, semicolon or whitespace as column separator (auto-detected),
 *   - decimal point or decimal comma (decimal comma only when the separator
 *     is not a comma).
 * A data line is a line whose first two fields parse as numbers.
 * The first two numeric columns are used as x and intensity.
 */

const COMMENT_PREFIXES = ['#', '%', ';', '//', '!', '*'];

/** Separators tried, in order of preference when several fit equally well. */
const SEPARATORS = [
  { name: 'tab', label: 'tab', split: (l) => l.split('\t') },
  { name: 'semicolon', label: 'semicolon', split: (l) => l.split(';') },
  { name: 'comma', label: 'comma', split: (l) => l.split(',') },
  { name: 'whitespace', label: 'whitespace', split: (l) => l.trim().split(/\s+/) },
];

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA_NUMBER_RE = /^[+-]?(\d+,?\d*|,\d+)([eE][+-]?\d+)?$/;

/**
 * Parse one field to a number.
 * @param {string} field
 * @param {boolean} allowDecimalComma  true if the separator is not a comma
 * @returns {{value:number, decimalComma:boolean}|null}
 */
export function parseNumber(field, allowDecimalComma) {
  let s = field.trim().replace(/^["']|["']$/g, '').trim();
  if (s === '') return null;
  if (NUMBER_RE.test(s)) return { value: Number(s), decimalComma: false };
  if (allowDecimalComma && COMMA_NUMBER_RE.test(s)) {
    return { value: Number(s.replace(',', '.')), decimalComma: true };
  }
  return null;
}

function isCommentLine(line) {
  return COMMENT_PREFIXES.some((p) => line.startsWith(p));
}

/** Try to read a line as data with a given separator. */
function readLine(line, sep) {
  const fields = sep.split(line).filter((f, i, arr) =>
    // ignore a trailing empty field caused by a trailing separator
    !(i === arr.length - 1 && f.trim() === ''));
  if (fields.length < 2) return null;
  const allowDecimalComma = sep.name !== 'comma';
  const a = parseNumber(fields[0], allowDecimalComma);
  const b = parseNumber(fields[1], allowDecimalComma);
  if (!a || !b) return null;
  return {
    x: a.value,
    y: b.value,
    nFields: fields.length,
    decimalComma: a.decimalComma || b.decimalComma,
  };
}

/**
 * Parse a spectrum file.
 * @param {string} text  file content
 * @returns {{x:number[], y:number[], separator:string, decimalComma:boolean,
 *            skippedLines:number, headerText:string, warnings:string[]}}
 * @throws {Error} with a user-readable message if the file cannot be read.
 */
export function parseSpectrum(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const candidates = lines
    .map((raw, index) => ({ raw, line: raw.trim(), index }))
    .filter((l) => l.line !== '' && !isCommentLine(l.line));

  // Choose the separator that turns the most lines into data lines.
  let best = null;
  for (const sep of SEPARATORS) {
    const rows = [];
    for (const l of candidates) {
      const r = readLine(l.line, sep);
      if (r) rows.push({ ...r, index: l.index });
    }
    if (!best || rows.length > best.rows.length) best = { sep, rows };
  }

  if (!best || best.rows.length === 0) {
    throw new Error('No data found. Expected lines with at least two numbers ' +
      '(x and intensity), separated by comma, tab, semicolon or spaces.');
  }

  const { sep, rows } = best;
  const warnings = [];

  // Comma separator together with decimal commas cannot be told apart.
  if (sep.name === 'comma') {
    const counts = new Set(rows.map((r) => r.nFields));
    const dataText = rows.map((r) => lines[r.index]).join('\n');
    const hasDot = dataText.includes('.');
    if (counts.size > 1 || (!hasDot && rows[0].nFields >= 3)) {
      throw new Error('This file looks ambiguous: commas seem to be used both ' +
        'as column separator and as decimal mark (for example "400,6089,85"). ' +
        'Please save it with a semicolon or tab as separator, or with a ' +
        'decimal point.');
    }
  }

  // Drop non-finite rows, then sort by x.
  let data = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  const dropped = rows.length - data.length;
  if (dropped > 0) warnings.push(`${dropped} rows with non-finite values were ignored.`);

  let sorted = true;
  for (let i = 1; i < data.length; i++) {
    if (data[i].x < data[i - 1].x) { sorted = false; break; }
  }
  if (!sorted) data = [...data].sort((a, b) => a.x - b.x);

  if (data.length < 20) {
    warnings.push(`Only ${data.length} data points found; the fit may be unreliable.`);
  }

  // Lines before the first data line (used to guess the unit from the header).
  const firstIndex = rows[0].index;
  const headerText = lines.slice(0, firstIndex).join('\n');
  const skippedLines = lines.filter((l) => l.trim() !== '').length - rows.length;

  return {
    x: data.map((r) => r.x),
    y: data.map((r) => r.y),
    separator: sep.label,
    decimalComma: rows.some((r) => r.decimalComma),
    extraColumns: rows[0].nFields > 2,
    skippedLines,
    headerText,
    warnings,
  };
}

/**
 * Guess whether the x column is wavelength (nm) or energy (eV).
 * @returns {{unit:'nm'|'eV', confident:boolean}}
 */
export function detectUnit(x, headerText = '') {
  const sorted = [...x].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median > 100) return { unit: 'nm', confident: true };
  if (median > 0 && median < 10) return { unit: 'eV', confident: true };
  const h = headerText.toLowerCase();
  if (/\bev\b|energy/.test(h)) return { unit: 'eV', confident: false };
  return { unit: 'nm', confident: false };
}

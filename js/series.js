/**
 * Read a time or temperature value from a file name (pure JS, unit-testable).
 *
 * Examples:  LR23_5s.txt -> 5 s,  sample_0.5 s.csv -> 0.5 s,  run_10min -> 600 s,
 *            CsPbBr3_300K.txt -> 300 K,  T_25°C.dat -> 298.15 K,  77 K.txt -> 77 K
 * A number must not be glued to a preceding digit, dot or comma, and the unit
 * must not be followed by another letter (so "5samples" is not read as 5 s).
 * If several values match, the last one is used.
 */

const TIME_UNITS = [
  { re: 'ms|msec', factor: 1e-3 },
  { re: 'minutes|minute|mins|min', factor: 60 },
  { re: 'seconds|second|secs|sec|s', factor: 1 },
  { re: 'hours|hour|hrs|hr|h', factor: 3600 },
];

const TEMP_UNITS = [
  { re: 'K', offset: 0 },
  { re: '°C|°c|degC|degc|C', offset: 273.15 },
];

function stripExtension(name) {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function lastMatch(stem, units) {
  let found = null;
  for (const u of units) {
    const re = new RegExp(`(?<![0-9.,])(\\d+(?:[.,]\\d+)?)\\s*(?:${u.re})(?![A-Za-z])`, 'gi');
    let m;
    while ((m = re.exec(stem)) !== null) {
      if (!found || m.index > found.index) found = { index: m.index, text: m[0], number: Number(m[1].replace(',', '.')), unit: u };
    }
  }
  return found;
}

/**
 * @param {string} fileName
 * @param {'time'|'temperature'} kind
 * @returns {{value:number, unit:string, matched:string}|null}
 *          value in seconds (time) or kelvin (temperature)
 */
export function valueFromFileName(fileName, kind) {
  const stem = stripExtension(fileName);
  if (kind === 'time') {
    const m = lastMatch(stem, TIME_UNITS);
    return m ? { value: m.number * m.unit.factor, unit: 's', matched: m.text.trim() } : null;
  }
  const m = lastMatch(stem, TEMP_UNITS);
  return m ? { value: m.number + m.unit.offset, unit: 'K', matched: m.text.trim() } : null;
}

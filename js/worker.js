/* Web Worker: loads Pyodide and the GaLa Python code, then runs fits.
 * Classic worker (Pyodide is loaded with importScripts).
 *
 * Messages in:  {id, type:'init', indexURL}    -> {id, ok, defaults}
 *               {id, type:'fit', request}      -> {id, ok, result | error}
 * Messages out: {type:'status', text}          progress while loading
 */

let pyodide = null;
let fitJson = null;

const PY_FILES = ['gala/__init__.py', 'gala/models.py', 'gala/utils.py', 'gala_web.py'];

async function init(indexURL) {
  postMessage({ type: 'status', text: 'Downloading Python runtime…' });
  importScripts(indexURL + 'pyodide.js');
  pyodide = await self.loadPyodide({ indexURL });

  postMessage({ type: 'status', text: 'Loading numpy and scipy…' });
  await pyodide.loadPackage(['numpy', 'scipy']);

  postMessage({ type: 'status', text: 'Loading GaLa model code…' });
  pyodide.FS.mkdirTree('/home/pyodide/gala');
  for (const f of PY_FILES) {
    const resp = await fetch(new URL('../py/' + f, self.location.href));
    if (!resp.ok) throw new Error(`Could not load py/${f} (${resp.status})`);
    pyodide.FS.writeFile('/home/pyodide/' + f, await resp.text());
  }
  pyodide.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
  const mod = pyodide.pyimport('gala_web');
  fitJson = mod.fit_json;
  return JSON.parse(mod.defaults_json());
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    if (type === 'init') {
      const defaults = await init(event.data.indexURL);
      postMessage({ id, ok: true, defaults });
    } else if (type === 'fit') {
      const t0 = performance.now();
      const out = JSON.parse(fitJson(JSON.stringify(event.data.request)));
      out.ms = performance.now() - t0;
      postMessage({ id, ...out });
    }
  } catch (err) {
    postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};

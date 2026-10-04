'use strict';
/**
 * Respaldo de OCR 100% local con Tesseract.js (cualquier idioma, sin cuenta ni claves).
 * - Ingles va incluido en la app; los demas idiomas se descargan una sola vez desde jsDelivr.
 * - Corre en un worker_thread propio, asi que no bloquea la interfaz.
 */
const fs = require('fs');
const path = require('path');

const DATA_URL = (code) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`;

function unpackedPath(p) {
  // Los workers no pueden leer dentro de app.asar: usamos la copia desempaquetada.
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

class TesseractOcr {
  /**
   * @param {{ langDir: string, bundledDir?: string, onStatus?: (msg:string|null)=>void }} opts
   */
  constructor({ langDir, bundledDir, onStatus }) {
    this.langDir = langDir;
    this.bundledDir = bundledDir;
    this.onStatus = onStatus || (() => {});
    this.worker = null;
    this.workerKey = null;
    this.creating = null;
    fs.mkdirSync(langDir, { recursive: true });
  }

  _file(code) { return path.join(this.langDir, `${code}.traineddata.gz`); }

  async _download(code) {
    let net = null;
    try { ({ net } = require('electron')); } catch (_) { /* fuera de Electron */ }
    const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
    const res = await doFetch(DATA_URL(code));
    if (!res.ok) throw new Error(`No se pudo descargar el idioma "${code}" (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = this._file(code) + '.part';
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, this._file(code));
  }

  /** Asegura que existan los datos de cada idioma; devuelve los que quedaron disponibles. */
  async ensureLangs(codes) {
    const ok = [];
    for (const code of codes) {
      if (fs.existsSync(this._file(code))) { ok.push(code); continue; }
      const bundled = this.bundledDir && path.join(this.bundledDir, `${code}.traineddata.gz`);
      if (bundled && fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, this._file(code));
        ok.push(code);
        continue;
      }
      try {
        this.onStatus(`Descargando datos de OCR (${code})…`);
        await this._download(code);
        ok.push(code);
      } catch (err) {
        if (codes.length === 1) { this.onStatus(null); throw err; }
      }
    }
    this.onStatus(null);
    if (!ok.length) throw new Error('No hay datos de OCR disponibles. Conéctate a internet una vez para descargarlos.');
    return ok;
  }

  async _getWorker(codes) {
    const key = codes.join('+');
    if (this.worker && this.workerKey === key) return this.worker;
    if (this.creating && this.creatingKey === key) return this.creating;
    this.creatingKey = key;
    this.creating = (async () => {
      if (this.worker) { try { await this.worker.terminate(); } catch (_) { /* nada */ } this.worker = null; }
      const { createWorker, OEM, PSM } = require('tesseract.js');
      this.onStatus('Preparando motor de OCR…');
      const workerPath = unpackedPath(require.resolve('tesseract.js/src/worker-script/node/index.js'));
      const worker = await createWorker(codes, OEM.LSTM_ONLY, {
        langPath: this.langDir,
        cacheMethod: 'none',
        gzip: true,
        workerPath,
        workerBlobURL: false,
        logger: () => {},
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
      this.worker = worker;
      this.workerKey = key;
      this.onStatus(null);
      return worker;
    })();
    try { return await this.creating; } finally { this.creating = null; }
  }

  /**
   * @param {Buffer} png
   * @param {string} tessLangs p. ej. "eng" o "eng+fra"
   * @param {number} scale factor de ampliacion aplicado al PNG (para devolver coordenadas originales)
   */
  async recognize(png, tessLangs, scale = 1) {
    const wanted = tessLangs.split('+');
    const codes = await this.ensureLangs(wanted);
    const worker = await this._getWorker(codes);
    const t0 = Date.now();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const ln of para.lines || []) {
          const words = (ln.words || [])
            .filter((w) => w.text && w.text.trim() && w.confidence >= 35)
            .map((w) => ({
              t: w.text.trim(),
              x: Math.round(w.bbox.x0 / scale), y: Math.round(w.bbox.y0 / scale),
              w: Math.round((w.bbox.x1 - w.bbox.x0) / scale), h: Math.round((w.bbox.y1 - w.bbox.y0) / scale),
            }));
          if (!words.length) continue;
          const x0 = Math.min(...words.map((w) => w.x));
          const y0 = Math.min(...words.map((w) => w.y));
          const x1 = Math.max(...words.map((w) => w.x + w.w));
          const y1 = Math.max(...words.map((w) => w.y + w.h));
          lines.push({ text: words.map((w) => w.t).join(' '), x: x0, y: y0, w: x1 - x0, h: y1 - y0, words });
        }
      }
    }
    return { lines, ms: Date.now() - t0 };
  }

  async stop() {
    if (this.worker) { try { await this.worker.terminate(); } catch (_) { /* nada */ } this.worker = null; this.workerKey = null; }
  }
}

module.exports = { TesseractOcr, unpackedPath };

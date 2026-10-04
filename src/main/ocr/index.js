'use strict';
/**
 * Servicio de OCR: elige el motor, ejecuta el reconocimiento y devuelve bloques de texto listos para traducir.
 *
 * Orden de motores (de más rápido a más lento):
 *   1. OCR de Windows del propio idioma            (~50 ms)
 *   2. OCR de Windows de otro idioma latino        (~50 ms; ver WIN_SUBSTITUTES en languages.js)
 *   3. Tesseract.js                                 (1-3 s; cualquier idioma, 100 % local)
 */
const path = require('path');
const { WindowsOcr } = require('./windows-ocr');
const { TesseractOcr } = require('./tesseract-ocr');
const { buildBlocks, isTranslatable } = require('./layout');
const { byCode, pickWindowsEngine } = require('../languages');

class OcrService {
  /**
   * @param {{ userData:string, resources:string, onStatus?:(m:string|null)=>void }} opts
   */
  constructor({ userData, resources, onStatus }) {
    this.windows = new WindowsOcr({
      scriptSource: path.join(__dirname, 'windows-ocr.ps1'),
      workDir: path.join(userData, 'ocr'),
    });
    this.tesseract = new TesseractOcr({
      langDir: path.join(userData, 'tessdata'),
      bundledDir: path.join(resources, 'tessdata'),
      onStatus,
    });
    this.windowsLangs = [];
    this.windowsError = null;
  }

  /** Arranca en segundo plano el motor de Windows para que la primera traduccion sea instantanea. */
  async warmUp() {
    try {
      const { langs } = await this.windows.start();
      this.windowsLangs = langs;
      this.windowsError = null;
    } catch (err) {
      this.windowsError = String(err && err.message ? err.message : err);
    }
    return this.status();
  }

  status() {
    return { windowsLangs: this.windowsLangs, windowsError: this.windowsError };
  }

  /** Motor de Windows que se usaría para `lang` ({tag, exact}) o null. */
  windowsEngineFor(lang) {
    return pickWindowsEngine(lang, this.windowsLangs);
  }

  _upscale(png, factor) {
    let nativeImage = null;
    try { ({ nativeImage } = require('electron')); } catch (_) { /* fuera de Electron */ }
    if (!nativeImage || !nativeImage.createFromBuffer || factor === 1) return { png, scale: 1 };
    const img = nativeImage.createFromBuffer(png);
    const { width } = img.getSize();
    if (!width) return { png, scale: 1 };
    const out = img.resize({ width: Math.round(width * factor), quality: 'best' });
    return { png: out.toPNG(), scale: factor };
  }

  /**
   * @param {Buffer} png captura del area (px fisicos)
   * @param {{ lang?:string, engine?:'auto'|'windows'|'tesseract' }} opts
   */
  async recognize(png, { lang = 'auto', engine = 'auto' } = {}) {
    const t0 = Date.now();
    const l = byCode(lang);
    let meta = null;
    let raw = null;

    if (engine !== 'tesseract' && this.windows.available) {
      if (!this.windowsLangs.length && !this.windowsError) await this.warmUp();
      const pick = this.windowsEngineFor(lang);
      if (pick) {
        try {
          const r = await this.windows.recognize(png, pick.tag);
          raw = r.lines;
          meta = { engine: 'windows', tag: pick.tag, substitute: !pick.exact, engineMs: r.ms, captureMs: 0 };
        } catch (err) {
          this.windowsError = String(err.message || err);
          if (engine === 'windows') throw err;
        }
      } else if (engine === 'windows') {
        throw new Error(`Windows no tiene el idioma de OCR "${l.label}" instalado.`);
      }
    }

    if (!raw) {
      const prepared = this._upscale(png, 2);
      const r = await this.tesseract.recognize(prepared.png, l.tess, prepared.scale);
      raw = r.lines;
      meta = { engine: 'tesseract', tag: l.tess, substitute: false, engineMs: r.ms, captureMs: 0 };
    }

    // Tamaño real de la captura (cabecera IHDR del PNG): sirve para descartar texto cortado en los bordes.
    const size = png.length > 24 && png.readUInt32BE(12) === 0x49484452
      ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
      : null;
    return this._finish(raw, size, meta, t0);
  }

  _finish(raw, size, meta, t0) {
    const tl = Date.now();
    const blocks = buildBlocks(raw, size).filter((b) => isTranslatable(b.text));
    blocks.forEach((b, i) => { b.id = i; });
    const layoutMs = Date.now() - tl;
    return {
      engine: meta.engine,
      tag: meta.tag,
      substitute: !!meta.substitute,
      blocks,
      ocrMs: meta.engineMs,          // (compatibilidad) tiempo del motor
      timing: { captureMs: meta.captureMs || 0, engineMs: meta.engineMs || 0, layoutMs, totalMs: Date.now() - t0 },
      totalMs: Date.now() - t0,
      lineCount: raw.length,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
    };
  }

  /**
   * Captura la zona directamente de la pantalla (sin puntero del ratón) y reconoce su texto.
   * @param {{x:number,y:number,w:number,h:number}} rect píxeles físicos de pantalla
   */
  async recognizeRegion(rect, { lang = 'auto', engine = 'auto' } = {}) {
    const t0 = Date.now();
    if (!this.windows.available || process.env.LUPA_NO_DIRECT) throw Object.assign(new Error('Captura directa no disponible'), { code: 'NO_SCREEN_CAPTURE' });
    const l = byCode(lang);
    if (!this.windowsLangs.length && !this.windowsError) await this.warmUp();
    if (this.windowsError && !this.windowsLangs.length) throw Object.assign(new Error(this.windowsError), { code: 'NO_SCREEN_CAPTURE' });

    const pick = engine === 'tesseract' ? null : this.windowsEngineFor(lang);
    const size = { width: rect.w, height: rect.h };
    if (pick) {
      let r;
      try {
        r = await this.windows.recognizeScreen(rect, pick.tag);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (/Idioma OCR no disponible/i.test(msg)) throw err;
        this.windowsError = msg;
        throw Object.assign(new Error(msg), { code: 'NO_SCREEN_CAPTURE' });  // el renderizador usará su propio fotograma
      }
      const meta = { engine: 'windows', tag: pick.tag, substitute: !pick.exact, engineMs: Math.max(0, r.ms - (r.captureMs || 0)), captureMs: r.captureMs || 0 };
      return this._finish(r.lines, { width: r.w, height: r.h }, meta, t0);
    }
    if (engine === 'windows') throw new Error(`Windows no tiene el idioma de OCR "${l.label}" instalado.`);

    // Otro idioma: capturamos con el helper y leemos con Tesseract (se descarga el idioma la primera vez).
    const tc = Date.now();
    const cap = await this.windows.captureScreen(rect);
    const captureMs = Date.now() - tc;
    const prepared = this._upscale(cap.png, 2);
    const r = await this.tesseract.recognize(prepared.png, l.tess, prepared.scale);
    const meta = { engine: 'tesseract', tag: l.tess, substitute: false, engineMs: r.ms, captureMs };
    return this._finish(r.lines, { width: cap.w || size.width, height: cap.h || size.height }, meta, t0);
  }

  async stop() {
    this.windows.stop();
    await this.tesseract.stop();
  }
}

module.exports = { OcrService };

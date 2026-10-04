'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  bounds: null,               // { x, y, width, height } de la ventana
  sourceLang: 'auto',
  targetLang: 'es',
  mode: 'overlay',            // 'overlay' (sobre el texto original) | 'reader' (panel de lectura)
  opacityOverlay: 0.14,       // opacidad del "cristal" en modo lente (0.05 - 1)
  opacityReader: 0.9,         // opacidad del panel en modo lectura
  readerTheme: 'dark',        // 'dark' | 'light'
  fontScale: 1,               // 0.7 - 1.6
  paused: false,
  passthrough: true,          // los clics atraviesan la lente y llegan a la ventana de abajo
  ocrEngine: 'auto',          // 'auto' | 'windows' | 'tesseract'
  speed: 'balanced',          // 'fast' | 'balanced' | 'eco'
  alwaysOnTop: true,
  showTip: true,
};

const clamp = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function sanitize(input, base = DEFAULTS) {
  const s = { ...base, ...input };
  return {
    bounds: s.bounds && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(s.bounds[k])) ? {
      x: Math.round(s.bounds.x), y: Math.round(s.bounds.y),
      width: Math.round(s.bounds.width), height: Math.round(s.bounds.height),
    } : null,
    sourceLang: typeof s.sourceLang === 'string' ? s.sourceLang : DEFAULTS.sourceLang,
    targetLang: typeof s.targetLang === 'string' ? s.targetLang : DEFAULTS.targetLang,
    mode: oneOf(s.mode, ['overlay', 'reader'], DEFAULTS.mode),
    opacityOverlay: clamp(s.opacityOverlay, 0.05, 1, DEFAULTS.opacityOverlay),
    opacityReader: clamp(s.opacityReader, 0.05, 1, DEFAULTS.opacityReader),
    readerTheme: oneOf(s.readerTheme, ['dark', 'light'], DEFAULTS.readerTheme),
    fontScale: clamp(s.fontScale, 0.7, 1.6, 1),
    paused: !!s.paused,
    passthrough: !!s.passthrough,
    ocrEngine: oneOf(s.ocrEngine, ['auto', 'windows', 'tesseract'], DEFAULTS.ocrEngine),
    speed: oneOf(s.speed, ['fast', 'balanced', 'eco'], DEFAULTS.speed),
    alwaysOnTop: !!s.alwaysOnTop,
    showTip: !!s.showTip,
  };
}

class Settings {
  constructor(file) {
    this.file = file;
    this.timer = null;
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { /* primera vez o archivo dañado */ }
    this.data = sanitize(stored);
  }

  get() { return { ...this.data }; }

  patch(partial) {
    this.data = sanitize(partial, this.data);
    this._scheduleSave();
    return this.get();
  }

  _scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (_) { /* disco de solo lectura: no es critico */ }
  }
}

module.exports = { Settings, DEFAULTS, sanitize };

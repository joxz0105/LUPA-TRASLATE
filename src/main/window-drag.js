'use strict';
/**
 * Mover y redimensionar la ventana sin marco leyendo el cursor global.
 * Es mas robusto que mover con eventos del renderer: no se pierde el arrastre cuando la ventana
 * se mueve bajo el puntero ni cuando el cursor sale de ella.
 */
const { screen } = require('electron');

const TICK_MS = 8;
const MIN_VISIBLE = 90; // px de la barra que siempre deben quedar dentro de alguna pantalla
const BAR_H = 44;

function rectsIntersect(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 &&
         Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;
}

/** Evita que la ventana se pierda fuera de todas las pantallas (la barra siempre debe poder agarrarse). */
function clampToScreens(b) {
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  const bar = { x: b.x, y: b.y, width: b.width, height: BAR_H };
  const visible = displays.some((d) => {
    const w = Math.min(bar.x + bar.width, d.x + d.width) - Math.max(bar.x, d.x);
    const h = Math.min(bar.y + bar.height, d.y + d.height) - Math.max(bar.y, d.y);
    return w >= Math.min(MIN_VISIBLE, b.width) && h >= BAR_H * 0.6;
  });
  if (visible) return b;
  const d = screen.getDisplayMatching(b).workArea;
  const out = { ...b };
  out.width = Math.min(out.width, d.width);
  out.height = Math.min(out.height, d.height);
  out.x = Math.min(Math.max(out.x, d.x - out.width + MIN_VISIBLE), d.x + d.width - MIN_VISIBLE);
  out.y = Math.min(Math.max(out.y, d.y), d.y + d.height - BAR_H);
  return out;
}

class Dragger {
  constructor(win, { minWidth, minHeight, onEnd }) {
    this.win = win;
    this.minWidth = minWidth;
    this.minHeight = minHeight;
    this.onEnd = onEnd || (() => {});
    this.timer = null;
    this.start = null;
  }

  begin(mode) {
    this.end(false);
    if (!/^(move|[nsew]{1,2})$/.test(mode)) return;
    this.start = { cursor: screen.getCursorScreenPoint(), bounds: this.win.getBounds(), mode };
    this.timer = setInterval(() => this._tick(), TICK_MS);
    // red de seguridad: si el renderizador no avisa del fin del arrastre, se corta solo
    clearTimeout(this.safety);
    this.safety = setTimeout(() => this.end(), 60000);
  }

  _tick() {
    if (!this.start || this.win.isDestroyed()) { this.end(false); return; }
    const { cursor, bounds, mode } = this.start;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - cursor.x;
    const dy = c.y - cursor.y;
    let { x, y, width, height } = bounds;

    if (mode === 'move') {
      x += dx; y += dy;
    } else {
      if (mode.includes('e')) width = Math.max(this.minWidth, bounds.width + dx);
      if (mode.includes('s')) height = Math.max(this.minHeight, bounds.height + dy);
      if (mode.includes('w')) {
        width = Math.max(this.minWidth, bounds.width - dx);
        x = bounds.x + (bounds.width - width);
      }
      if (mode.includes('n')) {
        height = Math.max(this.minHeight, bounds.height - dy);
        y = bounds.y + (bounds.height - height);
      }
    }
    const cur = this.win.getBounds();
    if (cur.x === x && cur.y === y && cur.width === width && cur.height === height) return;
    this.win.setBounds({ x, y, width, height });
  }

  end(notify = true) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    clearTimeout(this.safety);
    if (this.start && !this.win.isDestroyed()) {
      // corrige derivas de tamaño por escalado de pantalla durante un movimiento
      if (this.start.mode === 'move') {
        const b = this.win.getBounds();
        const want = this.start.bounds;
        if (b.width !== want.width || b.height !== want.height) this.win.setBounds({ x: b.x, y: b.y, width: want.width, height: want.height });
      }
      const fixed = clampToScreens(this.win.getBounds());
      this.win.setBounds(fixed);
    }
    const had = !!this.start;
    this.start = null;
    if (had && notify) this.onEnd();
  }
}

module.exports = { Dragger, clampToScreens, rectsIntersect };

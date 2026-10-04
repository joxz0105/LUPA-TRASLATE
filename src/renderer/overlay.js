// Dibujo de la traducción: sobre el texto original (modo lente) o como panel de lectura.
/* ------------------------------------------------------------------ modo lente */

const blend = (c, glass, a) => c.map((v, i) => Math.round(v * (1 - a) + glass[i] * a));

export class OverlayView {
  /** @param {HTMLElement} layer capa absoluta que cubre el escenario */
  constructor(layer) {
    this.layer = layer;
    this.els = new Map();
    this.blocks = [];
    this.glass = { rgb: [9, 13, 24], a: 0.14 };
  }

  clear() {
    this.layer.replaceChildren();
    this.els.clear();
    this.blocks = [];
  }

  setStale(stale) {
    this.layer.classList.toggle('stale', !!stale);
  }

  /**
   * El cristal de la ventana oscurece lo que hay debajo pero no las traducciones (están encima):
   * mezclamos su color en el fondo de cada parche para que se fundan con el resto de la página.
   */
  setGlass(rgb, alpha) {
    this.glass = { rgb, a: alpha };
    for (const b of this.blocks) {
      const el = this.els.get(b.id);
      if (el && b.colors && !el.classList.contains('pending')) el.style.background = this._bg(b);
    }
  }

  _bg(b) {
    return `rgb(${blend(b.colors.bg, this.glass.rgb, this.glass.a).join(',')})`;
  }

  /**
   * Caja un poco más grande que el texto para taparlo bien (también los "pills" de código en línea).
   * Si el texto original estaba cortado por el borde de la lente, el parche llega hasta ese borde.
   */
  _box(b) {
    const px = Math.max(3, Math.round(b.lineH * 0.2));
    const py = Math.max(4, Math.round(b.lineH * 0.27));
    const stageW = this.layer.clientWidth;
    const x0 = b.clipL ? 0 : b.x - px;
    const x1 = b.clipR ? stageW : b.x + b.w + px;
    return { x: x0, y: b.y - py, w: x1 - x0, h: b.h + py * 2 };
  }

  /** Hasta dónde puede crecer una caja hacia la derecha / hacia abajo sin pisar a sus vecinas. */
  _room(b, box) {
    let right = this.layer.clientWidth - 4;
    let bottom = this.layer.clientHeight - 4;
    for (const o of this.blocks) {
      if (o === b) continue;
      const ob = this._box(o);
      const vOverlap = ob.y < box.y + box.h - 2 && ob.y + ob.h > box.y + 2;
      const hOverlap = ob.x < box.x + box.w - 2 && ob.x + ob.w > box.x + 2;
      if (vOverlap && ob.x >= box.x + box.w - 4) right = Math.min(right, ob.x - 4);
      if (hOverlap && ob.y >= box.y + box.h - 4) bottom = Math.min(bottom, ob.y - 3);
    }
    return { right, bottom };
  }

  /** Reparte las líneas por la altura disponible (como el interlineado original) sin desbordar. */
  _spread(el, b, box, f, lhFit, maxH) {
    const lines = Math.max(1, Math.round((el.scrollHeight - 2) / (f * lhFit)));
    if (lines < 2) return;
    const target = Math.min(1.7, Math.max(lhFit, Math.min(b.pitch / f, (Math.min(maxH, box.h) - 2) / (lines * f))));
    el.style.lineHeight = String(target);
    if (el.scrollHeight > Math.max(maxH, box.h) + 1) el.style.lineHeight = String(lhFit); // no cabía: se deshace
  }

  /**
   * Párrafos que en la página tenían el mismo tamaño de letra se muestran con tamaños parecidos
   * (si no, uno sale a 16 px y su vecino a 12 px, y parece un error).
   */
  balance() {
    const items = [];
    for (const b of this.blocks) {
      const el = this.els.get(b.id);
      if (!el || b.lineCount < 2 || !el.dataset.fit) continue;
      items.push({ b, el, fit: Number(el.dataset.fit) });
    }
    items.sort((p, q) => p.b.fontEst - q.b.fontEst);
    let i = 0;
    while (i < items.length) {
      let j = i + 1;
      while (j < items.length && items[j].b.fontEst <= items[i].b.fontEst * 1.14) j++;
      const group = items.slice(i, j);
      i = j;
      if (group.length < 3) continue;
      const fits = group.map((g) => g.fit).sort((p, q) => p - q);
      const target = Math.max(fits[0], fits[fits.length >> 1] * 0.94);
      for (const g of group) {
        if (g.fit > target + 0.4) {
          g.el.style.fontSize = `${target}px`;
          g.el.style.lineHeight = '1.24';
          const box = this._box(g.b);
          const room = this._room(g.b, box);
          const maxH = Math.max(box.h, Math.min(room.bottom - box.y, box.h + g.b.pitch * 1.6));
          this._spread(g.el, g.b, box, target, 1.24, maxH);
          g.el.dataset.fit = String(target);
        }
      }
    }
  }

  showPending(blocks) {
    this.clear();
    this.blocks = blocks;
    const frag = document.createDocumentFragment();
    for (const b of blocks) {
      const el = document.createElement('div');
      el.className = 'blk pending';
      const box = this._box(b);
      Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      this.els.set(b.id, el);
      frag.appendChild(el);
    }
    this.layer.appendChild(frag);
  }

  remove(id) {
    const el = this.els.get(id);
    if (el) { el.remove(); this.els.delete(id); }
  }

  /** Coloca la traducción dentro de la caja del bloque, ajustando el tamaño de letra para que quepa. */
  fill(b, text, fontScale = 1) {
    const el = this.els.get(b.id);
    if (!el) return;
    const box = this._box(b);
    const room = this._room(b, box);
    const single = b.lineCount === 1;
    const centered = b.align === 'center';

    el.className = 'blk';
    el.textContent = text;
    el.style.background = this._bg(b);
    el.style.color = `rgb(${b.colors.fg.join(',')})`;
    el.style.fontWeight = b.bold ? '650' : '400';
    el.style.textAlign = centered ? 'center' : 'left';
    el.style.minHeight = '';
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;

    const est = b.fontEst * fontScale;
    const maxF = Math.max(9, est * 1.08);
    const minF = Math.max(8.5, est * 0.58);
    const LH_FIT = 1.24;                       // interlineado compacto para buscar el mayor tamaño que cabe
    el.style.lineHeight = single ? '1.2' : String(LH_FIT);

    // Búsqueda binaria del mayor tamaño de letra que cabe.
    const search = (fits) => {
      if (fits(maxF)) return maxF;
      if (!fits(minF)) return null;
      let lo = minF; let hi = maxF;
      for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      return lo;
    };

    if (single) {
      // Una línea: puede crecer hacia la derecha si hay sitio libre (el español es más largo).
      const maxW = centered ? box.w : Math.max(box.w, room.right - box.x);
      el.style.whiteSpace = 'nowrap';
      el.style.width = 'auto';
      el.style.height = `${box.h}px`;
      const f = search((size) => { el.style.fontSize = `${size}px`; return el.offsetWidth <= maxW + 0.5; });
      if (f != null) {
        el.style.fontSize = `${f}px`;
        el.style.width = `${Math.max(box.w, Math.ceil(el.offsetWidth))}px`;
      } else {
        el.style.fontSize = `${minF}px`;
        el.style.whiteSpace = 'normal';
        el.style.width = `${maxW}px`;
        el.style.height = 'auto';
        el.style.minHeight = `${box.h}px`;
      }
    } else {
      // Párrafo: mismo ancho; puede crecer hacia abajo hasta donde haya hueco libre.
      const maxH = Math.max(box.h, Math.min(room.bottom - box.y, box.h + b.pitch * 1.6));
      el.style.whiteSpace = 'normal';
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
      const f = search((size) => { el.style.fontSize = `${size}px`; return el.scrollHeight <= maxH + 1; });
      if (f != null) {
        el.style.fontSize = `${f}px`;
        this._spread(el, b, box, f, LH_FIT, maxH);
        if (el.scrollHeight > box.h + 1) { el.style.height = 'auto'; el.style.minHeight = `${box.h}px`; }
        el.dataset.fit = String(f);
      } else {
        el.style.fontSize = `${minF}px`;
        el.style.height = 'auto';
        el.style.minHeight = `${box.h}px`;
      }
    }
  }
}

/* ---------------------------------------------------------------- modo lectura */

export class ReaderView {
  /** @param {HTMLElement} el contenedor del panel */
  constructor(el) {
    this.el = el;
    this.paras = new Map();
    this.baseScale = 1;
  }

  clear() {
    this.el.replaceChildren();
    this.paras.clear();
  }

  show(blocks) {
    this.clear();
    const frag = document.createDocumentFragment();
    for (const b of blocks) {
      const p = document.createElement('p');
      p.className = b.heading ? 'h pend' : 'pend';
      p.textContent = '…';
      this.paras.set(b.id, p);
      frag.appendChild(p);
    }
    this.el.appendChild(frag);
  }

  fill(b, text) {
    const p = this.paras.get(b.id);
    if (!p) return;
    p.className = b.heading ? 'h' : '';
    p.textContent = text;
  }

  remove(id) {
    const p = this.paras.get(id);
    if (p) { p.remove(); this.paras.delete(id); }
  }

  /** Reduce el tamaño de letra hasta que todo el texto quepa; si ni así, permite desplazar. */
  fit(scale = 1) {
    const el = this.el;
    this.baseScale = scale;
    let s = scale;
    el.style.setProperty('--font-scale', String(s));
    el.classList.remove('scrollable');
    let guard = 0;
    while (el.scrollHeight > el.clientHeight + 1 && s > 0.62 * scale && guard++ < 24) {
      s -= 0.025 * scale;
      el.style.setProperty('--font-scale', String(s));
    }
    const overflow = el.scrollHeight > el.clientHeight + 1;
    el.classList.toggle('scrollable', overflow);
    el.toggleAttribute('data-interactive', overflow); // permite desplazar con la rueda cuando no cabe
  }
}

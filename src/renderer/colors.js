// Muestreo de color del fondo y del texto original, para que la traducción se "integre" con la página.

const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function median(values) {
  const s = Float32Array.from(values).sort();
  return s[s.length >> 1];
}

function contrast(a, b) {
  const la = lum(a) + 0.05;
  const lb = lum(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

/**
 * @param {CanvasRenderingContext2D} ctx contexto de la captura (píxeles nativos)
 * @param {{x:number,y:number,w:number,h:number}} box caja del bloque en píxeles nativos
 * @param {Array<{x:number,y:number,w:number,h:number}>} lines cajas de las lineas del bloque (para medir la densidad de tinta)
 * @returns {{ bg: number[], fg: number[], ink: number }}
 */
export function sampleColors(ctx, box, lines = []) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(cw, Math.ceil(box.x + box.w + pad));
  const y1 = Math.min(ch, Math.ceil(box.y + box.h + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return { bg: [255, 255, 255], fg: [20, 20, 20], ink: 0 };

  const data = ctx.getImageData(x0, y0, w, h).data;
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  // Fondo: anillo exterior (mediana por canal).
  const rs = []; const gs = []; const bs = [];
  const push = (p) => { rs.push(p[0]); gs.push(p[1]); bs.push(p[2]); };
  const ring = Math.max(1, Math.min(2, (h >> 2), (w >> 2)));
  for (let x = 0; x < w; x++) {
    for (let r = 0; r < ring; r++) { push(at(x, r)); push(at(x, h - 1 - r)); }
  }
  for (let y = ring; y < h - ring; y++) {
    for (let r = 0; r < ring; r++) { push(at(r, y)); push(at(w - 1 - r, y)); }
  }
  const bg = [median(rs), median(gs), median(bs)];

  // Texto: media del 3 % de píxeles interiores más alejados del fondo (histograma: O(n)).
  const total = w * h;
  const dists = new Uint16Array(total);
  const hist = new Uint32Array(766);
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k++) {
      const i = k * 4;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      dists[k] = d;
      hist[d]++;
    }
  }
  const want = Math.max(3, Math.floor(total * 0.03));
  let cutoff = 765;
  for (let acc = 0; cutoff > 60; cutoff--) { acc += hist[cutoff]; if (acc >= want) break; }
  cutoff = Math.max(cutoff, 61);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let k = 0; k < total; k++) {
    if (dists[k] >= cutoff) { const i = k * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  let fg = n ? [r / n, g / n, b / n] : null;

  // Densidad de tinta dentro de las lineas de texto: el texto en negrita tiene bastante mas.
  let hits = 0;
  let area = 0;
  for (const ln of lines) {
    const lx0 = Math.max(0, Math.floor(ln.x) - x0);
    const ly0 = Math.max(0, Math.floor(ln.y) - y0);
    const lx1 = Math.min(w, Math.ceil(ln.x + ln.w) - x0);
    const ly1 = Math.min(h, Math.ceil(ln.y + ln.h) - y0);
    for (let y = ly0; y < ly1; y++) {
      for (let x = lx0; x < lx1; x++) { area++; if (dists[y * w + x] >= 200) hits++; }
    }
  }
  const ink = area ? hits / area : 0;

  if (!fg || contrast(fg, bg) < 4.5) fg = lum(bg) > 0.5 ? [22, 26, 38] : [244, 247, 255];
  return { bg: bg.map(Math.round), fg: fg.map(Math.round), ink };
}

export const rgb = (c, a = 1) => (a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

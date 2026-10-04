'use strict';
/**
 * Analisis de layout: convierte las lineas crudas del OCR en "bloques" (parrafos) traducibles.
 *
 * Entrada (lineas):  { text, x, y, w, h, words: [{ t, x, y, w, h }] }   (coordenadas en px de la captura)
 * Salida (bloques):  { id, text, x, y, w, h, lineCount, lineH, pitch, align, lines: [{x,y,w,h}] }
 *
 * Idea clave: una linea "envuelve" a la siguiente (soft-wrap) cuando le habria sobrado menos espacio
 * que lo que mide la primera palabra de la siguiente. Eso separa parrafos de listas/menus.
 */

// Un simbolo suelto al inicio de una linea (viñeta, icono) no es texto traducible.
const BULLET_RE = /^[^\p{L}\p{N}"'“‘(\[]$/u;
const CJK_RE = /[぀-ヿ㐀-鿿가-힯]/u;
const TERMINAL_RE = /[.!?…。！？:;]["')\]»”’]*$/u;

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function boxOfWords(words) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of words) {
    x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y);
    x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function joinWords(words) {
  // Chino/japones: sin espacios entre "palabras".
  const out = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && !(CJK_RE.test(prev.t.slice(-1)) && CJK_RE.test(w.t[0] || ''))) out.push(' ');
    out.push(w.t);
  });
  return out.join('');
}

/** Rompe una linea en segmentos cuando hay huecos grandes entre palabras (menus, columnas, botones). */
function splitLine(line) {
  let words = (line.words && line.words.length ? line.words : null);
  if (!words) return [{ ...line, words: [{ t: line.text, x: line.x, y: line.y, w: line.w, h: line.h }] }];
  words = words.filter((w) => w.t && w.t.trim());
  if (!words.length) return [];
  words.sort((a, b) => a.x - b.x);

  const refH = Math.max(line.h || 0, ...words.map((w) => w.h));
  const gapLimit = Math.max(16, refH * 1.45);
  const groups = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const gap = words[i].x - (prev.x + prev.w);
    if (gap > gapLimit) groups.push([words[i]]);
    else groups[groups.length - 1].push(words[i]);
  }

  const segments = [];
  for (let gi = 0; gi < groups.length; gi++) {
    let g = groups[gi];
    // Quita viñetas sueltas al inicio ("• texto").
    while (g.length > 1 && BULLET_RE.test(g[0].t)) g = g.slice(1);
    if (g.length === 1 && BULLET_RE.test(g[0].t)) continue;
    const b = boxOfWords(g);
    segments.push({
      text: joinWords(g), x: b.x, y: b.y, w: b.w, h: b.h, words: g,
      clipL: !!line.clipL && gi === 0,
      clipR: !!line.clipR && gi === groups.length - 1,
    });
  }
  return segments;
}

function isNoise(seg) {
  const letters = (seg.text.match(/\p{L}/gu) || []).length;
  if (letters === 0) return true;
  if (letters === 1 && !CJK_RE.test(seg.text)) return true;
  if (seg.h < 5 || seg.w < 4) return true;
  return false;
}

const startsLower = (t) => /^\p{Ll}/u.test(t.trim());
const wordCount = (seg) => (seg.words ? seg.words.length : seg.text.split(/\s+/).length);

function canFollow(a, b) {
  const hmax = Math.max(a.h, b.h);
  const hmin = Math.min(a.h, b.h);
  if (hmin / hmax < 0.6) return false;            // tamaños de letra distintos (titulo vs cuerpo)
  if (b.cy - a.cy < hmin * 0.7) return false;     // misma fila
  const gap = b.y - a.b;
  if (gap > hmax * 1.05 + 2) return false;        // demasiado separado: otro parrafo
  if (gap < -hmin * 0.5) return false;            // solapadas

  const tol = Math.max(5, hmax * 0.9);
  const leftAligned = Math.abs(a.x - b.x) <= tol || (a.first && a.x - b.x > 0 && a.x - b.x <= hmax * 2.6);
  const centered = Math.abs(a.cx - b.cx) <= Math.max(6, 0.035 * Math.max(a.w, b.w));
  if (!leftAligned && !centered) return false;

  const cjk = CJK_RE.test(a.text) || CJK_RE.test(b.text);

  // dos lineas muy cortas suelen ser dos entradas de un menu/lista, no un parrafo
  if (!cjk && wordCount(a) <= 3 && wordCount(b) <= 3) return false;

  // soft-wrap: a debe llegar casi al margen derecho de su columna
  if (!centered || leftAligned) {
    const firstW = b.words && b.words[0] ? b.words[0].w : b.h * 3;
    const shortfall = a.colRight - a.r;
    if (shortfall > firstW + a.h * 0.9) return false;
  }
  if (cjk) return true;

  // continuidad del texto
  const aText = a.text.trim();
  const bText = b.text.trim();
  if (/-$/.test(aText) && startsLower(bText)) return true;
  if (TERMINAL_RE.test(aText) && !startsLower(bText)) return false; // fin de frase + nueva frase
  if (startsLower(bText)) return true;
  // b empieza con mayuscula/numero: solo seguimos si a parece una linea completa de parrafo
  return wordCount(a) >= 4 && a.w >= 0.85 * (a.colRight - a.colLeft);
}

function annotate(lines) {
  const L = lines.map((l, i) => ({
    ...l, i, r: l.x + l.w, b: l.y + l.h, cx: l.x + l.w / 2, cy: l.y + l.h / 2,
  }));
  for (const a of L) {
    const tol = Math.max(6, a.h * 0.8);
    let right = a.r;
    let left = a.x;
    for (const b of L) {
      if (b === a) continue;
      if (Math.abs(b.x - a.x) > tol) continue;
      if (Math.abs(b.cy - a.cy) > a.h * 10) continue;
      const ratio = b.h / a.h;
      if (ratio < 0.5 || ratio > 2) continue;
      right = Math.max(right, b.r);
      left = Math.min(left, b.x);
    }
    a.colRight = right;
    a.colLeft = left;
  }
  return L;
}

function groupParagraphs(lines) {
  const L = annotate(lines);
  const order = [...L].sort((p, q) => p.y - q.y || p.x - q.x);
  const chains = [];
  for (const ln of order) {
    let best = null;
    let bestScore = Infinity;
    for (const ch of chains) {
      const a = ch[ch.length - 1];
      a.first = ch.length === 1;
      if (!canFollow(a, ln)) continue;
      const score = Math.abs(ln.y - a.b) + Math.abs(ln.x - a.x) * 0.5;
      if (score < bestScore) { best = ch; bestScore = score; }
    }
    if (best) best.push(ln); else chains.push([ln]);
  }
  return chains;
}

function buildBlock(chain, id) {
  const x0 = Math.min(...chain.map((l) => l.x));
  const y0 = Math.min(...chain.map((l) => l.y));
  const x1 = Math.max(...chain.map((l) => l.r));
  const y1 = Math.max(...chain.map((l) => l.b));

  let text = '';
  chain.forEach((l, i) => {
    const t = l.text.trim();
    if (i === 0) { text = t; return; }
    const cjk = CJK_RE.test(text.slice(-1)) && CJK_RE.test(t[0] || '');
    if (/\w-$/.test(text) && startsLower(t)) text = text.slice(0, -1) + t;
    else text += (cjk ? '' : ' ') + t;
  });

  const heights = chain.map((l) => l.h);
  const lineH = Math.round(percentile(heights, 0.75));
  let pitch = lineH * 1.35;
  if (chain.length > 1) {
    const diffs = [];
    for (let i = 1; i < chain.length; i++) diffs.push(chain[i].cy - chain[i - 1].cy);
    pitch = median(diffs);
  }
  const allCentered = chain.length > 0 && chain.every((l) => Math.abs(l.cx - (x0 + x1) / 2) <= Math.max(6, (x1 - x0) * 0.04)) &&
    chain.some((l) => Math.abs(l.x - x0) > Math.max(6, (x1 - x0) * 0.04));

  return {
    id,
    text,
    x: x0, y: y0, w: x1 - x0, h: y1 - y0,
    lineCount: chain.length,
    lineH,
    pitch,
    align: allCentered ? 'center' : 'left',
    clipL: chain.some((l) => l.clipL),
    clipR: chain.some((l) => l.clipR),
    lines: chain.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h })),
  };
}

/** Orden de lectura: columnas de izquierda a derecha, y dentro de cada columna de arriba a abajo. */
function readingOrder(blocks) {
  if (blocks.length < 3) return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const parent = blocks.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { parent[find(i)] = find(j); };
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]; const b = blocks[j];
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlap > 0.5 * Math.min(a.w, b.w)) union(i, j);
    }
  }
  const cols = new Map();
  blocks.forEach((b, i) => {
    const k = find(i);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(b);
  });
  if (cols.size === 1) return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const ordered = [...cols.values()]
    .map((c) => ({ c: c.sort((a, b) => a.y - b.y), x: Math.min(...c.map((b) => b.x)), y: Math.min(...c.map((b) => b.y)) }));
  // Si las columnas arrancan a alturas parecidas se leen una tras otra; si no, por altura.
  ordered.sort((p, q) => p.x - q.x);
  return ordered.flatMap((o) => o.c);
}

/** Filtro de "no vale la pena traducir": codigo, URLs, rutas, correos, numeros. */
function isTranslatable(text) {
  const t = text.trim();
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 2 && !CJK_RE.test(t)) return false;
  const symbols = (t.match(/[{}()<>[\];=$#@\\|^~`_*]|=>|::/g) || []).length;
  if (t.length >= 8 && symbols / t.length > 0.11) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;
  if (/^([A-Za-z]:\\|\/|\.{1,2}\/)[\w./\\ -]*$/.test(t) && !/\s/.test(t)) return false;
  return true;
}

/**
 * Quita lo que toca el borde de la zona capturada: el texto cortado a medias se lee mal
 * ("callbac", "Introduc") y es mejor omitirlo que traducir basura.
 */
function dropClipped(lines, size) {
  if (!size || !size.width || !size.height) return lines;
  const m = 2;
  const out = [];
  for (const line of lines) {
    if (line.y < m || line.y + line.h > size.height - m) continue;
    if (!line.words || !line.words.length) {
      if (line.x >= m && line.x + line.w <= size.width - m) out.push(line);
      continue;
    }
    const words = line.words.filter((w) => w.x >= m && w.x + w.w <= size.width - m);
    if (!words.length) continue;
    if (words.length === line.words.length) { out.push(line); continue; }
    const clipL = line.words.some((w) => w.x < m);
    const clipR = line.words.some((w) => w.x + w.w > size.width - m);
    out.push({ ...line, words, text: joinWords(words), ...boxOfWords(words), clipL, clipR });
  }
  return out;
}

/**
 * @param {Array} rawLines  lineas del OCR
 * @param {{width:number,height:number}} [size] tamaño de la imagen (para descartar texto cortado en los bordes)
 * @returns {Array} bloques en orden de lectura
 */
function buildBlocks(rawLines, size) {
  const segs = [];
  for (const line of dropClipped(rawLines, size)) for (const s of splitLine(line)) if (!isNoise(s)) segs.push(s);
  const chains = groupParagraphs(segs);
  const blocks = chains.map((c, i) => buildBlock(c, i));
  const ordered = readingOrder(blocks);
  ordered.forEach((b, i) => { b.id = i; });
  return ordered;
}

module.exports = { buildBlocks, splitLine, groupParagraphs, isTranslatable, readingOrder, isNoise };

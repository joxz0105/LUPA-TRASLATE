'use strict';
/**
 * Traduccion gratuita y sin claves, con proveedores de respaldo "cubiertos" (hedged requests):
 *   1. google-batch : endpoint publico de Google Translate (varios textos por peticion, el mas rapido)
 *   2. google-gtx   : endpoint "gtx" de Google (un texto por peticion)
 *   3. mymemory     : MyMemory (cuota diaria gratuita; ultimo recurso)
 *
 * Latencia en redes lentas o con un proveedor bloqueado:
 *  - Si el proveedor preferido no responde en `hedgeMs`, se lanza el siguiente EN PARALELO y gana el primero que
 *    conteste (el resto se aborta). Si falla antes, el siguiente arranca de inmediato.
 *  - Los proveedores se ordenan por latencia reciente (EWMA) y se penalizan los que fallan (enfriamiento creciente).
 *  - Incluye cache LRU en memoria (nunca se escribe a disco: es texto de tu pantalla) y deteccion de idioma por texto.
 */

const REQUEST_TIMEOUT_MS = 5500;
const HEDGE_MS = 1400;
const CACHE_MAX = 4000;
const EWMA_ALPHA = 0.3;

function defaultFetch(url, init) {
  let net = null;
  try { ({ net } = require('electron')); } catch (_) { /* fuera de Electron */ }
  if (net && typeof net.fetch === 'function') return net.fetch(url, init);
  return fetch(url, init);
}

class HttpError extends Error {
  constructor(status, provider) {
    super(`${provider}: HTTP ${status}`);
    this.status = status;
  }
}

async function request(fetchFn, url, init, provider, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`${provider}: tiempo de espera agotado`)), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) { if (signal.aborted) ctrl.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, provider);
    return res;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };

/* ---------- proveedores: (texts[], from, to, fetchFn, signal) -> [{ text, src }] ---------- */

async function googleBatch(texts, from, to, fetchFn, signal) {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&ie=UTF-8&oe=UTF-8`;
  const body = texts.map((t) => 'q=' + encodeURIComponent(t)).join('&');
  const res = await request(fetchFn, url, { method: 'POST', headers: FORM, body }, 'google-batch', signal);
  const data = await res.json();
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('google-batch: respuesta inesperada');
  return data.map((item, i) => {
    if (Array.isArray(item)) return { text: String(item[0] ?? texts[i]), src: item[1] || from };
    return { text: String(item ?? texts[i]), src: from };
  });
}

async function googleGtx(texts, from, to, fetchFn, signal) {
  const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', dj: '1', ie: 'UTF-8', oe: 'UTF-8' });
  const url = `https://translate.googleapis.com/translate_a/single?${params}`;
  const out = [];
  for (let i = 0; i < texts.length; i += 6) {
    const part = await Promise.all(texts.slice(i, i + 6).map(async (text) => {
      const res = await request(fetchFn, url, { method: 'POST', headers: FORM, body: 'q=' + encodeURIComponent(text) }, 'google-gtx', signal);
      const j = await res.json();
      const joined = (j.sentences || []).filter((s) => s.trans != null).map((s) => s.trans).join('');
      return { text: joined || text, src: j.src || from };
    }));
    out.push(...part);
  }
  return out;
}

function splitForMyMemory(text, max = 450) {
  if (text.length <= max) return [text];
  const parts = [];
  let cur = '';
  for (const s of text.split(/(?<=[.!?。])\s+/)) {
    if ((cur + ' ' + s).trim().length > max && cur) { parts.push(cur.trim()); cur = s; } else cur = (cur + ' ' + s).trim();
  }
  if (cur) parts.push(cur.trim());
  return parts.flatMap((p) => (p.length > max ? p.match(new RegExp(`.{1,${max}}`, 'gs')) : [p]));
}

async function myMemory(texts, from, to, fetchFn, signal) {
  const pair = `${from === 'auto' ? 'Autodetect' : from}|${to}`;
  const out = [];
  for (let i = 0; i < texts.length; i += 4) {
    const part = await Promise.all(texts.slice(i, i + 4).map(async (text) => {
      const pieces = await Promise.all(splitForMyMemory(text).map(async (piece) => {
        const res = await request(fetchFn, `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${encodeURIComponent(pair)}`, {}, 'mymemory', signal);
        const j = await res.json();
        const t = j && j.responseData && j.responseData.translatedText;
        if (!t || j.responseStatus === 429 || /MYMEMORY WARNING/i.test(t)) throw new HttpError(429, 'mymemory');
        return { t, src: (j.responseData.detectedLanguage || (from === 'auto' ? 'en' : from)) };
      }));
      return { text: pieces.map((p) => p.t).join(' '), src: pieces[0].src };
    }));
    out.push(...part);
  }
  return out;
}

/** `baseline`: latencia supuesta (ms) mientras no hay mediciones; define el orden inicial. */
const PROVIDERS = [
  { name: 'google-batch', run: googleBatch, maxTexts: 24, maxChars: 7000, baseline: 300 },
  { name: 'google-gtx', run: googleGtx, maxTexts: 12, maxChars: 4500, baseline: 500 },
  { name: 'mymemory', run: myMemory, maxTexts: 6, maxChars: 2500, baseline: 1200 },
];

const baseLang = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];

class Translator {
  /**
   * @param {{ fetch?: Function, hedgeMs?: number, now?: () => number, providers?: Array }} opts
   */
  constructor({ fetch: fetchFn = defaultFetch, hedgeMs = HEDGE_MS, now = () => Date.now(), providers = PROVIDERS } = {}) {
    this.fetch = fetchFn;
    this.hedgeMs = hedgeMs;
    this.now = now;
    this.providers = providers;
    this.cache = new Map();
    this.health = new Map(providers.map((p) => [p.name, { ewma: null, fails: 0, cooldownUntil: 0, ok: 0, errors: 0, lastMs: null, lastError: null }]));
    this.lastProvider = null;
  }

  _key(text, from, to) { return `${to}\u0000${from}\u0000${text}`; }

  _remember(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }

  /** Proveedores por orden de preferencia: los sanos primero, ordenados por latencia reciente. */
  _order() {
    const t = this.now();
    const score = (p) => { const h = this.health.get(p.name); return h.ewma == null ? p.baseline : h.ewma; };
    const live = this.providers.filter((p) => this.health.get(p.name).cooldownUntil <= t).sort((a, b) => score(a) - score(b));
    const cooling = this.providers.filter((p) => this.health.get(p.name).cooldownUntil > t).sort((a, b) => this.health.get(a.name).cooldownUntil - this.health.get(b.name).cooldownUntil);
    return [...live, ...cooling];
  }

  _ok(provider, ms) {
    const h = this.health.get(provider.name);
    h.ewma = h.ewma == null ? ms : h.ewma * (1 - EWMA_ALPHA) + ms * EWMA_ALPHA;
    h.fails = 0; h.cooldownUntil = 0; h.ok++; h.lastMs = ms; h.lastError = null;
  }

  _fail(provider, err) {
    const h = this.health.get(provider.name);
    h.fails++; h.errors++; h.lastError = String(err && err.message ? err.message : err);
    const hard = err && (err.status === 429 || err.status === 403);
    const wait = hard ? 60000 : Math.min(45000, 4000 * 2 ** (h.fails - 1));
    h.cooldownUntil = this.now() + wait;
  }

  /** Ejecuta un proveedor sobre todos los textos (en lotes segun sus limites). */
  async _runProvider(provider, texts, from, to, signal) {
    const batches = [];
    let batch = [];
    let chars = 0;
    for (const t of texts) {
      if (batch.length >= provider.maxTexts || chars + t.length > provider.maxChars) { batches.push(batch); batch = []; chars = 0; }
      batch.push(t); chars += t.length;
    }
    if (batch.length) batches.push(batch);
    const parts = await Promise.all(batches.map((b) => provider.run(b, from, to, this.fetch, signal)));
    return parts.flat();
  }

  /**
   * Traduce `texts` probando proveedores de forma "cubierta". Devuelve { results, provider, hedged, ms }.
   */
  _hedged(texts, from, to) {
    const order = this._order();
    const controllers = [];
    const errors = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      let launched = 0;
      let failed = 0;
      let timer = null;
      const t00 = this.now();

      const launch = () => {
        if (settled || launched >= order.length) return false;
        const provider = order[launched++];
        const ctrl = new AbortController();
        controllers.push(ctrl);
        const t0 = this.now();
        this._runProvider(provider, texts, from, to, ctrl.signal).then((results) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this._ok(provider, this.now() - t0);
          for (const c of controllers) if (c !== ctrl) c.abort(new Error('cancelado: otro proveedor respondio antes'));
          resolve({ results, provider: provider.name, hedged: launched > 1, ms: this.now() - t00 });
        }, (err) => {
          if (settled) return;
          if (ctrl.signal.aborted && /cancelado/.test(String(ctrl.signal.reason && ctrl.signal.reason.message))) return;
          this._fail(provider, err);
          errors.push(err);
          failed++;
          clearTimeout(timer);
          if (!launch() && failed >= launched) {
            settled = true;
            const e = new Error(errors.map((x) => (x && x.message) || String(x)).join(' | ') || 'No se pudo traducir');
            e.code = 'TRANSLATE_FAILED';
            reject(e);
          }
        });
        clearTimeout(timer);
        if (launched < order.length) timer = setTimeout(launch, this.hedgeMs);
        return true;
      };
      launch();
    });
  }

  /**
   * @param {string[]} texts
   * @returns {Promise<{ items: Array<{text:string, src:string, same:boolean}>, stats: object }>}
   */
  async translateDetailed(texts, { from = 'auto', to = 'es' } = {}) {
    const t0 = this.now();
    const clean = texts.map((t) => String(t).replace(/\s+/g, ' ').trim());
    const misses = [...new Set(clean.filter((t) => t && !this.cache.has(this._key(t, from, to))))];
    const stats = { ms: 0, provider: null, hedged: false, requested: misses.length, cached: clean.filter(Boolean).length - misses.length };

    if (misses.length) {
      const r = await this._hedged(misses, from, to);
      misses.forEach((t, i) => this._remember(this._key(t, from, to), r.results[i]));
      this.lastProvider = r.provider;
      stats.provider = r.provider;
      stats.hedged = r.hedged;
      stats.networkMs = r.ms;
    }

    const items = clean.map((t) => {
      if (!t) return { text: '', src: from, same: true };
      const hit = this.cache.get(this._key(t, from, to));
      const src = (hit && hit.src) || from;
      const same = baseLang(src) === baseLang(to) && baseLang(to) !== '';
      return { text: hit ? hit.text : t, src, same };
    });
    stats.ms = this.now() - t0;
    return { items, stats };
  }

  /** Version simple: solo la lista de resultados. */
  async translate(texts, opts) {
    return (await this.translateDetailed(texts, opts)).items;
  }

  /** Estado de salud de los proveedores (para el diagnostico). */
  health_report() {
    return this.providers.map((p) => ({ name: p.name, ...this.health.get(p.name) }));
  }

  /** Mide un proveedor concreto (diagnostico): devuelve ms o lanza. */
  async probe(name, text = 'Hello world') {
    const p = this.providers.find((x) => x.name === name);
    if (!p) throw new Error('proveedor desconocido');
    const t0 = this.now();
    await p.run([text], 'auto', 'es', this.fetch, undefined);
    return this.now() - t0;
  }

  clear() { this.cache.clear(); }
}

module.exports = { Translator, googleBatch, googleGtx, myMemory, splitForMyMemory, PROVIDERS, HEDGE_MS, REQUEST_TIMEOUT_MS };

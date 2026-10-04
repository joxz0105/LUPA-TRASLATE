'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Translator, splitForMyMemory } = require('../src/main/translate');

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

/** fetch simulado: responde segun la URL */
function fakeFetch(handlers, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body });
    for (const [match, fn] of handlers) if (String(url).includes(match)) return fn(String(url), init);
    throw new Error('sin manejador para ' + url);
  };
}

const batchOk = (map) => async (_url, init) => {
  const qs = new URLSearchParams(init.body).getAll('q');
  return json(qs.map((q) => map[q] || [`ES:${q}`, 'en']));
};

test('traduce por lotes y devuelve el idioma detectado de cada texto', async () => {
  const calls = [];
  const t = new Translator({ fetch: fakeFetch([['clients5.google.com', batchOk({ 'Hola amigos': ['Hola amigos', 'es'] })]], calls) });
  const out = await t.translate(['Hello world', 'Hola amigos', 'Good morning']);
  assert.equal(calls.length, 1, 'una sola peticion para todo el lote');
  assert.deepEqual(out.map((o) => o.text), ['ES:Hello world', 'Hola amigos', 'ES:Good morning']);
  assert.deepEqual(out.map((o) => o.same), [false, true, false]);
});

test('cache: no vuelve a pedir lo ya traducido y deduplica', async () => {
  const calls = [];
  const t = new Translator({ fetch: fakeFetch([['clients5.google.com', batchOk({})]], calls) });
  await t.translate(['One', 'Two', 'One']);
  assert.equal(new URLSearchParams(calls[0].body).getAll('q').length, 2, 'dedup dentro del lote');
  await t.translate(['One', 'Two']);
  assert.equal(calls.length, 1, 'segunda vez todo sale de la cache');
});

test('normaliza espacios y respeta el orden', async () => {
  const t = new Translator({ fetch: fakeFetch([['clients5.google.com', batchOk({})]]) });
  const out = await t.translate(['  Hello   there \n friend ', '', 'Bye']);
  assert.equal(out[0].text, 'ES:Hello there friend');
  assert.equal(out[1].text, '');
  assert.equal(out[2].text, 'ES:Bye');
});

test('si el proveedor principal falla, usa el siguiente', async () => {
  const calls = [];
  const t = new Translator({
    fetch: fakeFetch([
      ['clients5.google.com', async () => json({}, 503)],
      ['translate.googleapis.com', async (_u, init) => json({ src: 'en', sentences: [{ trans: 'GTX:' + decodeURIComponent(init.body.slice(2)) }] })],
    ], calls),
  });
  const out = await t.translate(['Hello']);
  assert.equal(out[0].text, 'GTX:Hello');
  assert.equal(t.lastProvider, 'google-gtx');
  // el primero queda en enfriamiento: la siguiente tanda ni lo intenta
  await t.translate(['Another one']);
  assert.equal(calls.filter((c) => c.url.includes('clients5')).length, 1);
});

test('si todos fallan, lanza TRANSLATE_FAILED', async () => {
  const t = new Translator({ fetch: fakeFetch([['', async () => { throw new Error('offline'); }]]) });
  await assert.rejects(() => t.translate(['Hello']), (e) => e.code === 'TRANSLATE_FAILED');
});

test('MyMemory como ultimo recurso', async () => {
  const t = new Translator({
    fetch: fakeFetch([
      ['clients5.google.com', async () => json({}, 429)],
      ['translate.googleapis.com', async () => json({}, 429)],
      ['mymemory', async (url) => json({ responseStatus: 200, responseData: { translatedText: 'MM:' + new URL(url).searchParams.get('q'), detectedLanguage: 'en' } })],
    ]),
  });
  const out = await t.translate(['Hello']);
  assert.equal(out[0].text, 'MM:Hello');
});

test('el destino distinto del español no marca "same" por error', async () => {
  const t = new Translator({ fetch: fakeFetch([['clients5.google.com', batchOk({ 'Hola': ['Hello', 'es'] })]]) });
  const out = await t.translate(['Hola'], { to: 'en' });
  assert.equal(out[0].same, false);
});

test('splitForMyMemory parte textos largos sin perder contenido', () => {
  const text = ('Sentence number one is here. ').repeat(40).trim();
  const parts = splitForMyMemory(text, 120);
  assert.ok(parts.length > 5);
  assert.ok(parts.every((p) => p.length <= 120));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text);
});

/* ---------- peticiones cubiertas (hedged) y orden por latencia ---------- */

const abortable = (ms, value, signalSink) => (_url, init) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(value), ms);
  if (signalSink) signalSink.signals.push(init.signal);
  if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason || new Error('abortado')); }, { once: true });
});

test('hedged: si el primero tarda, el segundo arranca a tiempo y gana; el lento se aborta', async () => {
  const sink = { signals: [] };
  const t = new Translator({
    hedgeMs: 40,
    fetch: fakeFetch([
      ['clients5.google.com', abortable(1500, json([['LENTO', 'en']]), sink)],
      ['translate.googleapis.com', abortable(10, json({ src: 'en', sentences: [{ trans: 'RAPIDO' }] }), sink)],
    ]),
  });
  const t0 = Date.now();
  const out = await t.translate(['Hello']);
  assert.equal(out[0].text, 'RAPIDO');
  assert.ok(Date.now() - t0 < 600, 'no debe esperar al lento');
  assert.equal(t.lastProvider, 'google-gtx');
  assert.equal(sink.signals[0].aborted, true, 'la peticion lenta se cancela');
});

test('si el primero falla rapido, el siguiente arranca de inmediato (sin esperar al hedge)', async () => {
  const t = new Translator({
    hedgeMs: 5000,
    fetch: fakeFetch([
      ['clients5.google.com', async () => json({}, 500)],
      ['translate.googleapis.com', async () => json({ src: 'en', sentences: [{ trans: 'OK' }] })],
    ]),
  });
  const t0 = Date.now();
  const out = await t.translate(['Hello']);
  assert.equal(out[0].text, 'OK');
  assert.ok(Date.now() - t0 < 500);
});

test('los proveedores se ordenan por latencia reciente (EWMA)', async () => {
  let clock = 0;
  const t = new Translator({
    now: () => clock,
    fetch: fakeFetch([
      ['clients5.google.com', async () => { clock += 900; return json([['A', 'en']]); }],
      ['translate.googleapis.com', async () => { clock += 60; return json({ src: 'en', sentences: [{ trans: 'B' }] }); }],
    ]),
  });
  await t.translate(['one']);              // google-batch (baseline 300): tarda 900
  assert.ok(t.health.get('google-batch').ewma >= 900);
  t.health.get('google-gtx').ewma = 100;   // medicion previa de gtx: mucho mas rapido
  assert.equal(t._order()[0].name, 'google-gtx');
});

test('translateDetailed informa cache, proveedor y latencia', async () => {
  const t = new Translator({ fetch: fakeFetch([['clients5.google.com', batchOk({})]]) });
  const a = await t.translateDetailed(['One', 'Two']);
  assert.equal(a.stats.provider, 'google-batch');
  assert.equal(a.stats.requested, 2);
  assert.equal(a.stats.cached, 0);
  const b = await t.translateDetailed(['One', 'Two', 'Three']);
  assert.equal(b.stats.cached, 2);
  assert.equal(b.stats.requested, 1);
});

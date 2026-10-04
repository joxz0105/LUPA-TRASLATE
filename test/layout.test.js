'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBlocks, splitLine, isTranslatable } = require('../src/main/ocr/layout');
const article = require('./fixtures/article.ocr.json');

const texts = (blocks) => blocks.map((b) => b.text);

test('splitLine separa menus con huecos grandes y quita vinetas', () => {
  const segs = splitLine({
    text: '• Hola mundo', x: 0, y: 0, w: 300, h: 14,
    words: [{ t: '•', x: 0, y: 0, w: 6, h: 14 }, { t: 'Hola', x: 20, y: 0, w: 40, h: 14 }, { t: 'mundo', x: 66, y: 0, w: 50, h: 14 }, { t: 'Precios', x: 200, y: 0, w: 60, h: 14 }],
  });
  assert.deepEqual(segs.map((s) => s.text), ['Hola mundo', 'Precios']);
});

test('articulo real: los parrafos se agrupan y las listas/menus no se funden', () => {
  const blocks = buildBlocks(article);
  const t = texts(blocks);
  const has = (s) => t.some((x) => x.includes(s));

  // parrafo de 3 lineas -> 1 bloque
  const p1 = blocks.find((b) => b.text.startsWith('Asynchronous programming allows'));
  assert.ok(p1, 'falta el primer parrafo');
  assert.equal(p1.lineCount, 3);
  assert.ok(p1.text.endsWith('has finished.'));

  const p2 = blocks.find((b) => b.text.startsWith('Many functions provided'));
  assert.equal(p2.lineCount, 3);

  // titulo aparte del parrafo
  assert.ok(t.includes('Understanding asynchronous programming'));
  assert.ok(t.includes('Why it matters for modern applications'));

  // cada elemento de la lista es un bloque independiente
  assert.ok(t.includes('Fetch data from a remote server without freezing the page.'));
  assert.ok(t.includes('Read large files in the background.'));
  assert.ok(t.includes('Handle user input while work continues.'));

  // menu lateral: ningun bloque junta dos entradas
  for (const entry of ['Introduction', 'Callbacks and promises', 'Common mistakes', 'Further reading']) {
    assert.ok(has(entry), 'falta ' + entry);
  }
  assert.ok(!t.some((x) => x.includes('Introduction Callbacks')), 'menu fundido');
  assert.ok(!t.some((x) => x.includes('Callbacks and promises') && x.includes('Using')), 'menu fundido (2)');

  // la barra superior separa "Community" y "Pricing"
  assert.ok(t.includes('Community') && t.includes('Pricing'));

  // parrafo con codigo en linea sigue siendo uno solo
  const p3 = blocks.find((b) => b.text.startsWith('Please install the latest version'));
  assert.equal(p3.lineCount, 2);
});

test('orden de lectura: columna principal completa antes que la lateral', () => {
  const blocks = buildBlocks(article);
  const idx = (s) => blocks.findIndex((b) => b.text.startsWith(s));
  assert.ok(idx('Understanding') < idx('Asynchronous programming'));
  assert.ok(idx('Please install') < idx('On this page'));
});

test('isTranslatable descarta codigo, urls y numeros', () => {
  assert.equal(isTranslatable('const data = await fetch(url);'), false);
  assert.equal(isTranslatable('https://example.com/docs/page'), false);
  assert.equal(isTranslatable('2024'), false);
  assert.equal(isTranslatable('Download the documentation'), true);
  assert.equal(isTranslatable('Hello world'), true);
});

test('texto cortado por el borde de la captura se descarta', () => {
  const lines = [
    { text: 'Hello world today', x: 10, y: 20, w: 120, h: 14, words: [
      { t: 'Hello', x: 10, y: 20, w: 40, h: 14 }, { t: 'world', x: 56, y: 20, w: 40, h: 14 }, { t: 'toda', x: 102, y: 20, w: 28, h: 14 } ] },
  ];
  // la captura mide 130 px de ancho: "toda" termina en 130 => está cortada
  const blocks = buildBlocks(lines, { width: 130, height: 100 });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Hello world');
  // una línea pegada al borde superior se descarta entera
  assert.equal(buildBlocks([{ text: 'Cut line', x: 10, y: 0, w: 50, h: 8, words: [{ t: 'Cut', x: 10, y: 0, w: 20, h: 8 }, { t: 'line', x: 34, y: 0, w: 26, h: 8 }] }], { width: 200, height: 100 }).length, 0);
});

test('las lineas recortadas por el borde marcan el bloque (clipR) para que el parche llegue al borde', () => {
  const lines = [{ text: 'Hello world toda', x: 10, y: 20, w: 120, h: 14, words: [
    { t: 'Hello', x: 10, y: 20, w: 40, h: 14 }, { t: 'world', x: 56, y: 20, w: 40, h: 14 }, { t: 'toda', x: 102, y: 20, w: 28, h: 14 }] }];
  const [b] = buildBlocks(lines, { width: 130, height: 100 });
  assert.equal(b.clipR, true);
  assert.equal(b.clipL, false);
});

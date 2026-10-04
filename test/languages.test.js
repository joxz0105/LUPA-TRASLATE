'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickWindowsEngine, pickWindowsTag } = require('../src/main/languages');

const es = ['es-ES', 'es-MX'];

test('con el OCR del propio idioma instalado se usa ese (exacto)', () => {
  assert.deepEqual(pickWindowsEngine('en', ['en-US', 'es-ES']), { tag: 'en-US', exact: true });
  assert.deepEqual(pickWindowsEngine('de', ['de-DE', 'en-US']), { tag: 'de-DE', exact: true });
});

test('sin OCR de inglés, el motor en español lo sustituye (rápido) en vez de caer a Tesseract', () => {
  assert.deepEqual(pickWindowsEngine('en', es), { tag: 'es-ES', exact: false });
  assert.deepEqual(pickWindowsEngine('auto', es), { tag: 'es-ES', exact: false });
});

test('portugués e italiano prefieren el motor en español; alemán y francés prefieren el inglés', () => {
  assert.equal(pickWindowsEngine('pt', ['en-US', 'es-ES']).tag, 'es-ES');
  assert.equal(pickWindowsEngine('it', ['en-US', 'es-ES']).tag, 'es-ES');
  assert.equal(pickWindowsEngine('de', ['en-US', 'es-ES']).tag, 'en-US');
  assert.equal(pickWindowsEngine('fr', ['en-US', 'es-ES']).tag, 'en-US');
});

test('idiomas no latinos o mal cubiertos por el sustituto no lo usan (mejor Tesseract)', () => {
  for (const code of ['ru', 'ja', 'zh-CN', 'ko', 'ar', 'pl', 'tr']) assert.equal(pickWindowsEngine(code, es), null, code);
});

test('pickWindowsTag solo devuelve motores propios del idioma', () => {
  assert.equal(pickWindowsTag('en', es), null);
  assert.equal(pickWindowsTag('en', ['en-GB']), 'en-GB');
  assert.equal(pickWindowsTag('zh-CN', ['zh-Hans-CN']), 'zh-Hans-CN');
});

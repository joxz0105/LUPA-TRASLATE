// node test/tess-smoke.js <png> [tessLangs]
const fs = require('fs'); const path = require('path'); const os = require('os');
const { TesseractOcr } = require('../src/main/ocr/tesseract-ocr');
const { buildBlocks, isTranslatable } = require('../src/main/ocr/layout');
(async () => {
  const png = fs.readFileSync(path.resolve(process.argv[2] || 'test/fixtures/article.png'));
  const langs = process.argv[3] || 'eng';
  const t = new TesseractOcr({ langDir: path.join(os.tmpdir(), 'lupa-tessdata-test'), onStatus: (m) => m && console.log('status:', m) });
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await t.recognize(png, langs, 1);
    console.log(`run ${i}: ${Date.now() - t0} ms total, ocr ${r.ms} ms, ${r.lines.length} lines`);
    if (i === 0) for (const b of buildBlocks(r.lines)) console.log(`  L${b.lineCount} ${isTranslatable(b.text) ? ' ' : 'x'} ${JSON.stringify(b.text.slice(0, 100))}`);
  }
  await t.stop();
})().catch((e) => { console.error('ERR', e); process.exit(1); });

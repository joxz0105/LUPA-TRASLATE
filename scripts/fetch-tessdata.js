// Descarga los datos de Tesseract que viajan dentro de la app (inglés, ~3 MB).
// Uso: npm run tessdata
const fs = require('fs');
const path = require('path');

const LANGS = ['eng'];
const OUT = path.join(__dirname, '..', 'assets', 'tessdata');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const l of LANGS) {
    const file = path.join(OUT, `${l}.traineddata.gz`);
    if (fs.existsSync(file) && fs.statSync(file).size > 100000) { console.log('ya existe', file); continue; }
    const res = await fetch(`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${l}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('descargado', file);
  }
})().catch((e) => { console.error(e); process.exit(1); });

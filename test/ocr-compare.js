// Compara motores de OCR de Windows sobre el mismo PNG: node test/ocr-compare.js <png> <tag1> <tag2> ...
const { spawn } = require('child_process'); const path = require('path'); const readline = require('readline');
const png = path.resolve(process.argv[2]); const tags = process.argv.slice(3);
const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src/main/ocr/windows-ocr.ps1')], { windowsHide: true });
const results = {}; let n = 0; const queue = [];
const rl = readline.createInterface({ input: ps.stdout });
const text = (lines) => lines.map((l) => l.text).join('\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.ready) { console.log('idiomas OCR instalados:', m.langs.join(', ')); for (const t of tags) for (let i = 0; i < 3; i++) queue.push(t); next(); return; }
  const tag = m.tag; results[tag] = results[tag] || { ms: [], text: null };
  results[tag].ms.push(m.ms); if (m.ok && !results[tag].text) results[tag].text = text(m.lines);
  next();
});
let cur = null;
function next() {
  if (!queue.length) { ps.stdin.end(); report(); return; }
  cur = queue.shift();
  ps.stdin.write(JSON.stringify({ id: ++n, cmd: 'ocr', path: png, lang: cur }) + '\n');
  const orig = rl.listeners('line')[0];
}
// asociar la respuesta con la etiqueta enviada
const origWrite = ps.stdin.write.bind(ps.stdin);
ps.stdin.write = (s, ...r) => { try { const q = JSON.parse(s); pending[q.id] = q.lang; } catch (_) {} return origWrite(s, ...r); };
const pending = {};
rl.removeAllListeners('line');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.ready) { console.log('idiomas OCR instalados:', m.langs.join(', ')); for (const t of tags) for (let i = 0; i < 3; i++) queue.push(t); next(); return; }
  const tag = pending[m.id]; results[tag] = results[tag] || { ms: [], text: null };
  results[tag].ms.push(m.ms); if (m.ok && !results[tag].text) results[tag].text = text(m.lines); if (!m.ok) results[tag].err = m.error;
  next();
});
function report() {
  const base = results[tags[0]] && results[tags[0]].text ? results[tags[0]].text : '';
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const baseWords = norm(base);
  for (const t of tags) {
    const r = results[t]; if (!r) continue;
    if (r.err) { console.log(`${t}: ERROR ${r.err}`); continue; }
    const w = norm(r.text || ''); const set = new Set(baseWords);
    const common = w.filter((x) => set.has(x)).length;
    console.log(`${t}: ms=[${r.ms.join(', ')}] palabras=${w.length} coincidencia con ${tags[0]}=${(100 * common / Math.max(1, baseWords.length)).toFixed(1)}%`);
  }
  console.log('\n--- muestra (' + tags[tags.length - 1] + ') ---\n' + (results[tags[tags.length - 1]].text || '').split('\n').slice(0, 14).join('\n'));
}

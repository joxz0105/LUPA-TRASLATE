// Precisión de palabras de motores OCR de Windows frente al texto real: node test/ocr-accuracy.js <png> <verdad.txt> <tag...>
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const readline = require('readline');
const png = path.resolve(process.argv[2]); const truthFile = process.argv[3]; const tags = process.argv.slice(4);
const norm = (s) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
const truthLines = fs.readFileSync(truthFile, 'utf8').split(/\r?\n/);
const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src/main/ocr/windows-ocr.ps1')], { windowsHide: true });
const rl = readline.createInterface({ input: ps.stdout }); const pending = {}; const queue = [...tags]; let id = 0; const out = {};
const send = () => { if (!queue.length) { ps.stdin.end(); report(); return; } const t = queue.shift(); pending[++id] = t; ps.stdin.write(JSON.stringify({ id, cmd: 'ocr', path: png, lang: t }) + '\n'); };
rl.on('line', (l) => { const m = JSON.parse(l); if (m.ready) { console.log('instalados:', m.langs.join(', ')); send(); return; } out[pending[m.id]] = m; send(); });
function report() {
  const sections = []; let cur = null;
  for (const line of truthLines) { if (!line.trim()) continue; if (line.length < 14) { cur = { name: line.trim(), words: [] }; sections.push(cur); } else if (cur) cur.words.push(...norm(line)); }
  for (const t of tags) {
    const m = out[t]; if (!m || !m.ok) { console.log(t, 'ERROR', m && m.error); continue; }
    const ocrWords = norm(m.lines.map((x) => x.text).join(' ')); const bag = new Map(); for (const w of ocrWords) bag.set(w, (bag.get(w) || 0) + 1);
    const parts = sections.map((s) => { let ok = 0; const b = new Map(bag); for (const w of s.words) if ((b.get(w) || 0) > 0) { ok++; b.set(w, b.get(w) - 1); } return `${s.name}:${(100 * ok / s.words.length).toFixed(0)}%`; });
    console.log(`${t.padEnd(6)} ${m.ms}ms  ${parts.join('  ')}`);
  }
}

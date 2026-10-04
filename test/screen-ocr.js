// node test/screen-ocr.js x y w h [lang] [needle]  -> captura GDI + OCR del helper, muestra tiempos y líneas
const { spawn } = require('child_process'); const path = require('path'); const readline = require('readline');
const [x, y, w, h] = process.argv.slice(2, 6).map(Number); const lang = process.argv[6] || 'en-US'; const needle = process.argv[7] || '';
const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src/main/ocr/windows-ocr.ps1')], { windowsHide: true });
ps.stderr.on('data', d => process.stderr.write('[stderr] ' + d));
let n = 0, sent = 0;
const send = () => { sent = Date.now(); ps.stdin.write(JSON.stringify({ id: ++n, cmd: 'ocr-screen', x, y, w, h, lang, save: path.join(require('os').tmpdir(), 'screen-ocr.png') }) + '\n'); };
readline.createInterface({ input: ps.stdout }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.ready) { console.log('ready; screen=', m.screen); send(); return; }
  console.log(`#${m.id} ok=${m.ok} total=${Date.now() - sent}ms helper=${m.ms}ms capture=${m.captureMs}ms size=${m.w}x${m.h}`, m.error || '');
  if (m.id === 1 && m.ok) for (const ln of m.lines) if (!needle || ln.text.includes(needle)) console.log('  ', ln.text.slice(0, 120));
  if (n < 4) send(); else ps.stdin.end();
});

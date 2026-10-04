// Prueba manual del helper de OCR de Windows: node test/ocr-smoke.js <png> [lang]
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const png = path.resolve(process.argv[2] || 'test/fixtures/article.png');
const lang = process.argv[3] || 'en-US';
const t0 = Date.now();
const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src/main/ocr/windows-ocr.ps1')], { windowsHide: true });
ps.stderr.on('data', d => process.stderr.write('[stderr] ' + d));
const rl = readline.createInterface({ input: ps.stdout });
let n = 0;
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.ready) {
    console.log('ready after', Date.now() - t0, 'ms; langs:', msg.langs.join(','), 'maxDim', msg.maxDim);
    send();
  } else {
    console.log(`request ${msg.id}: ok=${msg.ok} ms=${msg.ms} roundtrip=${Date.now() - sentAt}ms`, msg.error || '');
    if (msg.ok && msg.id === 1) for (const l of msg.lines) console.log(`  [${l.x},${l.y},${l.w},${l.h}] ${l.text}`);
    if (++n < 3) send(); else { ps.stdin.end(); }
  }
});
let sentAt = 0;
function send() { sentAt = Date.now(); ps.stdin.write(JSON.stringify({ id: n + 1, path: png, lang }) + '\n'); }

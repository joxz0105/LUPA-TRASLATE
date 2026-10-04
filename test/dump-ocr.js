// Genera un fixture JSON con la salida cruda del OCR de Windows: node test/dump-ocr.js <png> <out.json> [lang]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const [png, out, lang = 'en-US'] = [path.resolve(process.argv[2]), path.resolve(process.argv[3]), process.argv[4]];
const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'src/main/ocr/windows-ocr.ps1')], { windowsHide: true });
readline.createInterface({ input: ps.stdout }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.ready) ps.stdin.write(JSON.stringify({ id: 1, path: png, lang }) + '\n');
  else { fs.writeFileSync(out, JSON.stringify(m.lines, null, 1)); console.log('written', out, m.lines.length, 'lines'); ps.stdin.end(); }
});

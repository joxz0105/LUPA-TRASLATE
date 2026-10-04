// Genera assets/icon.png, assets/tray.png y assets/icon.ico a partir de un SVG.
// Uso:  npm run icons   (usa el propio Electron para rasterizar, sin dependencias extra)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#232b52"/><stop offset="1" stop-color="#0a0e1e"/>
    </linearGradient>
    <linearGradient id="ring" x1="90" y1="90" x2="430" y2="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#79a6ff"/><stop offset="1" stop-color="#b79bff"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="3"/>
  <circle cx="226" cy="226" r="126" fill="#79a6ff" fill-opacity=".12" stroke="url(#ring)" stroke-width="32"/>
  <path d="M322 322 L424 424" stroke="url(#ring)" stroke-width="46" stroke-linecap="round"/>
  <path d="M168 202h116M168 246h78" stroke="#eaf0ff" stroke-width="24" stroke-linecap="round"/>
</svg>`;

function buildIco(pngs) {
  // ICO con imágenes PNG incrustadas (válido desde Windows Vista)
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, o);
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1);
    entries.writeUInt8(0, o + 2); entries.writeUInt8(0, o + 3);
    entries.writeUInt16LE(1, o + 4); entries.writeUInt16LE(32, o + 6);
    entries.writeUInt32LE(buf.length, o + 8); entries.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, entries, ...pngs.map((p) => p.buf)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.mkdirSync(ASSETS, { recursive: true });
  const at = (size) => full.resize({ width: size, height: size, quality: 'best' });

  fs.writeFileSync(path.join(ASSETS, 'icon.png'), at(256).toPNG());
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), at(32).toPNG());
  fs.writeFileSync(path.join(ASSETS, 'icon.svg'), SVG);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(sizes.map((size) => ({ size, buf: at(size).toPNG() }))));
  console.log('Iconos generados en', ASSETS);
  app.quit();
});

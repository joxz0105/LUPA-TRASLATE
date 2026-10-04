// Renderiza una página HTML a PNG (ventana oculta, sin tocar el escritorio) y guarda su texto como "verdad".
//   electron test/render-fixture.js <entrada.html> <salida.png> [ancho] [alto]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os');
app.setPath('userData', path.join(os.tmpdir(), 'lupa-render-profile'));
app.disableHardwareAcceleration();
const [input, output, w = '1000', h = '700'] = process.argv.slice(2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Number(w), height: Number(h), webPreferences: { offscreen: true }, backgroundColor: '#ffffff' });
  await win.loadFile(path.resolve(input));
  await new Promise((r) => setTimeout(r, 600));
  const truth = await win.webContents.executeJavaScript('document.body.innerText');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(output, img.toPNG());
  fs.writeFileSync(output.replace(/\.png$/, '.txt'), truth);
  console.log('ok', output, img.getSize());
  app.quit();
});

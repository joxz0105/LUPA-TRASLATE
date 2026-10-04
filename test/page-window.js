// Ventana Electron que muestra una página de prueba (sin cuentas ni diálogos, a diferencia de un navegador real).
//   electron test/page-window.js [archivo.html] [x] [y] [ancho] [alto]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');

app.commandLine.appendSwitch('remote-debugging-port', '9444');
app.setPath('userData', path.join(os.tmpdir(), 'lupa-testpage-profile'));
const [file, x, y, w, h] = process.argv.slice(2);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: Number(x ?? 0), y: Number(y ?? 0), width: Number(w ?? 1100), height: Number(h ?? 760),
    title: 'Lupa — página de prueba', autoHideMenuBar: true, backgroundColor: '#ffffff', alwaysOnTop: true,
  });
  win.loadFile(path.resolve(file || path.join(__dirname, 'fixtures', 'article.html')));
});
app.on('window-all-closed', () => app.quit());

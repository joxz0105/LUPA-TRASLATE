'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  app, BrowserWindow, ipcMain, screen, desktopCapturer, session, Tray, Menu, nativeImage, globalShortcut, dialog,
} = require('electron');

const { Settings } = require('./settings');
const { Dragger, clampToScreens } = require('./window-drag');
const { OcrService } = require('./ocr');
const { Translator } = require('./translate');
const { SOURCE_LANGS, TARGET_LANGS } = require('./languages');

const DEBUG = !!process.env.LUPA_DEBUG;
const MIN_W = 400;
const MIN_H = 200;
const ROOT = path.join(__dirname, '..', '..');
const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(ROOT, 'assets');

// La ventana vive encima de todo y casi nunca tiene el foco: que Chromium no la "duerma".
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
if (process.env.LUPA_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.LUPA_DEBUG_PORT);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let tray = null;
let settings = null;
let ocr = null;
let dragger = null;
const translator = new Translator();
let quitting = false;
let lensVisible = false;   // la lente se oculta con opacidad 0 (ver setLensVisible), no con win.hide()

const log = (...a) => { if (DEBUG) console.log('[lupa]', ...a); };

/** nativeImage.createFromPath no lee dentro de app.asar; con un buffer funciona siempre. */
function loadImage(name) {
  try { return nativeImage.createFromBuffer(fs.readFileSync(path.join(ROOT, 'assets', name))); } catch (_) { return nativeImage.createEmpty(); }
}

/* ------------------------------------------------------------------ ventana */

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(820, Math.round(wa.width * 0.55));
  const height = Math.min(480, Math.round(wa.height * 0.5));
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
}

function currentState() {
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  return { bounds: b, display: { id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor } };
}

let stateTimer = null;
function pushState() {
  if (stateTimer || !win || win.isDestroyed()) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('win:state', currentState());
  }, 16);
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  settings.patch({ bounds: win.getBounds() });
}

function applyWindowSettings() {
  const s = settings.get();
  win.setAlwaysOnTop(s.alwaysOnTop, s.alwaysOnTop ? 'screen-saver' : 'normal');
}

function createWindow() {
  const stored = settings.get().bounds;
  const bounds = clampToScreens({ ...defaultBounds(), ...(stored || {}) });
  bounds.width = Math.max(MIN_W, bounds.width);
  bounds.height = Math.max(MIN_H, bounds.height);

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: true,
    resizable: false,        // el redimensionado lo hace Dragger (las ventanas transparentes no tienen bordes nativos)
    hasShadow: false,
    show: false,
    skipTaskbar: false,
    focusable: false,        // la lente no le roba el foco a la aplicación que estás leyendo
    title: 'Lupa',
    icon: loadImage('icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // La ventana no sale en las capturas de pantalla: asi el OCR ve el texto original que hay debajo.
  if (!process.env.LUPA_VISIBLE) win.setContentProtection(true);
  applyWindowSettings();
  win.setMenuBarVisibility(false);

  dragger = new Dragger(win, { minWidth: MIN_W, minHeight: MIN_H, onEnd: () => { saveBounds(); pushState(); } });

  win.on('move', pushState);
  win.on('resize', () => { log('resize', JSON.stringify(win.getBounds())); pushState(); });
  win.on('closed', () => { win = null; });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); setLensVisible(false); } });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.on('console-message', (e) => {
    if (DEBUG) log('renderer:', e.message);
  });

  log('create bounds', JSON.stringify(bounds), 'actual', JSON.stringify(win.getBounds()));
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); lensVisible = true; win.webContents.send('win:visible', true); updateTray(); });
}

/**
 * Mostrar/ocultar la lente SIN usar win.hide()/showInactive(): en una ventana transparente, sin foco y con
 * clic-a-través, Windows/Chromium dejan de entregarle clics tras un hide()+show() (no se podía mover ni
 * usar). En su lugar: opacidad 0, ignorar el ratón y salir de la barra de tareas; mostrar lo revierte.
 */
function setLensVisible(show) {
  if (!win || win.isDestroyed()) return;
  if (show === lensVisible) { updateTray(); return; }
  lensVisible = show;
  if (show) {
    win.setOpacity(1);
    win.setSkipTaskbar(false);
    applyWindowSettings();      // vuelve a afirmar "siempre al frente"
    win.moveTop();
  } else {
    win.setIgnoreMouseEvents(true);   // sin "forward": oculta no debe interceptar nada
    win.setOpacity(0);
    win.setSkipTaskbar(true);
  }
  win.webContents.send('win:visible', show);
  updateTray();
}

function toggleVisible(force) {
  setLensVisible(typeof force === 'boolean' ? force : !lensVisible);
}

/* --------------------------------------------------------------- ajustes/IPC */

function broadcastSettings() {
  if (win && !win.isDestroyed()) win.webContents.send('settings', settings.get());
  updateTray();
}

function sendCommand(type, extra) {
  if (win && !win.isDestroyed()) win.webContents.send('command', { type, ...extra });
}

function patchSettings(patch) {
  const next = settings.patch(patch);
  if ('alwaysOnTop' in patch && win) applyWindowSettings();
  return next;
}

function setupIpc() {
  ipcMain.handle('app:init', () => ({
    settings: settings.get(),
    state: currentState(),
    languages: { source: SOURCE_LANGS.map(({ code, label }) => ({ code, label })), target: TARGET_LANGS },
    version: app.getVersion(),
    debug: DEBUG,
    ocr: ocr.status(),
    shortcuts: activeShortcuts,
  }));

  ipcMain.handle('ocr:status', () => ocr.status());

  ipcMain.handle('settings:patch', (_e, patch) => {
    const next = patchSettings(patch || {});
    if (patch && (patch.sourceLang || patch.targetLang)) translator.clear();
    updateTray();
    return next;
  });

  ipcMain.handle('capture:source', async () => {
    const d = screen.getDisplayMatching(win.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
    return src ? { id: src.id, displayId: String(d.id) } : null;
  });

  // Con "Detectar idioma", el renderizador puede sugerir el idioma ya detectado para elegir mejor motor de OCR.
  const ocrLang = (s, opts) => (s.sourceLang === 'auto' && opts && typeof opts.lang === 'string' && opts.lang ? opts.lang : s.sourceLang);

  ipcMain.handle('ocr:recognize', async (_e, png, opts) => {
    const s = settings.get();
    return ocr.recognize(Buffer.from(png), { lang: ocrLang(s, opts), engine: s.ocrEngine });
  });

  // Captura directa de la pantalla (sin puntero) + OCR. `rect` en DIP absolutos de pantalla.
  ipcMain.handle('ocr:region', async (_e, rect, opts) => {
    const s = settings.get();
    const phys = screen.dipToScreenRect(win, {
      x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
    });
    try {
      return await ocr.recognizeRegion({ x: phys.x, y: phys.y, w: phys.width, h: phys.height }, { lang: ocrLang(s, opts), engine: s.ocrEngine });
    } catch (err) {
      if (err && err.code === 'NO_SCREEN_CAPTURE') return { fallback: true, reason: String(err.message || err) };
      throw err;
    }
  });

  ipcMain.handle('translate:run', async (_e, texts, opts) => {
    const s = settings.get();
    return translator.translateDetailed(texts, { from: s.sourceLang, to: s.targetLang, ...(opts || {}) });
  });

  ipcMain.on('win:drag-start', (_e, mode) => dragger.begin(String(mode)));
  ipcMain.on('win:drag-end', () => dragger.end());
  ipcMain.on('win:ignore-mouse', (_e, ignore) => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('win:hide', () => toggleVisible(false));
  ipcMain.on('debug:toggle', (_e, v) => { if (DEBUG) toggleVisible(typeof v === 'boolean' ? v : undefined); });
  ipcMain.on('win:reset', () => { win.setBounds(defaultBounds()); saveBounds(); pushState(); });
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.on('app:log', (_e, msg) => log('renderer:', msg));
  ipcMain.on('debug:dump', (_e, name, dataUrl) => {
    if (!DEBUG) return;
    const dir = path.join(app.getPath('userData'), 'debug');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  });

  // Respaldo por si getUserMedia no pudiera usar la fuente directamente.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const d = screen.getDisplayMatching(win.getBounds());
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    callback({ video: sources.find((s) => s.display_id === String(d.id)) || sources[0] });
  }, { useSystemPicker: false });
}

/* --------------------------------------------------------------------- bandeja */

function trayIcon() {
  let img = loadImage('tray.png');
  if (img.isEmpty()) img = loadImage('icon.png');
  return img.resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray || !settings) return;
  const s = settings.get();
  const visible = lensVisible;
  tray.setToolTip(`Lupa — ${s.paused ? 'en pausa' : 'traduciendo'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Ocultar lente' : 'Mostrar lente', click: () => toggleVisible() },
    { label: s.paused ? 'Reanudar traducción' : 'Pausar traducción', click: () => { patchSettings({ paused: !s.paused }); broadcastSettings(); } },
    { label: 'Traducir ahora', click: () => sendCommand('refresh') },
    { type: 'separator' },
    {
      label: 'Modo', submenu: [
        { label: 'Lente (sobre el texto)', type: 'radio', checked: s.mode === 'overlay', click: () => { patchSettings({ mode: 'overlay' }); broadcastSettings(); } },
        { label: 'Lectura (panel)', type: 'radio', checked: s.mode === 'reader', click: () => { patchSettings({ mode: 'reader' }); broadcastSettings(); } },
      ],
    },
    { label: 'Restablecer posición y tamaño', click: () => { win.setBounds(defaultBounds()); saveBounds(); pushState(); toggleVisible(true); } },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
}

function setupTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => toggleVisible());
  updateTray();
}

/** Atajos globales: cada acción prueba sus teclas por orden y usa la primera que esté libre. */
const activeShortcuts = {};

const prettyAccel = (a) => (a ? a.replace('Control', 'Ctrl').replace('Up', '↑').replace('Down', '↓') : null);

function setupShortcuts() {
  const opacityStep = (delta) => () => {
    const s = settings.get();
    const key = s.mode === 'overlay' ? 'opacityOverlay' : 'opacityReader';
    patchSettings({ [key]: Math.min(1, Math.max(0.05, s[key] + delta)) });
    broadcastSettings();
  };
  const plan = {
    toggle: [['Control+Alt+L', 'Control+Alt+K'], () => toggleVisible()],
    pause: [['Control+Alt+P', 'Control+Alt+O'], () => { patchSettings({ paused: !settings.get().paused }); broadcastSettings(); }],
    refresh: [['Control+Alt+R', 'Control+Alt+T'], () => sendCommand('refresh')],
    mode: [['Control+Alt+M', 'Control+Alt+V', 'Control+Alt+E', 'Control+Alt+J'], () => { patchSettings({ mode: settings.get().mode === 'overlay' ? 'reader' : 'overlay' }); broadcastSettings(); }],
    more: [['Control+Alt+Up'], opacityStep(0.05)],
    less: [['Control+Alt+Down'], opacityStep(-0.05)],
  };
  for (const [name, [keys, fn]] of Object.entries(plan)) {
    activeShortcuts[name] = null;
    for (const accel of keys) {
      let ok = false;
      try { ok = globalShortcut.register(accel, fn); } catch (_) { /* en uso por otra app */ }
      log('atajo', name, accel, ok ? 'registrado' : 'ocupado');
      if (ok) { activeShortcuts[name] = prettyAccel(accel); break; }
    }
  }
  updateTray();
}

/* ------------------------------------------------------------------ arranque */

app.on('second-instance', () => toggleVisible(true));

/** La exclusión de la ventana en las capturas (WDA_EXCLUDEFROMCAPTURE) llegó con Windows 10 2004 (build 19041). */
function supportedWindows() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] || 0);
  return build >= 19041;
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  if (!supportedWindows() && !process.env.LUPA_SKIP_OS_CHECK) {
    dialog.showErrorBox('Lupa', 'Lupa necesita Windows 10 (versión 2004, de mayo de 2020) o Windows 11.\n\nEn versiones anteriores la lente no puede ocultarse de la captura de pantalla y se leería a sí misma.');
    app.quit();
    return;
  }
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  ocr = new OcrService({
    userData: app.getPath('userData'),
    resources: RESOURCES,
    onStatus: (msg) => { if (win && !win.isDestroyed()) win.webContents.send('status', { kind: 'info', message: msg }); },
  });
  ocr.warmUp().then(() => { log('OCR listo', JSON.stringify(ocr.status())); });

  setupIpc();
  createWindow();
  setupTray();
  setupShortcuts();
});

app.on('before-quit', () => { quitting = true; if (settings) { saveBounds(); settings.flush(); } });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (ocr) ocr.stop(); });
app.on('window-all-closed', () => { app.quit(); });

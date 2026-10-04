import { ICONS } from './icons.js';
import { ScreenCapture, signatureDiff, canvasToPng } from './capture.js';
import { sampleColors } from './colors.js';
import { OverlayView, ReaderView } from './overlay.js';

const lupa = window.lupa;
const $ = (id) => document.getElementById(id);

const SPEED = {
  fast: { poll: 80, settle: 220 },
  balanced: { poll: 120, settle: 380 },
  eco: { poll: 260, settle: 800 },
};
const CHANGE_THRESHOLD = 0.004;   // fracción de píxeles que deben cambiar para considerar que hay contenido nuevo
const IDLE_AFTER_MS = 3500;       // sin movimiento durante este tiempo => modo reposo
const IDLE_POLL_MS = 320;         // intervalo de sondeo en reposo
const MAX_STALE_MS = 2600;        // si el contenido no deja de moverse (vídeo), se traduce igualmente cada tanto
const MIN_PER_REQUEST = 6;        // con menos bloques que esto no merece la pena partir la petición
const PARALLEL = 3;               // peticiones de traducción simultáneas como máximo

const el = {
  lens: $('lens'), stage: $('stage'), overlay: $('overlayLayer'), reader: $('reader'), hint: $('hint'),
  statusText: $('statusText'),
};

const state = {
  settings: null,
  win: null,
  languages: null,
  visible: true,
  dragging: false,
  popover: null,
  overInteractive: false,

  capture: new ScreenCapture(),
  streamDisplay: null,
  prevSig: null,
  prevKey: null,
  lastMotion: 0,

  ocrSig: null,
  ocrKey: null,
  stale: false,
  staleSince: 0,
  force: false,
  busy: false,
  gen: 0,
  retryAt: 0,
  streamRetryAt: 0,
  directFailed: false,   // la captura directa (PowerShell) no funciona: se usa el stream
  directRetryAt: 0,

  blocks: [],
  shortcuts: {},       // atajos globales realmente registrados (mapa nombre -> "Ctrl+Alt+L")
  autoLang: null,      // idioma detectado por Google mientras el ajuste es "Detectar idioma"
  hintTimer: null,
  debug: false,
};

const overlay = new OverlayView(el.overlay);
const reader = new ReaderView(el.reader);

/* ================================================================== ajustes */

function setSetting(patch) {
  Object.assign(state.settings, patch);
  applySettings();
  lupa.patchSettings(patch);
}

const modeKey = (s) => (s.mode === 'overlay' ? 'opacityOverlay' : 'opacityReader');

function langShort(code) {
  return code === 'auto' ? 'Auto' : code.split('-')[0].toUpperCase();
}

function langLabel(s) {
  return s.sourceLang === 'auto' && state.autoLang ? `Auto · ${langShort(state.autoLang)}` : langShort(s.sourceLang);
}

let lastApplied = {};
function applySettings() {
  const s = state.settings;
  const prev = lastApplied;
  lastApplied = { ...s };

  el.lens.dataset.mode = s.mode;
  el.lens.dataset.theme = s.readerTheme;
  el.lens.style.setProperty('--glass', String(s[modeKey(s)]));
  overlay.setGlass([9, 13, 24], s.mode === 'overlay' ? s.opacityOverlay : 0);
  el.overlay.hidden = s.mode !== 'overlay';
  el.reader.hidden = s.mode !== 'reader';

  $('modeBtn').innerHTML = s.mode === 'overlay' ? ICONS.lensMode : ICONS.readerMode;
  $('pauseBtn').innerHTML = s.paused ? ICONS.play : ICONS.pause;
  $('pauseBtn').classList.toggle('on', s.paused);
  applyTips();
  $('opacityBtn').classList.toggle('on', state.popover === 'opacityPop');

  $('langLabel').textContent = langLabel(s);
  $('targetLabel').textContent = langShort(s.targetLang);

  const op = Math.round(s[modeKey(s)] * 100);
  $('opacityRange').value = String(op);
  $('opacityValue').textContent = `${op}%`;
  $('opacityMode').textContent = s.mode === 'overlay' ? '· vista lente' : '· vista lectura';
  $('fontRange').value = String(Math.round(s.fontScale * 100));
  $('fontValue').textContent = `${Math.round(s.fontScale * 100)}%`;

  syncSeg('targetSeg', s.targetLang);
  syncSeg('modeSeg', s.mode);
  syncSeg('themeSeg', s.readerTheme);
  syncSeg('speedSeg', s.speed);
  syncSeg('engineSeg', s.ocrEngine);
  $('themeRow').hidden = s.mode !== 'reader';
  $('passSwitch').setAttribute('aria-checked', String(s.passthrough));
  $('topSwitch').setAttribute('aria-checked', String(s.alwaysOnTop));
  syncLangList();

  if (s.paused) setStatus('paused', 'En pausa');
  else if (prev.paused) setStatus('idle', 'Lista');

  applyIgnore();

  // cambios que obligan a volver a leer o a volver a dibujar
  if (prev.sourceLang !== undefined) {
    if (prev.sourceLang !== s.sourceLang || prev.targetLang !== s.targetLang || prev.ocrEngine !== s.ocrEngine) {
      state.autoLang = null;
      clearResults();
      state.force = true;
    } else if (prev.mode !== s.mode || prev.fontScale !== s.fontScale || prev.readerTheme !== s.readerTheme) {
      renderAll();
    } else if (prev.opacityReader !== s.opacityReader && s.mode === 'reader') {
      reader.fit(s.fontScale);
    }
  }
}

/* ===================================================================== UI */

const state_text = { idle: 'Lista', busy: 'Traduciendo…', paused: 'En pausa', error: 'Sin conexión' };

function setStatus(kind, text) {
  el.lens.dataset.state = kind;
  el.statusText.textContent = text || state_text[kind] || '';
}

function setBusy(b) {
  state.busy = b;
  el.lens.dataset.busy = b ? '1' : '0';
}

function showHint(html, { error = false, ms = 0, sticky = false } = {}) {
  clearTimeout(state.hintTimer);
  state.stickyUntil = sticky ? performance.now() + ms : 0;
  el.hint.className = error ? 'hint err' : 'hint';
  el.hint.innerHTML = html;
  el.hint.hidden = false;
  if (ms) state.hintTimer = setTimeout(() => hideHint(true), ms);
}

/** `force` oculta también los mensajes "fijos" (consejo de primer uso). */
function hideHint(force = false) {
  if (!force && performance.now() < (state.stickyUntil || 0)) return;
  clearTimeout(state.hintTimer);
  el.hint.hidden = true;
}

function makeSeg(id, options, onPick) {
  const host = $(id);
  host.replaceChildren();
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = value;
    b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    host.appendChild(b);
  }
}

function syncSeg(id, value) {
  for (const b of $(id).children) b.classList.toggle('on', b.dataset.value === value);
}

function syncLangList() {
  const cur = state.settings.sourceLang;
  for (const b of $('langList').children) {
    const on = b.dataset.code === cur;
    b.classList.toggle('on', on);
    const mark = b.querySelector('.mark');
    if (mark) mark.innerHTML = on ? ICONS.check : '';
  }
}

/* ---------------------------------------------------------------- tooltips */

function initTooltips() {
  const tip = $('tip');
  let timer = null;
  let current = null;
  const hide = () => { clearTimeout(timer); timer = null; current = null; tip.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === current) return;
    hide();
    if (!t || state.dragging || state.popover) return;
    current = t;
    timer = setTimeout(() => {
      if (!t.dataset.tip) return;
      tip.textContent = t.dataset.tip;
      tip.hidden = false;
      const lens = el.lens.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, lens.left + 6), lens.right - w - 6);
      tip.style.left = `${left - lens.left}px`;
      tip.style.top = `${r.bottom - lens.top + 8}px`;
    }, 450);
  });
  document.addEventListener('mouseleave', hide, true);
  document.addEventListener('pointerdown', hide, true);
}

const keyHint = (name) => (state.shortcuts[name] ? ` (${state.shortcuts[name]})` : '');

/** Textos de ayuda de la barra: incluyen el atajo solo si está disponible en este equipo. */
function applyTips() {
  const s = state.settings;
  const sc = state.shortcuts;
  $('modeBtn').dataset.tip = (s.mode === 'overlay'
    ? 'Vista lente: traduce sobre el texto. Clic para pasar a lectura'
    : 'Vista lectura: panel limpio. Clic para pasar a lente') + keyHint('mode');
  $('pauseBtn').dataset.tip = (s.paused ? 'Reanudar la traducción automática' : 'Pausar la traducción automática') + keyHint('pause');
  $('refreshBtn').dataset.tip = 'Traducir ahora' + keyHint('refresh');
  $('opacityBtn').dataset.tip = 'Transparencia de la ventana' + (sc.more && sc.less ? ` (${sc.more.replace(/[↑↓]/, '')}↑/↓)` : '');
  $('hideBtn').dataset.tip = 'Ocultar a la bandeja' + (sc.toggle ? ` (${sc.toggle} para volver)` : ' (clic en el icono de la bandeja para volver)');
}

function buildShortcutList() {
  const host = $('shortcuts');
  host.replaceChildren();
  const title = document.createElement('b');
  title.textContent = 'Atajos';
  host.appendChild(title);
  const rows = [['toggle', 'mostrar / ocultar'], ['pause', 'pausar'], ['refresh', 'traducir ahora'], ['mode', 'cambiar vista']];
  const add = (accel, text) => {
    const row = document.createElement('span');
    for (const k of accel.split('+')) { const kbd = document.createElement('kbd'); kbd.textContent = k; row.appendChild(kbd); }
    row.append(` ${text}`);
    host.appendChild(row);
  };
  for (const [name, text] of rows) if (state.shortcuts[name]) add(state.shortcuts[name], text);
  if (state.shortcuts.more && state.shortcuts.less) add(state.shortcuts.more.replace('↑', '↑ / ↓'), 'transparencia');
}

function refreshEngineInfo(info) {
  $('engineInfo').textContent = info && info.windowsLangs && info.windowsLangs.length
    ? `Windows puede leer: ${info.windowsLangs.join(', ')}. Para otros idiomas se usa Tesseract (se descarga solo, una vez).`
    : 'Usa el OCR de Windows cuando el idioma está instalado; si no, Tesseract (se descarga solo, una vez).';
}

function buildUi() {
  $('logo').innerHTML = ICONS.logo;
  $('langArrow').innerHTML = ICONS.arrow;
  $('refreshBtn').innerHTML = ICONS.refresh;
  $('settingsBtn').innerHTML = ICONS.settings;
  $('opacityBtn').innerHTML = ICONS.droplet;
  $('hideBtn').innerHTML = ICONS.hide;
  $('closeBtn').innerHTML = ICONS.close;
  $('icoGlass').innerHTML = ICONS.droplet;
  $('icoSolid').innerHTML = ICONS.dropletFill;

  const list = $('langList');
  for (const l of state.languages.source) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.code = l.code;
    b.innerHTML = '<span></span><span class="mark"></span>';
    b.firstChild.textContent = l.label;
    b.addEventListener('click', () => { setSetting({ sourceLang: l.code }); closePopovers(); });
    list.appendChild(b);
  }

  makeSeg('targetSeg', state.languages.target.map((l) => [l.code, l.label]), (v) => setSetting({ targetLang: v }));
  makeSeg('modeSeg', [['overlay', 'Lente'], ['reader', 'Lectura']], (v) => setSetting({ mode: v }));
  makeSeg('themeSeg', [['dark', 'Oscuro'], ['light', 'Claro']], (v) => setSetting({ readerTheme: v }));
  makeSeg('speedSeg', [['fast', 'Rápida'], ['balanced', 'Equilibrada'], ['eco', 'Ahorro']], (v) => setSetting({ speed: v }));
  makeSeg('engineSeg', [['auto', 'Automático'], ['windows', 'Windows'], ['tesseract', 'Tesseract']], (v) => setSetting({ ocrEngine: v }));

  $('modeBtn').addEventListener('click', () => setSetting({ mode: state.settings.mode === 'overlay' ? 'reader' : 'overlay' }));
  $('pauseBtn').addEventListener('click', () => setSetting({ paused: !state.settings.paused }));
  $('refreshBtn').addEventListener('click', () => forceRefresh());
  $('hideBtn').addEventListener('click', () => lupa.hide());
  $('closeBtn').addEventListener('click', () => lupa.quit());
  $('quitBtn').addEventListener('click', () => lupa.quit());
  $('resetBtn').addEventListener('click', () => lupa.resetBounds());
  $('passSwitch').addEventListener('click', () => setSetting({ passthrough: !state.settings.passthrough }));
  $('topSwitch').addEventListener('click', () => setSetting({ alwaysOnTop: !state.settings.alwaysOnTop }));

  $('opacityRange').addEventListener('input', (e) => setSetting({ [modeKey(state.settings)]: Number(e.target.value) / 100 }));
  $('fontRange').addEventListener('input', (e) => setSetting({ fontScale: Number(e.target.value) / 100 }));

  $('langBtn').dataset.popbtn = '1';
  $('opacityBtn').dataset.popbtn = '1';
  $('settingsBtn').dataset.popbtn = '1';
  $('langBtn').addEventListener('click', () => togglePopover('langMenu'));
  $('opacityBtn').addEventListener('click', () => togglePopover('opacityPop'));
  $('settingsBtn').addEventListener('click', () => togglePopover('settingsPanel'));

  refreshEngineInfo(state.ocr);

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  initTooltips();
}

/* ----------------------------------------------------------------- popovers */

function closePopovers() {
  if (!state.popover) return;
  for (const id of ['langMenu', 'opacityPop', 'settingsPanel']) $(id).hidden = true;
  state.popover = null;
  $('opacityBtn').classList.remove('on');
  applyIgnore();
}

function togglePopover(id) {
  if (state.popover === id) { closePopovers(); return; }
  if (id === 'settingsPanel') lupa.ocrStatus().then(refreshEngineInfo).catch(() => {});
  for (const other of ['langMenu', 'opacityPop', 'settingsPanel']) $(other).hidden = other !== id;
  state.popover = id;
  $('opacityBtn').classList.toggle('on', id === 'opacityPop');
  applyIgnore();
}

/* ------------------------------------------- clic a través + arrastre + asas */

let ignoring = null;
function applyIgnore() {
  if (!state.settings) return;
  const want = state.settings.passthrough && !state.overInteractive && !state.popover && !state.dragging;
  if (want !== ignoring) { ignoring = want; lupa.setIgnoreMouse(want); }
}

function wireInteraction() {
  document.addEventListener('mousemove', (e) => {
    const over = !!(e.target && e.target.closest && e.target.closest('[data-interactive]'));
    if (over !== state.overInteractive) { state.overInteractive = over; applyIgnore(); }
  }, true);
  document.documentElement.addEventListener('mouseleave', () => {
    if (state.overInteractive) { state.overInteractive = false; applyIgnore(); }
  });

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (state.popover && !e.target.closest('.pop') && !e.target.closest('[data-popbtn]')) closePopovers();

    const handle = e.target.closest('[data-resize]');
    const grab = handle || e.target.closest('[data-drag]');
    if (!grab) return;
    e.preventDefault();
    closePopovers();
    const mode = handle ? handle.dataset.resize : 'move';
    try { grab.setPointerCapture(e.pointerId); } catch (_) { /* nada */ }
    state.dragging = true;
    applyIgnore();
    lupa.dragStart(mode);
    const end = () => {
      grab.removeEventListener('pointerup', end);
      grab.removeEventListener('pointercancel', end);
      grab.removeEventListener('lostpointercapture', end);
      if (!state.dragging) return;
      state.dragging = false;
      lupa.dragEnd();
      applyIgnore();
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    grab.addEventListener('lostpointercapture', end);
  });

  window.addEventListener('blur', () => { /* la ventana no suele tener foco: no cerramos nada */ });
}

/* =============================================================== geometría */

function currentRegion() {
  const w = state.win;
  if (!w) return null;
  const r = el.stage.getBoundingClientRect();
  if (r.width < 80 || r.height < 40) return null;
  const region = {
    x: w.bounds.x - w.display.bounds.x + r.left,
    y: w.bounds.y - w.display.bounds.y + r.top,
    w: r.width,
    h: r.height,
  };
  const key = [w.display.id, region.x, region.y, region.w, region.h].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join('|');
  return { region, key, cssW: r.width, cssH: r.height };
}

function markStale() {
  if (state.stale) return;
  state.dbg = { staleAt: Date.now() };
  state.stale = true;
  state.staleSince = performance.now();
  if (state.settings.mode === 'overlay') overlay.setStale(true);
}

function clearStale() {
  if (!state.stale) return;
  state.stale = false;
  overlay.setStale(false);
}

function onWinState(s) {
  state.win = s;
  const reg = currentRegion();
  if (reg && state.ocrKey && reg.key !== state.ocrKey) markStale();
}

/* ============================================================== resultados */

function clearResults() {
  state.gen++;
  state.blocks = [];
  state.ocrSig = null;
  state.ocrKey = null;
  overlay.clear();
  reader.clear();
  clearStale();
}

function renderBlock(b) {
  const s = state.settings;
  if (s.mode === 'overlay') {
    if (b.tr == null) return;
    if (b.same) overlay.remove(b.id); else overlay.fill(b, b.tr, s.fontScale);
  } else if (b.tr != null) {
    reader.fill(b, b.tr);
  }
}

function renderAll() {
  const s = state.settings;
  if (!state.blocks.length) return;
  if (s.mode === 'overlay') {
    overlay.showPending(state.blocks);
    for (const b of state.blocks) renderBlock(b);
    overlay.balance();
  } else {
    reader.show(state.blocks);
    for (const b of state.blocks) renderBlock(b);
    reader.fit(s.fontScale);
  }
  overlay.setStale(state.stale && s.mode === 'overlay');
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
/**
 * Tamaño de letra del texto original (px CSS). La altura de línea subestima cuando no hay ascendentes/
 * descendentes (botones, menús) y el ancho por carácter se dispara con mayúsculas: se combinan.
 */
function estimateFont(text, lineH, charW) {
  const wEst = charW / (CJK.test(text) ? 0.95 : 0.47);
  return Math.min(Math.max(wEst, lineH), lineH * 1.45);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Idioma dominante del texto según Google (ponderado por longitud), o null si no hay base suficiente. */
function detectLanguage(blocks) {
  const tally = new Map();
  let total = 0;
  for (const b of blocks) {
    if (!b.src || b.src === 'auto' || b.src === 'und') continue;
    let code = b.src;
    if (code === 'iw') code = 'he';
    if (code === 'zh') code = 'zh-CN';
    tally.set(code, (tally.get(code) || 0) + b.text.length);
    total += b.text.length;
  }
  if (total < 40) return null;
  const [code, chars] = [...tally.entries()].sort((a, c) => c[1] - a[1])[0];
  return { code, share: chars / total };
}

/** "Detectar idioma": si el texto no es inglés, relee con el motor de OCR de ese idioma. */
function adaptAutoLanguage(blocks) {
  if (state.settings.sourceLang !== 'auto') return;
  const d = detectLanguage(blocks);
  if (!d || d.share < 0.6) return;
  const known = state.languages.source.some((l) => l.code === d.code && l.code !== 'auto');
  const want = d.code === 'en' || !known ? null : d.code;
  if (want === state.autoLang) return;
  state.autoLang = want;
  $('langLabel').textContent = langLabel(state.settings);
  if (want) state.force = true;   // vuelve a leer con el OCR del idioma detectado
}

/**
 * Traduce los bloques en pocas peticiones SIMULTANEAS (una sola ronda de red incluso con latencia alta).
 * Se reparten en hasta PARALLEL tandas; cada una se dibuja en cuanto llega.
 */
async function translateBlocks(blocks, gen, timing) {
  const parts = Math.min(PARALLEL, Math.max(1, Math.ceil(blocks.length / MIN_PER_REQUEST)));
  const size = Math.ceil(blocks.length / parts);
  const chunks = [];
  for (let i = 0; i < blocks.length; i += size) chunks.push(blocks.slice(i, i + size));

  let failed = null;
  const agg = { requests: chunks.length, cached: 0, requested: 0, providers: new Set(), hedged: false, firstMs: null, netMs: 0 };
  const t0 = performance.now();
  await Promise.all(chunks.map(async (chunk) => {
    let res;
    try {
      res = await lupa.translate(chunk.map((b) => b.text));
    } catch (err) { failed = failed || err; return; }
    if (gen !== state.gen) return;
    const { items, stats } = res;
    if (agg.firstMs == null) agg.firstMs = Math.round(performance.now() - t0);
    agg.cached += stats.cached; agg.requested += stats.requested; agg.netMs = Math.max(agg.netMs, stats.networkMs || 0);
    if (stats.provider) agg.providers.add(stats.provider);
    agg.hedged = agg.hedged || stats.hedged;
    chunk.forEach((b, i) => { b.tr = items[i].text; b.same = !!items[i].same; b.src = items[i].src; renderBlock(b); });
    if (state.settings.mode === 'reader') reader.fit(state.settings.fontScale);
  }));
  if (timing) Object.assign(timing, { translateMs: Math.round(performance.now() - t0), firstResultMs: agg.firstMs, requests: agg.requests, cached: agg.cached, requested: agg.requested, networkMs: agg.netMs, providers: [...agg.providers], hedged: agg.hedged });
  if (failed) throw failed;
}

async function runCycle(reg, sig) {
  if (state.busy) return;
  const gen = ++state.gen;
  setBusy(true);
  state.force = false;
  const t0 = performance.now();
  try {
    const frame = state.capture.grab(reg.region, state.win.display.bounds);
    state.ocrSig = sig;
    state.ocrKey = reg.key;
    setStatus('busy', 'Leyendo texto…');

    // 1) Captura directa de pantalla en el proceso principal (sin puntero del ratón, más rápida).
    // 2) Si no está disponible, se envía el fotograma del stream (a resolución completa).
    let res = null;
    if (!state.directFailed || performance.now() > state.directRetryAt) {
      state.directFailed = false;
      try {
        const d = state.win.display.bounds;
        res = await lupa.ocrRegion({ x: reg.region.x + d.x, y: reg.region.y + d.y, width: reg.region.w, height: reg.region.h }, { lang: state.autoLang });
        if (res && res.fallback) { lupa.log('captura directa no disponible:', res.reason); res = null; }
      } catch (err) {
        if (/Windows no tiene|idioma/i.test(String((err && err.message) || err))) throw err;
        lupa.log('captura directa falló:', (err && err.message) || err);
        res = null;
      }
      if (!res) { state.directFailed = true; state.directRetryAt = performance.now() + 60000; }
    }
    if (!res) {
      if (!state.capture.highRes) {
        // El stream estaba a baja resolución: lo reiniciamos a resolución completa y repetimos.
        state.capture.highRes = true;
        state.capture.stop();
        state.streamDisplay = null;
        state.ocrSig = null;
        state.force = true;
        return;
      }
      res = await lupa.ocr(await canvasToPng(frame.canvas), { lang: state.autoLang });
    }
    if (gen !== state.gen) return;

    // ¿cambió la pantalla mientras se hacía el OCR? entonces el resultado ya no sirve
    const now = currentRegion();
    if (!now || now.key !== reg.key || signatureDiff(state.capture.signature(now.region, state.win.display.bounds), sig) > CHANGE_THRESHOLD) {
      state.ocrSig = null;
      return;
    }

    // Coordenadas del OCR en píxeles de su propia imagen -> px CSS (sx, sy) y -> píxeles del fotograma (fx, fy)
    const imgW = res.width || frame.canvas.width;
    const imgH = res.height || frame.canvas.height;
    const sx = imgW / reg.cssW;
    const sy = imgH / reg.cssH;
    const fx = frame.canvas.width / imgW;
    const fy = frame.canvas.height / imgH;
    const toFrame = (r) => ({ x: r.x * fx, y: r.y * fy, w: r.w * fx, h: r.h * fy });
    const blocks = res.blocks.map((b) => {
      const lineH = b.lineH / sy;
      const charW = (b.lines.reduce((t, l) => t + l.w, 0) / Math.max(1, b.text.length)) / sx;
      return {
        id: b.id,
        text: b.text,
        x: b.x / sx, y: b.y / sy, w: b.w / sx, h: b.h / sy,
        lineCount: b.lineCount,
        lineH,
        pitch: b.pitch / sy,
        fontEst: estimateFont(b.text, lineH, charW),
        align: b.align,
        clipL: !!b.clipL,
        clipR: !!b.clipR,
        colors: sampleColors(frame.ctx, toFrame(b), b.lines.map(toFrame)),
        tr: null,
        same: false,
      };
    });
    const medFont = median(blocks.filter((b) => b.lineCount > 1).map((b) => b.fontEst)) || median(blocks.map((b) => b.fontEst));
    const regular = blocks.filter((b) => b.fontEst < medFont * 1.12 && b.colors.ink > 0);
    const medInk = median((regular.length >= 2 ? regular : blocks).map((b) => b.colors.ink));
    for (const b of blocks) {
      // Negrita: más tinta que el texto normal Y letra claramente mayor (títulos). Así un botón de texto
      // claro sobre fondo de color no se confunde con un título.
      const bigger = b.fontEst >= medFont * 1.12;
      b.bold = bigger && medInk > 0 && b.colors.ink > medInk * 1.32 && b.text.length > 3;
      b.heading = b.lineCount <= 3 && (b.fontEst > medFont * 1.22 || b.bold);
    }

    // Fragmentos de una o dos palabras cortados por el borde de la lente ("Common" de "Common mistakes"):
    // traducidos solos dicen otra cosa; es mejor dejar visible el original.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if ((b.clipL || b.clipR) && b.text.trim().split(/\s+/).length <= 2) blocks.splice(i, 1);
    }
    blocks.forEach((b, i) => { b.id = i; });

    state.blocks = blocks;
    clearStale();

    if (!blocks.length) {
      overlay.clear();
      reader.clear();
      setStatus('idle', 'Sin texto');
      showHint('No veo texto en esta zona.<br><b>Mueve la lente</b> sobre lo que quieras traducir.', { ms: 3500 });
      return;
    }

    hideHint();
    renderAll();
    setStatus('busy', 'Traduciendo…');
    const timing = { ocr: res.timing || null, engine: res.engine, tag: res.tag, substitute: !!res.substitute };
    await translateBlocks(blocks, gen, timing);
    if (gen !== state.gen) return;
    if (state.settings.mode === 'overlay') overlay.balance();
    adaptAutoLanguage(blocks);

    const ms = Math.round(performance.now() - t0);
    if (state.dbg) state.dbg.doneAt = Date.now();
    setStatus('idle', `${blocks.length} bloques · ${ms} ms`);
    if (state.settings.showTip) { setSetting({ showTip: false }); }
    state.retryAt = 0;
    if (state.debug) lupa.log(`ciclo: ${res.engine} ocr=${res.ocrMs}ms total=${ms}ms bloques=${blocks.length}`);
  } catch (err) {
    if (gen !== state.gen) return;
    const msg = String((err && err.message) || err);
    lupa.log('error en el ciclo:', msg);
    setStatus('error', /traduc|fetch|network|HTTP|Failed/i.test(msg) ? 'Sin conexión' : 'Error');
    overlay.clear();
    showHint(/OCR|idioma|Windows|Tesseract|datos/i.test(msg)
      ? `No pude leer el texto.<br><b>${escapeHtml(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</b>`
      : 'No pude traducir ahora.<br><b>Revisa tu conexión a internet</b>; reintento en unos segundos.',
    { error: true, ms: 5000 });
    state.ocrSig = null;                 // fuerza un reintento
    state.retryAt = performance.now() + 5000;
  } finally {
    setBusy(false);
    if (el.lens.dataset.state === 'busy') setStatus(state.settings.paused ? 'paused' : 'idle');
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function forceRefresh() {
  state.force = true;
  state.retryAt = 0;
}

/* ================================================================== bucle */

async function ensureStream() {
  const want = state.win.display.id;
  if (state.capture.ready && state.streamDisplay === want) return true;
  if (performance.now() < state.streamRetryAt) return false;
  try {
    const src = await lupa.captureSource();
    if (!src) throw new Error('No hay pantallas disponibles para capturar');
    state.capture.stop();
    await state.capture.start(src);
    state.streamDisplay = src.displayId;
    if (!state.capture.ready) throw new Error('La captura de pantalla no entregó imagen');
    return true;
  } catch (err) {
    state.streamRetryAt = performance.now() + 2500;
    lupa.log('captura:', (err && err.message) || err);
    setStatus('error', 'Sin captura');
    showHint('No puedo capturar la pantalla.<br><b>Reintentando…</b>', { error: true, ms: 3000 });
    return false;
  }
}

async function step() {
  if (!state.visible || state.dragging || !state.win) return;
  const s = state.settings;
  if (!(await ensureStream())) return;
  const reg = currentRegion();
  if (!reg) return;

  const now = performance.now();
  const sig = state.capture.signature(reg.region, state.win.display.bounds);
  const moved = signatureDiff(sig, state.prevSig) > CHANGE_THRESHOLD || reg.key !== state.prevKey;
  state.prevSig = sig;
  state.prevKey = reg.key;
  if (moved) state.lastMotion = now;

  const changed = !state.ocrSig || reg.key !== state.ocrKey || signatureDiff(sig, state.ocrSig) > CHANGE_THRESHOLD;
  if (changed && state.blocks.length) markStale(); else if (!changed) clearStale();

  if (state.busy) return;
  const manual = state.force;
  if (s.paused && !manual) return;
  if (!changed && !manual) return;
  if (state.retryAt && now < state.retryAt && !manual) return;

  const speed = SPEED[s.speed] || SPEED.balanced;
  const settled = now - state.lastMotion >= speed.settle;
  const waited = state.stale && now - state.staleSince >= MAX_STALE_MS;
  if (manual || settled || waited) await runCycle(reg, sig);
}

async function loop() {
  try { await step(); } catch (err) { lupa.log('loop:', (err && err.message) || err); }
  const speed = SPEED[state.settings.speed] || SPEED.balanced;
  // Si la pantalla lleva un rato quieta, se mira con menos frecuencia (ahorra CPU/batería).
  const idle = !state.busy && !state.force && performance.now() - state.lastMotion > IDLE_AFTER_MS;
  setTimeout(loop, idle ? Math.max(speed.poll, IDLE_POLL_MS) : speed.poll);
}

/* ================================================================= arranque */

async function boot() {
  const init = await lupa.init();
  state.settings = init.settings;
  state.win = init.state;
  state.languages = init.languages;
  state.ocr = init.ocr;
  state.debug = init.debug;
  state.shortcuts = init.shortcuts || {};

  buildUi();
  buildShortcutList();
  wireInteraction();
  applySettings();
  applyIgnore();

  lupa.onWinState(onWinState);
  lupa.onSettings((s) => { state.settings = s; applySettings(); });
  lupa.onCommand((c) => { if (c.type === 'refresh') forceRefresh(); });
  lupa.onStatus((s) => { if (s && s.message) setStatus('busy', s.message); else if (!state.busy) setStatus(state.settings.paused ? 'paused' : 'idle'); });
  lupa.onVisibility((v) => {
    state.visible = v;
    if (!v) { state.capture.stop(); state.streamDisplay = null; return; }
    // El proceso principal fuerza "ignorar ratón" al ocultar: se vuelve a sincronizar con el estado real.
    ignoring = null;
    state.overInteractive = false;
    state.dragging = false;
    applyIgnore();
    if (!state.settings.paused) forceRefresh();
  });

  if (state.settings.showTip) {
    showHint('Coloca la lente <b>sobre el texto</b> que quieras traducir.<br>Arrastra la barra para moverla, estira los bordes y ajusta la <b>transparencia</b> con la gota.<br><span style="opacity:.75;font-size:11.5px">El texto que se lee se envía a Google Translate por internet para traducirlo.</span>', { ms: 16000, sticky: true });
  }
  setStatus(state.settings.paused ? 'paused' : 'idle');
  forceRefresh();
  loop();

  if (state.debug) {
    window.__lupa = {
      state, overlay, reader, runNow: forceRefresh,
      ignoring: () => ignoring,
      resetIgnore: () => { ignoring = null; state.overInteractive = false; applyIgnore(); return ignoring; },
      cursorHidden: () => state.capture.cursorHidden,
      dump: async () => {
        const reg = currentRegion();
        const frame = state.capture.grab(reg.region, state.win.display.bounds);
        lupa.debugDump('frame.png', frame.canvas.toDataURL('image/png'));
        return { w: frame.canvas.width, h: frame.canvas.height };
      },
    };
  }
}

boot().catch((err) => { lupa.log('boot falló:', (err && err.stack) || err); });

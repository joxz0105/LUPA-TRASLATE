'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('lupa', {
  init: () => ipcRenderer.invoke('app:init'),
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  captureSource: () => ipcRenderer.invoke('capture:source'),
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),
  ocr: (png, opts) => ipcRenderer.invoke('ocr:recognize', png, opts),
  ocrRegion: (rect, opts) => ipcRenderer.invoke('ocr:region', rect, opts),
  translate: (texts, opts) => ipcRenderer.invoke('translate:run', texts, opts),

  dragStart: (mode) => ipcRenderer.send('win:drag-start', mode),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('win:ignore-mouse', !!ignore),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  resetBounds: () => ipcRenderer.send('win:reset'),
  log: (...args) => ipcRenderer.send('app:log', args.map(String).join(' ')),
  debugToggle: (v) => ipcRenderer.send('debug:toggle', v),
  debugDump: (name, dataUrl) => ipcRenderer.send('debug:dump', name, dataUrl),

  onWinState: (cb) => on('win:state', cb),
  onSettings: (cb) => on('settings', cb),
  onCommand: (cb) => on('command', cb),
  onStatus: (cb) => on('status', cb),
  onVisibility: (cb) => on('win:visible', cb),
});

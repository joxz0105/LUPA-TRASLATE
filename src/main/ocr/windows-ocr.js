'use strict';
/**
 * Cliente del helper de PowerShell que usa el OCR nativo de Windows (Windows.Media.Ocr).
 * Un unico proceso persistente: la primera peticion tarda ~150 ms y las siguientes ~50 ms.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const REQUEST_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 12000;

class WindowsOcr {
  /**
   * @param {{ scriptSource: string, workDir: string }} opts
   *   scriptSource: ruta del .ps1 (puede estar dentro del asar); workDir: carpeta escribible
   */
  constructor({ scriptSource, workDir }) {
    this.scriptSource = scriptSource;
    this.workDir = workDir;
    this.proc = null;
    this.ready = null;       // Promise<{langs:string[]}>
    this.langs = [];
    this.pending = new Map();
    this.nextId = 1;
    this.frameNo = 0;
    this.queue = Promise.resolve();
    this.available = process.platform === 'win32';
  }

  _prepareScript() {
    fs.mkdirSync(this.workDir, { recursive: true });
    const dest = path.join(this.workDir, 'windows-ocr.ps1');
    const src = fs.readFileSync(this.scriptSource, 'utf8');
    // BOM UTF-8: Windows PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
    fs.writeFileSync(dest, '﻿' + src, 'utf8');
    return dest;
  }

  start() {
    if (this.ready) return this.ready;
    if (!this.available) return Promise.reject(new Error('Windows OCR solo está disponible en Windows'));

    this.ready = new Promise((resolve, reject) => {
      let script;
      try { script = this._prepareScript(); } catch (e) { reject(e); return; }

      const proc = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });

      const startTimer = setTimeout(() => {
        reject(new Error('El OCR de Windows no arrancó a tiempo. ' + stderr.trim()));
        this.stop();
      }, START_TIMEOUT_MS);

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return; }
        if (msg.ready) {
          clearTimeout(startTimer);
          this.langs = msg.langs || [];
          resolve({ langs: this.langs });
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg); else p.reject(new Error(msg.error || 'Error de OCR'));
      });

      proc.on('error', (err) => {
        clearTimeout(startTimer);
        reject(err);
        if (this.proc === proc) this._reset(err);
      });
      proc.on('exit', (code) => {
        clearTimeout(startTimer);
        const err = new Error(`El OCR de Windows terminó (código ${code}). ${stderr.trim()}`);
        reject(err);
        if (this.proc === proc) this._reset(err);
      });
    });
    // evita "unhandled rejection" si nadie esta esperando
    this.ready.catch(() => {});
    return this.ready;
  }

  _reset(err) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.proc = null;
    this.ready = null;
  }

  stop() {
    const p = this.proc;
    this._reset(new Error('OCR detenido'));
    if (p) { try { p.stdin.end(); } catch (_) { /* nada */ } try { p.kill(); } catch (_) { /* nada */ } }
  }

  /** Envia una peticion al proceso (de una en una) y espera su respuesta. */
  _request(payload) {
    const run = async () => {
      await this.start();
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Tiempo de espera agotado en el OCR de Windows'));
          this.stop(); // se reinicia en la siguiente peticion
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
        this.proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * OCR de un PNG ya capturado.
   * @param {Buffer} png
   * @param {string} langTag etiqueta de Windows, p. ej. "en-US"
   */
  async recognize(png, langTag) {
    const file = path.join(this.workDir, `frame-${this.frameNo++ % 2}.png`);
    await fs.promises.writeFile(file, png);
    return this._request({ cmd: 'ocr', path: file, lang: langTag });
  }

  /**
   * Captura una zona de la pantalla (GDI, sin puntero del ratón) y le hace OCR en el mismo proceso.
   * @param {{x:number,y:number,w:number,h:number}} rect píxeles físicos de pantalla
   */
  recognizeScreen(rect, langTag) {
    return this._request({ cmd: 'ocr-screen', x: rect.x, y: rect.y, w: rect.w, h: rect.h, lang: langTag });
  }

  /** Captura una zona de la pantalla a un PNG (para motores que no son el de Windows). */
  async captureScreen(rect) {
    const file = path.join(this.workDir, 'region.png');
    const r = await this._request({ cmd: 'capture', x: rect.x, y: rect.y, w: rect.w, h: rect.h, save: file });
    return { png: await fs.promises.readFile(file), w: r.w, h: r.h };
  }
}

module.exports = { WindowsOcr };

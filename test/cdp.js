// Mini cliente CDP para inspeccionar la ventana de Lupa en desarrollo.
//   node test/cdp.js eval "<js>"            evalúa JS en el renderizador y muestra el resultado
//   node test/cdp.js shot <salida.png>      captura el contenido del renderizador (con transparencia)
// Requiere arrancar la app con LUPA_DEBUG_PORT=9333
const fs = require('fs');
const PORT = process.env.CDP_PORT || process.env.LUPA_DEBUG_PORT || 9333;
const FILTER = new RegExp(process.env.CDP_FILTER || 'index\.html');

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const t = list.find((x) => x.type === 'page' && FILTER.test(x.url));
  if (!t) throw new Error('No hay ventana de Lupa: ' + JSON.stringify(list.map((x) => x.url)));
  return t;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } };
    ws.onerror = (e) => reject(e);
  });
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const t = await target();
  const c = await connect(t.webSocketDebuggerUrl);
  if (cmd === 'eval') {
    const r = await c.send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails) : JSON.stringify(r.result.value, null, 1));
  } else if (cmd === 'shot') {
    await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const r = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('guardado', arg);
  }
  c.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

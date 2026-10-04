// ¿desktopCapturer.getSources a resolución nativa incluye el cursor? ¿cuánto tarda?
const { app, desktopCapturer, screen } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os');
app.setPath('userData', path.join(os.tmpdir(), 'lupa-thumbtest'));
app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  console.log('display', JSON.stringify(size), 'cursor', JSON.stringify(screen.getCursorScreenPoint()));
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const t1 = Date.now();
    const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
    const img = src.thumbnail;
    const crop = img.crop({ x: 158, y: 140, width: 784, height: 502 });
    const png = crop.toPNG();
    console.log(`run ${i}: getSources ${t1 - t0} ms, thumb ${JSON.stringify(img.getSize())}, crop+png ${Date.now() - t1} ms, ${png.length} bytes`);
    if (i === 0) fs.writeFileSync(path.join(os.tmpdir(), 'thumb-crop.png'), png);
  }
  app.quit();
});

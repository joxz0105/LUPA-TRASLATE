// Captura de pantalla en vivo y recorte de la zona que queda debajo de la lente.
// La ventana de Lupa está excluida de la captura (setContentProtection), así que aquí solo aparece
// lo que hay *detrás* de ella: el texto original.

// El stream solo sirve para detectar cambios y muestrear colores (el OCR usa captura directa de pantalla):
// una resolución moderada ahorra mucha CPU/GPU, sobre todo en pantallas 4K.
const STREAM_MAX_W = 1280;
const STREAM_MAX_H = 800;
const SIG_W = 256;       // ancho de la miniatura usada para detectar cambios
const DIFF_PIXEL = 26;   // diferencia de luminancia (0-255) para considerar que un píxel cambió

export class ScreenCapture {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.sourceId = null;
    this.highRes = false;   // true cuando el OCR depende del fotograma del stream (sin captura directa)

    this.sigCanvas = document.createElement('canvas');
    this.sigCtx = this.sigCanvas.getContext('2d', { willReadFrequently: true });
  }

  get ready() {
    return !!this.stream && this.stream.active && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start(source) {
    if (this.sourceId === source.id && this.stream && this.stream.active) return;
    this.stop();
    // Preferimos getDisplayMedia porque permite excluir el puntero del ratón de la captura
    // (un I-beam sobre el texto se leería como una "I"/"J" dentro de las palabras).
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { cursor: 'never', frameRate: { ideal: 6, max: 8 }, ...(this.highRes ? {} : { width: { max: STREAM_MAX_W }, height: { max: STREAM_MAX_H } }) } });
      this.cursorHidden = true;
    } catch (err) {
      this.cursorHidden = false;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: 8 } },
      });
    }
    this.stream = stream;
    this.sourceId = source.id;
    this.video.srcObject = stream;
    await this.video.play();
    // espera al primer fotograma
    for (let i = 0; i < 60 && !this.ready; i++) await new Promise((r) => setTimeout(r, 50));
    stream.getVideoTracks()[0].addEventListener('ended', () => { this.sourceId = null; });
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.sourceId = null;
    this.video.srcObject = null;
  }

  /** Relación entre píxeles de vídeo y píxeles de pantalla lógicos (DIP) de la pantalla capturada. */
  _k(displayBounds) {
    return this.video.videoWidth / displayBounds.width;
  }

  /**
   * region: { x, y, w, h } en DIP relativos a la esquina superior izquierda de la pantalla.
   * Devuelve un canvas nuevo (píxeles nativos) con lo que hay en esa zona.
   */
  grab(region, displayBounds) {
    const k = this._k(displayBounds);
    const sw = Math.max(1, Math.round(region.w * k));
    const sh = Math.max(1, Math.round(region.h * k));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, Math.round(region.x * k), Math.round(region.y * k), sw, sh, 0, 0, sw, sh);
    return { canvas, ctx, k };
  }

  /** Miniatura en escala de grises para detectar cambios entre fotogramas. */
  signature(region, displayBounds) {
    const k = this._k(displayBounds);
    const sw = Math.max(1, Math.round(region.w * k));
    const sh = Math.max(1, Math.round(region.h * k));
    const w = Math.min(SIG_W, sw);
    const h = Math.max(1, Math.min(180, Math.round((w * sh) / sw)));
    if (this.sigCanvas.width !== w || this.sigCanvas.height !== h) {
      this.sigCanvas.width = w;
      this.sigCanvas.height = h;
    }
    this.sigCtx.drawImage(this.video, Math.round(region.x * k), Math.round(region.y * k), sw, sh, 0, 0, w, h);
    const data = this.sigCtx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
    return { w, h, px: out };
  }
}

/** Fracción (0-1) de píxeles que difieren notablemente entre dos firmas. */
export function signatureDiff(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return 1;
  let n = 0;
  for (let i = 0; i < a.px.length; i++) {
    const d = a.px[i] - b.px[i];
    if (d > DIFF_PIXEL || d < -DIFF_PIXEL) n++;
  }
  return n / a.px.length;
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('No se pudo codificar la captura')); return; }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}

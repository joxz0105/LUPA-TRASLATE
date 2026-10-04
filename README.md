# Lupa — traductor de pantalla en tiempo real

Una **lente flotante** para Windows que lee el texto que hay *debajo* de ella y lo traduce al **español** al instante,
sin copiar ni pegar nada. Colócala sobre documentación, una noticia internacional o cualquier ventana con texto:
la traducción aparece justo encima del original, con su mismo estilo.

100 % gratis · sin cuentas · sin claves de API · requiere Windows 10 (2004 o posterior) o Windows 11.

## Cómo se usa

1. Abre **Lupa** (instalador o portable).
2. **Mueve** la lente arrastrando su barra superior y **ajusta** su tamaño estirando cualquier borde o esquina.
3. Ponla sobre el texto. Lupa lo lee y lo traduce sola; si haces scroll o cambias de página, se actualiza.

Los clics y la rueda del ratón **atraviesan la lente**: puedes seguir usando la página que hay debajo sin mover la ventana.

### La barra

| Control | Qué hace |
|---|---|
| Logo + punto de color | Arrastra para mover. Verde = lista · azul = traduciendo · ámbar = en pausa · rojo = error |
| `Auto → ES` | Idioma del texto original. *Detectar idioma* elige solo el motor adecuado |
| Vista (icono de marco / líneas) | **Lente**: traduce sobre el texto original · **Lectura**: panel limpio para leer cómodo |
| 💧 Transparencia | Desliza para hacer la ventana más o menos traslúcida. Nunca baja del 5 %: el marco y la barra **siempre se ven** |
| ⏸ / ▶ | Pausa la traducción automática (puedes seguir usando *Traducir ahora*) |
| ⟳ | Traducir ahora |
| ⚙ Ajustes | Idioma destino, tema de lectura, tamaño del texto, velocidad, motor de OCR, clics a través, siempre al frente |
| — / ✕ | Ocultar a la bandeja / cerrar |

### Atajos globales

`Ctrl+Alt+L` mostrar/ocultar · `Ctrl+Alt+P` pausar · `Ctrl+Alt+R` traducir ahora · `Ctrl+Alt+M` cambiar vista ·
`Ctrl+Alt+↑/↓` transparencia.

Si otra aplicación ya usa alguno de esos atajos, Lupa elige automáticamente otra tecla libre; los atajos que quedaron
activos se ven en **Ajustes** y en la ayuda de cada botón.

## Cómo funciona

```
 pantalla ──► captura GDI de la zona bajo la lente (sin cursor, la propia lente queda excluida)
          ──► OCR   Windows.Media.Ocr (nativo, ~60 ms)  ·  respaldo: Tesseract.js (cualquier idioma, local)
          ──► análisis de párrafos (separa menús, listas, títulos; ordena columnas)
          ──► traducción por lotes (Google Translate público → MyMemory como respaldo) + caché
          ──► dibujo sobre el original con el color de fondo/letra muestreados de la página
```

* La ventana usa `setContentProtection`, así que **no aparece en capturas** y el OCR siempre ve el texto original.
  (Consecuencia: con Lupa abierta, `Impr Pant` y las grabaciones de pantalla no muestran la lente.)
* Idiomas: inglés, francés, alemán, italiano, portugués, ruso, japonés, chino, coreano, árabe y más.
  Si Windows tiene instalado el OCR de ese idioma se usa (rapidísimo); si no, Lupa descarga **una sola vez** los datos de
  Tesseract (1-3 MB). Con *Detectar idioma*, Lupa mira qué idioma detecta Google y cambia sola de motor.
* Se ignoran el código, las URL y los números (no tiene sentido traducirlos).

## Privacidad y límites (léelo)

* **El texto que se lee se envía a un servicio de traducción en internet** (el endpoint público de Google Translate;
  si falla, MyMemory). Lo único que sale de tu equipo es ese texto, nunca imágenes. Si estás sobre información
  sensible, pausa Lupa (`Ctrl+Alt+P`) u ocúltala. Ese endpoint no es una API oficial: puede limitar el uso o cambiar.
* El OCR es local y no necesita conexión; la traducción sí.
* No lee contenido protegido por DRM (streaming de vídeo) ni juegos en pantalla completa exclusiva.
* El ejecutable **no está firmado** (firmar cuesta dinero): la primera vez Windows SmartScreen mostrará
  «Windows protegió su PC». Pulsa **Más información → Ejecutar de todos modos**.

## Desarrollo

```bash
npm install
npm start          # ejecutar en desarrollo
npm test           # pruebas unitarias (layout del OCR y traducción)
npm run dist       # genera dist/Lupa-Instalador-x.y.z.exe y dist/Lupa-Portable-x.y.z.exe
```

```
src/main/        proceso principal: ventana, atajos, bandeja, IPC
  ocr/           helper de Windows (captura + OCR), Tesseract, análisis de layout (layout.js)
  translate/     proveedores gratuitos con caída automática y caché
src/renderer/    interfaz: barra, ajustes, dibujo del overlay, detección de cambios
test/            pruebas + utilidades para probar con ratón real y capturas
```

Para depurar: `set LUPA_DEBUG=1` muestra el registro; `LUPA_DEBUG_PORT=9333` abre el puerto de depuración de Chromium.

## Solución de problemas

* **«No veo texto en esta zona»** — mueve la lente sobre el texto; evita fondos con imágenes y letra muy pequeña (< 9 px).
* **Traduce mal un idioma que no es inglés** — elígelo en el chip de idioma (arriba) en lugar de *Detectar idioma*.
* **Sin conexión** — la traducción necesita internet; Lupa reintenta sola.
* **El antivirus bloquea el helper de PowerShell** — Lupa lo detecta y cambia sola al motor de respaldo (Tesseract), algo más lenta.
* **Quiero ver la ventana pero está oculta** — `Ctrl+Alt+L` o clic en el icono de la bandeja del sistema.

Licencia MIT. Usa [Electron](https://www.electronjs.org/) y [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0).

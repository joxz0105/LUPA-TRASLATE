// Iconos SVG en línea (estilo trazo, 24x24). Se pintan con currentColor.
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  logo: `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <defs><linearGradient id="lg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#79a6ff"/><stop offset="1" stop-color="#b79bff"/></linearGradient></defs>
    <circle cx="10.5" cy="10.5" r="7" stroke="url(#lg)" stroke-width="2.2"/>
    <path d="M15.8 15.8 21 21" stroke="url(#lg)" stroke-width="2.6"/>
    <path d="M7.6 9.3h5.8M7.6 12h4" stroke="#eaf0ff" stroke-width="1.7"/></svg>`,
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  hide: svg('<path d="M5 12h14"/>'),
  play: svg('<polygon points="7 4.5 19 12 7 19.5 7 4.5" fill="currentColor" stroke-width="1.2"/>'),
  pause: svg('<rect x="6.5" y="4.5" width="3.8" height="15" rx="1" fill="currentColor" stroke-width="1"/><rect x="13.7" y="4.5" width="3.8" height="15" rx="1" fill="currentColor" stroke-width="1"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  settings: svg('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>'),
  droplet: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
  dropletFill: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" fill="currentColor"/>'),
  lensMode: svg('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8.5h8M7 12h10M7 15.5h6"/>'),
  readerMode: svg('<path d="M4 6h16M4 10.5h16M4 15h10M4 19.5h7"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
};

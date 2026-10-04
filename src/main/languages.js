'use strict';
/**
 * Idiomas soportados.
 *  code   : codigo interno (tambien el codigo de Google Translate)
 *  win    : prefijos de etiquetas de idioma de Windows OCR (en minusculas) que sirven para este idioma
 *  tess   : codigo(s) de Tesseract (unidos con "+")
 */
const SOURCE_LANGS = [
  { code: 'auto', label: 'Detectar idioma', win: ['en'], tess: 'eng+fra+deu+ita+por' },
  { code: 'en', label: 'Inglés', win: ['en'], tess: 'eng' },
  { code: 'fr', label: 'Francés', win: ['fr'], tess: 'fra' },
  { code: 'de', label: 'Alemán', win: ['de'], tess: 'deu' },
  { code: 'it', label: 'Italiano', win: ['it'], tess: 'ita' },
  { code: 'pt', label: 'Portugués', win: ['pt'], tess: 'por' },
  { code: 'ru', label: 'Ruso', win: ['ru'], tess: 'rus' },
  { code: 'ja', label: 'Japonés', win: ['ja'], tess: 'jpn' },
  { code: 'zh-CN', label: 'Chino simplificado', win: ['zh-hans', 'zh-cn'], tess: 'chi_sim' },
  { code: 'zh-TW', label: 'Chino tradicional', win: ['zh-hant', 'zh-tw', 'zh-hk'], tess: 'chi_tra' },
  { code: 'ko', label: 'Coreano', win: ['ko'], tess: 'kor' },
  { code: 'ar', label: 'Árabe', win: ['ar'], tess: 'ara' },
  { code: 'nl', label: 'Neerlandés', win: ['nl'], tess: 'nld' },
  { code: 'pl', label: 'Polaco', win: ['pl'], tess: 'pol' },
  { code: 'tr', label: 'Turco', win: ['tr'], tess: 'tur' },
  { code: 'uk', label: 'Ucraniano', win: ['uk'], tess: 'ukr' },
  { code: 'sv', label: 'Sueco', win: ['sv'], tess: 'swe' },
  { code: 'hi', label: 'Hindi', win: ['hi'], tess: 'hin' },
  { code: 'vi', label: 'Vietnamita', win: ['vi'], tess: 'vie' },
  { code: 'id', label: 'Indonesio', win: ['id'], tess: 'ind' },
  { code: 'he', label: 'Hebreo', win: ['he'], tess: 'heb' },
  { code: 'el', label: 'Griego', win: ['el'], tess: 'ell' },
  { code: 'cs', label: 'Checo', win: ['cs'], tess: 'ces' },
  { code: 'ro', label: 'Rumano', win: ['ro'], tess: 'ron' },
  { code: 'th', label: 'Tailandés', win: ['th'], tess: 'tha' },
];

const TARGET_LANGS = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'Inglés' },
  { code: 'pt', label: 'Portugués' },
  { code: 'fr', label: 'Francés' },
  { code: 'de', label: 'Alemán' },
  { code: 'it', label: 'Italiano' },
];

const byCode = (code) => SOURCE_LANGS.find((l) => l.code === code) || SOURCE_LANGS[0];

/**
 * Si Windows no tiene instalado el OCR de un idioma LATINO, otro motor latino lo lee bien y mucho más rápido
 * que Tesseract. Orden de preferencia medido sobre texto real (precisión de palabras, motores en-US / es-ES):
 *   inglés 100/100 · francés 85/85 · alemán 100/82 · italiano 89/95 · portugués 47/94 · neerlandés 100/100.
 * Solo se listan idiomas donde el sustituto rinde bien; para el resto (polaco, turco, cirílico, CJK...) es mejor Tesseract.
 */
const WIN_SUBSTITUTES = {
  auto: ['es'],
  en: ['es'],
  fr: ['en', 'es'],
  de: ['en', 'es'],
  it: ['es', 'en'],
  pt: ['es', 'en'],
  nl: ['en', 'es'],
};

const findTag = (prefix, lower) => {
  const hit = lower.find((t) => t.l === prefix || t.l.startsWith(prefix + '-'));
  return hit ? hit.tag : null;
};

/**
 * Elige el motor de OCR de Windows para `code`.
 * @returns {{ tag: string, exact: boolean } | null} `exact=false` = motor sustituto de otro idioma latino
 */
function pickWindowsEngine(code, availableTags) {
  const lang = byCode(code);
  const lower = availableTags.map((t) => ({ tag: t, l: t.toLowerCase() }));
  for (const prefix of lang.win) {
    const tag = findTag(prefix, lower);
    if (tag) return { tag, exact: true };
  }
  for (const prefix of WIN_SUBSTITUTES[lang.code] || []) {
    const tag = findTag(prefix, lower);
    if (tag) return { tag, exact: false };
  }
  return null;
}

/** Etiqueta del motor propio del idioma (sin sustitutos), o null. Se mantiene por compatibilidad. */
function pickWindowsTag(code, availableTags) {
  const r = pickWindowsEngine(code, availableTags);
  return r && r.exact ? r.tag : null;
}

module.exports = { SOURCE_LANGS, TARGET_LANGS, WIN_SUBSTITUTES, byCode, pickWindowsEngine, pickWindowsTag };

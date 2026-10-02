// User preferences, persisted as `sbx.prefs`. Every stored value is validated on load:
// fonts come from fixed lists because they end up inside CSS and XML.

import { TEXT_STYLES } from './text.js';

export const PREFS_KEY = 'sbx.prefs';
// Bumped when stored prefs need rewriting; mergePrefs migrates anything older (see below).
export const PREFS_SCHEMA = 2;

export const FONTS = ['Calibri', 'Aptos', 'Arial', 'Cambria', 'Georgia', 'Garamond', 'Segoe UI', 'Times New Roman', 'Verdana'];
export const MONO_FONTS = ['Consolas', 'Courier New', 'Cascadia Mono', 'Lucida Console'];
export const SLIDE_FONTS = ['Arial', 'Calibri', 'Aptos', 'Segoe UI', 'Verdana', 'Georgia', 'Tahoma'];
export const FORMATS = ['text', 'word', 'pptx']; // menu order; the first is the default
export const THEMES = {
  dark: { bg: '000000', fg: 'FFFFFF' },
  light: { bg: 'FFFFFF', fg: '000000' },
  navy: { bg: '14213D', fg: 'FFFFFF' },
};

export const DEFAULT_PREFS = {
  schema: PREFS_SCHEMA,
  // `tab` is also the export scope (This song / Set list); `format` is the one chosen in the Export menu.
  ui: { tab: 'song', format: 'text', optsWord: false, optsText: false, optsPptx: false },
  word: { mode: 'chords', font: 'Calibri', sizePt: 12, mono: 'Consolas', chordColor: true, chorusItalic: false, numbers: true, meta: true, comments: true, page: 'letter', pairShort: true },
  text: { style: 'chords', chorusIndent: 4, numbers: true, meta: true, comments: true },
  pptx: { theme: 'dark', bg: '000000', fg: 'FFFFFF', font: 'Arial', maxPt: 44, minPt: 28, maxLines: 8, titleSlides: true, blankBetweenSongs: false, repeatChorus: true, chorusItalic: false, notes: true },
};

const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const color = (v) => (typeof v === 'string' && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : undefined);

const SCHEMA = {
  ui: { tab: oneOf(['song', 'setlist']), format: oneOf(FORMATS), optsWord: bool, optsText: bool, optsPptx: bool },
  word: {
    mode: oneOf(['chords', 'lyrics']), font: oneOf(FONTS), sizePt: int(8, 20), mono: oneOf(MONO_FONTS),
    chordColor: bool, chorusItalic: bool, numbers: bool, meta: bool, comments: bool, page: oneOf(['letter', 'a4']), pairShort: bool,
  },
  text: { style: oneOf(TEXT_STYLES), chorusIndent: int(2, 8), numbers: bool, meta: bool, comments: bool },
  pptx: {
    theme: oneOf([...Object.keys(THEMES), 'custom']), bg: color, fg: color, font: oneOf(SLIDE_FONTS),
    maxPt: int(24, 72), minPt: int(16, 72), maxLines: int(2, 16),
    titleSlides: bool, blankBetweenSongs: bool, repeatChorus: bool, chorusItalic: bool, notes: bool,
  },
};

export function mergePrefs(stored) {
  const out = structuredClone(DEFAULT_PREFS);
  if (!stored || typeof stored !== 'object') return out;
  // Schema 1 (up to 0.2): the format WAS the tab (word/text/pptx, beside a Set list tab) and a
  // separate `scope` switch chose this song or the set list. Keep the format, and land on the
  // Set list tab if either the old tab or the old scope was the set list.
  const schema = Number.isInteger(stored.schema) ? stored.schema : 1;
  if (schema < 2 && stored.ui && typeof stored.ui === 'object') {
    const ui = { ...stored.ui };
    if (FORMATS.includes(ui.tab)) ui.format = ui.tab;
    ui.tab = ui.tab === 'setlist' || ui.scope === 'setlist' ? 'setlist' : 'song';
    stored = { ...stored, ui };
  }
  for (const [section, fields] of Object.entries(SCHEMA)) {
    const src = stored[section];
    if (!src || typeof src !== 'object') continue;
    for (const [field, check] of Object.entries(fields)) {
      const v = check(src[field]);
      if (v !== undefined) out[section][field] = v;
    }
  }
  if (out.pptx.minPt > out.pptx.maxPt) out.pptx.minPt = out.pptx.maxPt;
  if (out.pptx.theme !== 'custom') Object.assign(out.pptx, THEMES[out.pptx.theme]);
  return out;
}

export function createPrefsStore(area) {
  let current = structuredClone(DEFAULT_PREFS);
  return {
    async load() {
      current = mergePrefs(await area.get(PREFS_KEY));
      return current;
    },
    get: () => current,
    async update(section, patch) {
      current = mergePrefs({ ...current, [section]: { ...current[section], ...patch } });
      await area.set(PREFS_KEY, current);
      return current;
    },
    subscribe(cb) {
      return area.subscribe(PREFS_KEY, (v) => {
        current = mergePrefs(v);
        cb(current);
      });
    },
  };
}

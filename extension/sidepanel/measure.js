// Text width in inches using the real installed font, for slide font-size fitting and for
// working out how Word will wrap lines (page planning).
import { MONO_FONTS } from '../shared/prefs.js';

let ctx = null;

export function canvasMeasure(text, pt, { font = 'Arial', bold = false, italic = false } = {}) {
  ctx ||= document.createElement('canvas').getContext('2d');
  // A missing fixed-width font should fall back to a fixed-width one, not a proportional one.
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px "${font}", ${MONO_FONTS.includes(font) ? 'monospace' : 'sans-serif'}`;
  return ((ctx.measureText(text).width / 100) * pt) / 72;
}

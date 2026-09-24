// Text width in inches using the real installed font, for slide font-size fitting.
let ctx = null;

export function canvasMeasure(text, pt, { font = 'Arial', bold = false, italic = false } = {}) {
  ctx ||= document.createElement('canvas').getContext('2d');
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px "${font}", sans-serif`;
  return ((ctx.measureText(text).width / 100) * pt) / 72;
}

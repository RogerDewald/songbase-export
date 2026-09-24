// Builds the .pptx from a slide plan with PptxGenJS (passed in: the vendored browser build
// in the panel, the npm package in Node tests).

import { planDeck, TEXT_BOX, SUBTITLE_PT, DECK_DEFAULTS } from './slides.js';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const hex = (c) => String(c || '').replace(/^#/, '').toUpperCase();

// Subtitle colour: 65% of the way from background to foreground.
function mix(bg, fg, t = 0.65) {
  const a = hex(bg).match(/../g).map((h) => parseInt(h, 16));
  const b = hex(fg).match(/../g).map((h) => parseInt(h, 16));
  return a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function buildPresentation(PptxGenJS, plan, prefs = {}) {
  const o = { ...DECK_DEFAULTS, ...prefs };
  const bg = hex(o.bg);
  const fg = hex(o.fg);
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  if (o.docTitle) pres.title = o.docTitle;

  for (const slide of plan.slides) {
    const s = pres.addSlide();
    s.background = { color: bg };
    if (slide.kind === 'title') {
      s.addText(slide.title, {
        x: TEXT_BOX.x, y: 1.6, w: TEXT_BOX.w, h: 2.7,
        align: 'center', valign: 'bottom', margin: 0,
        fontFace: o.font, fontSize: slide.titlePt, bold: true, color: fg, fit: 'shrink',
      });
      if (slide.subtitle) {
        s.addText(slide.subtitle, {
          x: TEXT_BOX.x, y: 4.55, w: TEXT_BOX.w, h: 0.9,
          align: 'center', valign: 'top', margin: 0,
          fontFace: o.font, fontSize: SUBTITLE_PT, color: mix(bg, fg), fit: 'shrink',
        });
      }
    } else if (slide.kind === 'lyrics') {
      const runs = [];
      slide.lines.forEach((line, li) => {
        const last = li === slide.lines.length - 1;
        line.runs.forEach((r, ri) => {
          const options = {};
          if (r.b) options.bold = true;
          if (r.i || line.italic) options.italic = true;
          if (!last && ri === line.runs.length - 1) options.breakLine = true;
          runs.push({ text: r.text, options });
        });
      });
      s.addText(runs, {
        ...TEXT_BOX,
        align: 'center', valign: 'middle', margin: 0,
        fontFace: o.font, fontSize: slide.pt, color: fg,
        lineSpacingMultiple: o.lineSpacing,
        fit: 'shrink', // safety net only: PowerPoint applies it after an edit
      });
      if (slide.notes) s.addNotes(slide.notes);
    }
  }
  return pres;
}

export async function renderPptx(PptxGenJS, songs, prefs = {}, measure = undefined, outputType = 'blob') {
  const plan = planDeck(songs, prefs, measure);
  const pres = buildPresentation(PptxGenJS, plan, prefs);
  let data = await pres.write({ outputType, compression: true });
  // PptxGenJS labels its Blob application/zip; give it the real PowerPoint type.
  if (outputType === 'blob' && typeof Blob !== 'undefined') data = new Blob([data], { type: PPTX_MIME });
  return { data, plan };
}

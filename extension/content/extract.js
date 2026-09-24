// Reads the song currently displayed on songbase.life into a raw Song IR.
//
// Classic script (content scripts cannot be ES modules); exposes globalThis.SBX_extract.
// It reads the RENDERED page on purpose: the output then follows the user's current
// transpose, selected tune and chord visibility exactly.
//
// Songbase renders `div.lyrics` from a string (dangerouslySetInnerHTML):
//   div.song-controls                         (bookmark, share, transpose ...) - skipped
//   div.comment | div.transpose-preset.comment[data-capo]
//   br                                        one per blank source line = group break
//   div.stanza  > div.stanza-number[data-uncopyable-text], div.line ...
//   div.chorus  > div.line ...                (the first two spaces became a leading "\t")
//   div.line                                  a source line starting with ONE space
// Inside a line: text, span.chord-word, span.chord[data-uncopyable-text] (empty, at the
// exact character offset), b / i, span.musical-tie. Chords and verse numbers are CSS
// ::after content, which is why ordinary copy/paste from the site loses them.
(function () {
  'use strict';

  const ATTR = 'data-uncopyable-text';
  const SKIP = ['song-controls', 'tune-selector', 'tune-select-box'];

  function parseLine(el, isChorus) {
    let text = '';
    const chords = [];
    const marks = [];
    (function walk(node, bold, italic) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const from = text.length;
          text += child.nodeValue;
          if ((bold || italic) && text.length > from) {
            marks.push(Object.assign({ from, to: text.length }, bold ? { b: true } : {}, italic ? { i: true } : {}));
          }
        } else if (child.nodeType === 1) {
          if (child.classList.contains('chord')) {
            const name = (child.getAttribute(ATTR) || '').trim();
            if (name) chords.push({ at: text.length, name });
            continue;
          }
          if (child.classList.contains('stanza-number')) continue;
          const tag = child.tagName;
          walk(child, bold || tag === 'B' || tag === 'STRONG', italic || tag === 'I' || tag === 'EM');
        }
      }
    })(el, false, false);

    if (isChorus && text.charAt(0) === '\t') {
      text = text.slice(1);
      for (const c of chords) c.at = Math.max(0, c.at - 1);
      for (const m of marks) {
        m.from = Math.max(0, m.from - 1);
        m.to = Math.max(0, m.to - 1);
      }
    }
    return { text, chords, marks: marks.filter((m) => m.to > m.from) };
  }

  function commentPart(el) {
    const capo = el.getAttribute('data-capo');
    return {
      type: 'comment',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      capo: capo !== null && capo !== '' && !isNaN(Number(capo)) ? Number(capo) : null,
    };
  }

  // A stanza/chorus block. Normally only lines (plus one verse number), but a non-#
  // "capo N" line is turned into a comment INSIDE the block, so split around comments.
  function blockParts(el, type, stats) {
    const parts = [];
    let current = null;
    let number = null;
    for (const child of el.children) {
      const cl = child.classList;
      if (cl.contains('stanza-number')) {
        number = child.getAttribute(ATTR);
        stats.numbers++;
        continue;
      }
      if (cl.contains('line')) {
        if (!current) {
          current = { type, lines: [] };
          if (number !== null) {
            current.number = number;
            number = null;
          }
          parts.push(current);
        }
        current.lines.push(parseLine(child, type === 'chorus'));
        continue;
      }
      if (cl.contains('comment')) {
        parts.push(commentPart(child));
        current = null;
        continue;
      }
      const text = (child.textContent || '').trim();
      if (text) {
        parts.push({ type: 'comment', text });
        stats.unknown.push(`${child.tagName.toLowerCase()}.${child.className || ''}`);
      }
      current = null;
    }
    return parts;
  }

  function extract(doc, loc, storage) {
    doc = doc || document;
    loc = loc || location;
    const idMatch = /^\/(\d+)(?:\/|$)/.exec(loc.pathname || '');
    if (!idMatch) return { ok: false, reason: 'not-song' };
    const root = doc.querySelector('.lyrics');
    if (!root) return { ok: false, reason: 'loading' };

    const stats = { numbers: 0, unknown: [] };
    const groups = [];
    let group = null;
    const push = (parts) => {
      if (!parts.length) return;
      if (!group) {
        group = { parts: [] };
        groups.push(group);
      }
      group.parts.push(...parts);
    };

    for (const el of root.children) {
      const cl = el.classList;
      if (el.tagName === 'BR') {
        group = null;
        continue;
      }
      if (SKIP.some((c) => cl.contains(c))) continue;
      if (cl.contains('comment')) push([commentPart(el)]);
      else if (cl.contains('stanza')) push(blockParts(el, 'stanza', stats));
      else if (cl.contains('chorus')) push(blockParts(el, 'chorus', stats));
      else if (cl.contains('line')) push([{ type: 'stanza', lines: [parseLine(el, false)] }]);
      else {
        const text = (el.textContent || '').trim();
        if (text) {
          push([{ type: 'comment', text }]);
          stats.unknown.push(`${el.tagName.toLowerCase()}.${el.className || ''}`);
        }
      }
    }

    // Self-check against the raw DOM: anything the walk above did not account for means
    // Songbase changed its markup, and the user must hear about it.
    const warnings = [];
    let lineCount = 0;
    let chordCount = 0;
    for (const g of groups) {
      for (const p of g.parts) {
        if (!p.lines) continue;
        lineCount += p.lines.length;
        for (const l of p.lines) chordCount += l.chords.length;
      }
    }
    const domLines = root.querySelectorAll('.line').length;
    let domChords = 0;
    for (const c of root.querySelectorAll('.chord')) if ((c.getAttribute(ATTR) || '').trim()) domChords++;
    const domNumbers = root.querySelectorAll('.stanza-number').length;
    if (domLines !== lineCount) warnings.push(`self-check: ${domLines} lines on the page, ${lineCount} read`);
    if (domChords !== chordCount) warnings.push(`self-check: ${domChords} chords on the page, ${chordCount} read`);
    if (domNumbers !== stats.numbers) warnings.push(`self-check: ${domNumbers} verse numbers on the page, ${stats.numbers} read`);
    if (stats.unknown.length) warnings.push(`unknown elements kept as comments: ${stats.unknown.join(', ')}`);

    if (!lineCount) {
      const siteError = /ERROR/.test(root.textContent || '');
      return { ok: false, reason: siteError ? 'site-error' : 'empty' };
    }

    let chordsHidden = false;
    try {
      chordsHidden = (storage || window.localStorage).getItem('showChords') === 'false';
    } catch (e) {
      /* storage unavailable: assume the default (chords shown) */
    }
    const tv = root.querySelector('.transpose-value');
    const transpose = tv ? parseInt(tv.textContent, 10) : 0;
    let tune = null;
    try {
      tune = new URLSearchParams(loc.search || '').get('tune');
    } catch (e) {
      /* ignore */
    }

    return {
      ok: true,
      song: {
        id: Number(idMatch[1]),
        url: loc.href,
        tune,
        title: (doc.title || '').trim(),
        transpose: isNaN(transpose) ? 0 : transpose,
        chordsHidden,
        books: [],
        warnings,
        groups,
      },
    };
  }

  globalThis.SBX_extract = extract;
})();

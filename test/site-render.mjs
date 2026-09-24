// Test-only port of Songbase's own `getLyricsHTML` pipeline (from the site's JS bundle),
// used to build DOM fixtures for the extractor from placeholder markup. The live-site
// check (tools/live-check.js) is what proves the extractor against the REAL page.

const regex = {
  capo: /.*capo (\d+).*/i,
  capoComment: /.*capo (\d+).*\n\n?/gi,
  tuneComment: /#.*tune.*\n\n?/gi,
  comment: /^# ?(.*)/,
  chordWords: /([^>\s]*\[[^\]]*?\][^\s<]*)/g,
  chords: /\[(.*?)\]/g,
  choruses: /(\n|^)(( {2}.*(?:\n|$))+)/g,
  stanzas: /(^|\n)(([^ #\n].*(\n|$))+)/g,
  hasChords: /.*\[.*\].*/,
  boldText: /\*\*(.+?)\*\*/g,
  italicText: /\*(.+?)\*/g,
  stanzaNumber: /^([0-9]+)$/,
  emptyLine: /^$/,
  tagLine: /^(<[^>]+>)$/,
};

const CONTROLS = `<div class='song-controls'>
  <div class='bookmark'><svg></svg></div>
  <div class='share-song' id='share-song'><div class='share-song-success' id='share-song-success'>Copied!</div><svg></svg></div>
  <div class='transpose-controls'><button id='transpose-up' class='transpose-symbol'>+</button><div class='transpose-value'>0</div><button id='transpose-down' class='transpose-symbol'>-</button></div>
</div>
`;

export function renderLyricsHtml(lyrics, { showChords = true, transposeChord = (c) => c } = {}) {
  let t = lyrics;
  const stanzas = (s) => s.replace(regex.stanzas, "$1<div class='stanza'>\n$2</div>\n");
  const choruses = (s) => s.replace(regex.choruses, "$1<div class='chorus'>\n$2</div>\n");
  const withoutMusic = (s) => s.replace(regex.chords, '').replace(regex.capoComment, '').replace(regex.tuneComment, '');
  const number = (n, withChords) => `<div class='stanza-number ${withChords ? 'with-chords' : ''}' data-uncopyable-text='${n}'></div>`;
  const capo = (s) => s.replace(regex.capo, "<div class='transpose-preset comment' data-capo='$1'>Capo $1</div>");
  const comment = (s) => s.replace(regex.comment, "<div class='comment'>$1</div>");
  const lineDiv = (s) => `<div class='line'>${s}</div>`;
  const tab = (s) => s.replace(/^ {2}/, '\t');
  const chordWords = (s) => s.replace(regex.chordWords, "<span class='chord-word'>$1</span>");
  const chordSpans = (s) =>
    chordWords(s).replace(regex.chords, (m, name) => `<span class='chord' data-uncopyable-text='${transposeChord(name)}'></span>`);
  const format = (s) => s.replace(regex.boldText, '<b>$1</b>').replace(regex.italicText, '<i>$1</i>');
  const ties = (s) => s.replace(/_/g, "<span class='musical-tie'>‿</span>");
  const plain = (s) => {
    let out = lineDiv(tab(s));
    if (regex.hasChords.test(out) && showChords) out = chordSpans(out);
    return out;
  };
  const mapLine = (s, i, all) =>
    regex.capo.test(s) ? capo(s)
      : regex.comment.test(s) ? comment(s)
        : regex.stanzaNumber.test(s) ? number(s, regex.hasChords.test(all[i + 1]))
          : regex.tagLine.test(s) ? s
            : regex.emptyLine.test(s) ? '<br>'
              : plain(s);

  t = choruses(stanzas(t));
  if (!showChords) t = withoutMusic(t);
  t = ties(format(t.split('\n').map(mapLine).join('\n')));
  return CONTROLS + t;
}

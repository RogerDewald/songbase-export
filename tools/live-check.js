// Live-site check for extension/content/extract.js.
// The source-normalising rules follow Songbase's own markup parsing
// (https://github.com/ReganRyanNZ/songbase, Copyright (c) 2017 Regan Ryan, MIT License;
// full notice in THIRD_PARTY_NOTICES.md).
//
// Paste extract.js and then this file into DevTools (or any page-context JS runner) on a
// songbase.life page, then run:  await SBX_liveCheck({ sample: 30 })
// Each song is loaded in a hidden same-origin iframe, extracted with the REAL extractor
// and compared against the site's own source from /api/v2/app_data. It reports counts
// and song ids only — no lyric text leaves the page (diffs are letter-masked).
window.SBX_liveCheck = async function ({ ids = null, sample = 30, seed = 7, perSongTimeoutMs = 9000 } = {}) {
  if (typeof globalThis.SBX_extract !== 'function') throw new Error('Load extension/content/extract.js first');
  const data = await (await fetch('/api/v2/app_data?updated_at=&language=english')).json();
  const byId = new Map(data.songs.map((s) => [s.id, s]));
  const songs = data.songs;

  const pick = (pred, n) => songs.filter(pred).slice(0, n).map((s) => s.id);
  let list = ids;
  if (!list) {
    let x = seed;
    const random = [];
    while (random.length < sample) {
      x = (x * 1103515245 + 12345) % 2147483648;
      const id = songs[x % songs.length].id;
      if (!random.includes(id)) random.push(id);
    }
    const features = {
      multiTune: pick((s) => /^###/m.test(s.lyrics) && /\[/.test(s.lyrics), 3),
      capo: pick((s) => /capo \d/i.test(s.lyrics) && /\[/.test(s.lyrics), 3),
      compound: pick((s) => /\[[^\]]*[-/ ][^\]]*\]/.test(s.lyrics), 3),
      refrainInVerse: pick((s) => /^[^ #\n].*\n {2}\S.*\n[^ #\n]/m.test(s.lyrics), 3),
      noChords: pick((s) => !/\[/.test(s.lyrics) && /^\d+$/m.test(s.lyrics), 3),
      bold: pick((s) => /\*\*[^*]+\*\*/.test(s.lyrics), 3),
      ties: pick((s) => /_/.test(s.lyrics) && /\[/.test(s.lyrics), 3),
      singleSpace: pick((s) => /^ \S/m.test(s.lyrics), 3),
      bigNumbers: pick((s) => /^1\d$/m.test(s.lyrics), 2),
    };
    list = [...new Set([...random, ...Object.values(features).flat()])];
  }

  const normSource = (lyrics) => {
    let tune = lyrics.split(/(?=###)/).filter((t) => t.length > 0)[0] || '';
    tune = tune.replace(/###.*\n/, '');
    const out = [];
    for (let l of tune.split('\n')) {
      if (/^\s*$/.test(l) || /.*capo (\d+).*/i.test(l) || /^# ?(.*)/.test(l) || /^([0-9]+)$/.test(l)) continue;
      l = l.replace(/^ {2}/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
      l = l.replace(/_/g, '‿').replace(/\[\s*\]/g, '').replace(/\s+$/, '');
      if (l.length) out.push(l);
    }
    return out;
  };
  const inline = (song) => {
    const out = [];
    for (const g of song.groups) {
      for (const p of g.parts) {
        if (!p.lines) continue;
        for (const l of p.lines) {
          let s = l.text;
          const cs = l.chords.map((c, i) => ({ ...c, i })).sort((a, b) => b.at - a.at || b.i - a.i);
          for (const c of cs) s = s.slice(0, c.at) + `[${c.name}]` + s.slice(c.at);
          s = s.replace(/\s+$/, '');
          if (s.length) out.push(s);
        }
      }
    }
    return out;
  };
  const mask = (s) => (s == null ? null : s.replace(/(\[[^\]]*\])|[A-Za-zÀ-ɏ]/g, (m, chord) => chord || 'w'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:700px';
  document.body.appendChild(frame);
  const load = (id) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, perSongTimeoutMs);
      frame.onload = () => {
        clearTimeout(t);
        resolve();
      };
      frame.src = `/${id}`;
    });
  const extractFrame = () => globalThis.SBX_extract(frame.contentDocument, frame.contentWindow.location, frame.contentWindow.localStorage);
  const waitRendered = async () => {
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      const root = frame.contentDocument && frame.contentDocument.querySelector('.lyrics');
      if (root && (root.querySelector('.line') || /ERROR/.test(root.textContent))) return true;
    }
    return false;
  };

  const summary = { checked: 0, pass: 0, fail: 0, siteError: 0, notRendered: 0 };
  const failures = [];
  let transposeProbe = null;
  for (const id of list) {
    const src = byId.get(id);
    if (!src) continue;
    summary.checked++;
    await load(id);
    if (!(await waitRendered())) {
      summary.notRendered++;
      failures.push({ id, why: 'not rendered' });
      continue;
    }
    const res = extractFrame();
    if (!res.ok) {
      if (res.reason === 'site-error') summary.siteError++;
      else failures.push({ id, why: res.reason });
      continue;
    }
    const want = normSource(src.lyrics);
    const got = inline(res.song);
    let at = -1;
    for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) { at = i; break; }
    if (at >= 0 || res.song.warnings.length) {
      summary.fail++;
      failures.push({ id, why: at >= 0 ? 'round-trip' : 'warnings', warnings: res.song.warnings, at, want: mask(want[at]), got: mask(got[at]) });
    } else {
      summary.pass++;
      if (!transposeProbe && /\[/.test(src.lyrics) && !/^###/m.test(src.lyrics)) transposeProbe = id;
    }
  }

  // Transpose and chord-visibility behaviour on one song with chords.
  const behaviour = {};
  if (transposeProbe) {
    await load(transposeProbe);
    await waitRendered();
    const base = extractFrame().song;
    const texts = (s) => s.groups.flatMap((g) => g.parts.flatMap((p) => (p.lines || []).map((l) => l.text)));
    const chords = (s) => s.groups.flatMap((g) => g.parts.flatMap((p) => (p.lines || []).flatMap((l) => l.chords.map((c) => `${c.at}:${c.name}`))));
    frame.contentDocument.querySelector('#transpose-up').click();
    await sleep(300);
    const up = extractFrame().song;
    behaviour.transpose = {
      id: transposeProbe,
      transposeValue: up.transpose,
      textUnchanged: JSON.stringify(texts(up)) === JSON.stringify(texts(base)),
      sameChordCount: chords(up).length === chords(base).length,
      chordsChanged: JSON.stringify(chords(up)) !== JSON.stringify(chords(base)),
    };
    frame.contentDocument.querySelector('#transpose-down').click();
    await sleep(300);
    behaviour.transpose.restored = extractFrame().song.transpose === 0;

    const toggle = frame.contentDocument.querySelector('#show-music-controls');
    if (toggle) {
      toggle.click();
      await sleep(300);
      const hidden = extractFrame().song;
      behaviour.chordsHidden = {
        flag: hidden.chordsHidden,
        noChords: chords(hidden).length === 0,
        sameLineCount: texts(hidden).length === texts(base).length,
      };
      frame.contentDocument.querySelector('#show-music-controls').click();
      await sleep(300);
      behaviour.chordsHidden.restored = extractFrame().song.chordsHidden === false;
    }
  }
  frame.remove();
  return { summary, behaviour, failures };
};

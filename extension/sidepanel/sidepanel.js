// Side panel: shows the current Songbase song (or the set list) and exports it.

import { normalizeSong, metaItems, songSig } from '../shared/ir.js';
import { chromeArea } from '../shared/storage.js';
import { createPrefsStore, FONTS, MONO_FONTS, SLIDE_FONTS } from '../shared/prefs.js';
import { createSetListStore } from '../shared/setlist.js';
import { renderWordHtml, renderWordPreview } from '../shared/html.js';
import { renderText } from '../shared/text.js';
import { renderDocx } from '../shared/docx.js';
import { renderPptx } from '../shared/pptx.js';
import { planDeck, SLIDE, TEXT_BOX } from '../shared/slides.js';
import { safeFileName, isoDate } from '../shared/filename.js';
import { createTabLink } from './link.js';
import { copyRich } from './clipboard.js';
import { downloadBlob } from './download.js';
import { canvasMeasure } from './measure.js';

const chromeApi = globalThis.chrome;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const CHOICES = { FONTS, MONO_FONTS, SLIDE_FONTS };

const area = chromeArea(chromeApi);
const prefsStore = createPrefsStore(area);
const setList = createSetListStore(area);

const state = {
  song: null,
  status: 'connecting',
  tabId: null,
  payload: { word: null, text: null },
  pendingDuplicate: null,
  busy: false,
};

const STATUS_TITLES = {
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  'no-tab': 'No active tab',
  'not-songbase': 'Open a song on songbase.life',
  'not-song': 'Open a song to export it',
  loading: 'Waiting for the song to load…',
  'no-content-script': 'Reload the Songbase tab',
  'site-error': 'Songbase shows an error for this song',
  empty: 'This song has no lines to export',
};

// ---------------------------------------------------------------- small helpers

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}

let toastTimer = null;
function toast(message, kind = 'ok') {
  const t = $('#toast');
  t.textContent = message;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function effectiveScope(prefs) {
  if (prefs.ui.tab === 'setlist') return 'setlist';
  return state.song ? prefs.ui.scope : 'setlist';
}

function songsInScope(prefs) {
  if (effectiveScope(prefs) === 'setlist') return setList.get().items.map((i) => i.song);
  return state.song ? [state.song] : [];
}

function baseName(prefs) {
  const songs = songsInScope(prefs);
  if (effectiveScope(prefs) === 'setlist') return `${setList.get().name} ${isoDate()}`;
  return songs[0]?.title || 'song';
}

// ---------------------------------------------------------------- option controls

function buildSelects() {
  for (const select of $$('select[data-choices]')) {
    for (const name of CHOICES[select.dataset.choices]) select.append(el('option', { value: name }, name));
  }
  for (const select of $$('select[data-range]')) {
    const [lo, hi] = select.dataset.range.split('-').map(Number);
    const step = Number(select.dataset.step || 1);
    for (let v = lo; v <= hi; v += step) select.append(el('option', { value: String(v) }, String(v)));
  }
}

function readControl(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.dataset.type === 'int') return parseInt(input.value, 10);
  if (input.dataset.type === 'color') return input.value.replace('#', '').toUpperCase();
  return input.value;
}

function syncControls(prefs) {
  for (const input of $$('[data-pref]')) {
    const [section, field] = input.dataset.pref.split('.');
    const value = prefs[section][field];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.dataset.type === 'color') input.value = `#${value}`;
    else {
      // Keep an out-of-list value selectable (e.g. an even size in an odd-step list).
      if (input.tagName === 'SELECT' && ![...input.options].some((o) => o.value === String(value))) {
        input.append(el('option', { value: String(value) }, String(value)));
      }
      input.value = String(value);
    }
  }
  for (const row of $$('[data-show-when]')) {
    const [path, expected] = row.dataset.showWhen.split('=');
    const [section, field] = path.split('.');
    row.hidden = String(prefs[section][field]) !== expected;
  }
}

// ---------------------------------------------------------------- painting

function paintHeader() {
  const s = state.song;
  const title = $('#song-title');
  const meta = $('#song-meta');
  const eyebrow = $('#status-line');
  if (s) {
    title.textContent = s.title;
    meta.textContent = metaItems(s, { chords: true }).join(' · ');
    eyebrow.textContent = s.transpose ? `Current song · transposed ${s.transpose > 0 ? '+' : ''}${s.transpose}` : 'Current song';
  } else {
    title.textContent = STATUS_TITLES[state.status] || 'Songbase Export';
    meta.textContent = state.status === 'not-songbase' || state.status === 'not-song' ? 'Your set list is still available below.' : '';
    eyebrow.textContent = 'Songbase Export';
  }
  $('#add-to-set').disabled = !s;

  const banner = $('#banner');
  const action = $('#banner-action');
  action.hidden = true;
  action.onclick = null;
  if (state.status === 'no-content-script') {
    $('#banner-text').textContent = 'This tab was open before the extension started. Reload it to connect.';
    action.textContent = 'Reload tab';
    action.hidden = false;
    action.onclick = () => chromeApi.tabs.reload(state.tabId);
    banner.dataset.kind = 'warn';
    banner.hidden = false;
  } else if (s && s.warnings.length) {
    $('#banner-text').textContent = "Songbase's page looks different than expected. Check the output before using it.";
    banner.title = s.warnings.join('\n');
    banner.dataset.kind = 'warn';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function paintTabs(prefs) {
  for (const tab of $$('[role="tab"]')) {
    const selected = tab.dataset.tab === prefs.ui.tab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of $$('[role="tabpanel"]')) panel.hidden = panel.dataset.panel !== prefs.ui.tab;
  const count = setList.get().items.length;
  $('#set-count').textContent = String(count);
  $('#scope-count').textContent = String(count);

  const scopeBar = $('#scope');
  scopeBar.hidden = prefs.ui.tab === 'setlist';
  const scope = effectiveScope(prefs);
  for (const b of $$('[data-scope]', scopeBar)) {
    b.setAttribute('aria-checked', String(b.dataset.scope === scope));
    b.disabled = b.dataset.scope === 'song' && !state.song;
  }
}

function chordHint(prefs) {
  if (effectiveScope(prefs) !== 'song' || !state.song) return '';
  if (state.song.chordsHidden) return "Chords are hidden on Songbase. Turn them on with Songbase's ♫ button to include them.";
  if (!state.song.hasChords) return 'This song has no chords, so it exports as lyrics.';
  return '';
}

function setActions(panelName, enabled) {
  for (const b of $$(`[data-panel="${panelName}"] [data-action]`)) b.disabled = !enabled || state.busy;
}

function emptyNote(prefs) {
  return effectiveScope(prefs) === 'setlist'
    ? 'Your set list is empty. Add songs with “+ Set list” while viewing them on Songbase.'
    : 'Open a song on songbase.life to see a preview.';
}

function paintWord(prefs, songs) {
  const panel = $('[data-panel="word"]');
  const hint = $('[data-hint="chords"]', panel);
  hint.textContent = chordHint(prefs);
  hint.hidden = !hint.textContent;
  const anyChords = songs.some((s) => s.hasChords);
  $('[data-pref="word.mode"] option[value="chords"]').disabled = !anyChords;
  const target = $('#preview-word');
  if (!songs.length) {
    target.replaceChildren(el('p', { class: 'empty' }, emptyNote(prefs)));
    state.payload.word = null;
    return setActions('word', false);
  }
  // Every piece of song text in this HTML went through escapeHtml in the renderer.
  target.innerHTML = renderWordPreview(songs, prefs.word);
  const style = anyChords && prefs.word.mode === 'chords' ? 'chords' : 'lyrics';
  state.payload.word = {
    html: renderWordHtml(songs, prefs.word),
    text: renderText(songs, { style, numbers: prefs.word.numbers, meta: prefs.word.meta, comments: prefs.word.comments }),
  };
  setActions('word', true);
}

function paintText(prefs, songs) {
  const panel = $('[data-panel="text"]');
  const hint = $('[data-hint="chords"]', panel);
  hint.textContent = prefs.text.style === 'lyrics' ? '' : chordHint(prefs);
  hint.hidden = !hint.textContent;
  const target = $('#preview-text');
  if (!songs.length) {
    target.textContent = emptyNote(prefs);
    state.payload.text = null;
    return setActions('text', false);
  }
  const text = renderText(songs, prefs.text);
  target.textContent = text.replace(/\r\n/g, '\n');
  state.payload.text = { text };
  setActions('text', true);
}

function slideThumb(slide, index, prefs, k) {
  const box = el('div', {
    class: 'slide-box',
    style: `left:${(TEXT_BOX.x / SLIDE.w) * 100}%;top:${(TEXT_BOX.y / SLIDE.h) * 100}%;width:${(TEXT_BOX.w / SLIDE.w) * 100}%;height:${(TEXT_BOX.h / SLIDE.h) * 100}%`,
  });
  if (slide.kind === 'title') {
    box.classList.add('is-title');
    box.append(el('div', { class: 'slide-title', style: `font-size:${slide.titlePt * k}px` }, slide.title));
    if (slide.subtitle) box.append(el('div', { class: 'slide-sub', style: `font-size:${28 * k}px` }, slide.subtitle));
  } else if (slide.kind === 'lyrics') {
    for (const line of slide.lines) {
      box.append(el('div', { class: `slide-line${line.italic ? ' is-italic' : ''}${slide.wraps ? ' wraps' : ''}`, style: `font-size:${slide.pt * k}px` }, line.text));
    }
  }
  return el(
    'figure',
    { class: 'slide', style: `background:#${prefs.pptx.bg};color:#${prefs.pptx.fg};font-family:'${prefs.pptx.font}',sans-serif` },
    box,
    el('figcaption', {}, String(index + 1)),
  );
}

function paintSlides(prefs, songs) {
  const target = $('#preview-slides');
  const summary = $('#pptx-summary');
  if (!songs.length) {
    target.replaceChildren(el('p', { class: 'empty' }, emptyNote(prefs)));
    summary.textContent = '';
    return setActions('pptx', false);
  }
  const plan = planDeck(songs, prefs.pptx, canvasMeasure);
  const lyricSlides = plan.slides.filter((s) => s.kind === 'lyrics');
  const sizes = [...new Set(lyricSlides.map((s) => s.pt))];
  summary.textContent = `${plan.slides.length} slide${plan.slides.length === 1 ? '' : 's'} · text ${sizes.length === 1 ? `${sizes[0]}pt` : `${Math.min(...sizes)}–${Math.max(...sizes)}pt`}` +
    (plan.warnings.length ? ` · ${plan.warnings.join('; ')}` : '');
  summary.dataset.kind = plan.warnings.length ? 'warn' : '';
  // Thumbnail scale: CSS px per point at the thumbnail's width.
  const width = Math.max(120, (target.clientWidth - 8) / 2);
  const k = width / (SLIDE.w * 72);
  target.replaceChildren(...plan.slides.map((s, i) => slideThumb(s, i, prefs, k)));
  setActions('pptx', true);
}

function paintSetList() {
  const sl = setList.get();
  const name = $('#setlist-name');
  if (document.activeElement !== name) name.value = sl.name;
  const list = $('#setlist-items');
  list.replaceChildren(
    ...sl.items.map((item, i) => {
      const s = item.song;
      const bits = metaItems(s, { chords: true });
      if (s.transpose) bits.push(`transposed ${s.transpose > 0 ? '+' : ''}${s.transpose}`);
      const isCurrent = state.song && state.song.id === s.id;
      const differs = isCurrent && songSig(state.song) !== songSig(s);
      return el(
        'li',
        { class: 'set-item' },
        el('div', { class: 'set-text' }, el('div', { class: 'set-title' }, s.title), el('div', { class: 'meta' }, bits.join(' · ') || 'No chords')),
        el(
          'div',
          { class: 'set-buttons' },
          differs ? el('button', { type: 'button', class: 'btn btn-small', title: 'Replace with the song as it is shown now', onclick: () => setList.replaceSong(item.uid, state.song).then(() => toast('Updated from the page')) }, 'Update') : null,
          el('button', { type: 'button', class: 'icon', title: 'Move up', 'aria-label': `Move ${s.title} up`, disabled: i === 0, onclick: () => setList.move(item.uid, -1) }, '▲'),
          el('button', { type: 'button', class: 'icon', title: 'Move down', 'aria-label': `Move ${s.title} down`, disabled: i === sl.items.length - 1, onclick: () => setList.move(item.uid, 1) }, '▼'),
          el('button', { type: 'button', class: 'icon', title: 'Remove', 'aria-label': `Remove ${s.title}`, onclick: () => setList.remove(item.uid) }, '✕'),
        ),
      );
    }),
  );
  const empty = sl.items.length === 0;
  $('#setlist-empty').hidden = !empty;
  for (const b of $$('#setlist-actions button')) b.disabled = empty;
  $('#setlist-clear').disabled = empty;
}

function render() {
  const prefs = prefsStore.get();
  paintHeader();
  paintTabs(prefs);
  const songs = songsInScope(prefs);
  if (prefs.ui.tab === 'word') paintWord(prefs, songs);
  else if (prefs.ui.tab === 'text') paintText(prefs, songs);
  else if (prefs.ui.tab === 'pptx') paintSlides(prefs, songs);
  paintSetList();
}

// ---------------------------------------------------------------- actions

async function withBusy(label, fn) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(`${label} failed: ${err?.message || err}`, 'error');
  } finally {
    state.busy = false;
    render();
  }
}

const actions = {
  'copy-word'() {
    const payload = state.payload.word;
    if (!payload) return;
    copyRich(payload).then((how) => toast(how ? 'Copied. Paste into Word with Ctrl+V.' : 'Copy failed — try again.', how ? 'ok' : 'error'));
  },
  'copy-text'() {
    const payload = state.payload.text;
    if (!payload) return;
    copyRich({ text: payload.text }).then((how) => toast(how ? 'Copied as plain text.' : 'Copy failed — try again.', how ? 'ok' : 'error'));
  },
  'download-docx'() {
    const prefs = prefsStore.get();
    const songs = songsInScope(prefs);
    return withBusy('Download', async () => {
      const blob = await renderDocx(songs, { ...prefs.word, docTitle: baseName(prefs) }, globalThis.JSZip, 'blob');
      await downloadBlob(chromeApi, blob, safeFileName(baseName(prefs), 'docx'));
      toast('Saved .docx to Downloads.');
    });
  },
  'download-txt'() {
    const prefs = prefsStore.get();
    const payload = state.payload.text;
    if (!payload) return;
    return withBusy('Download', async () => {
      const chordPro = prefs.text.style === 'chordpro';
      // A BOM helps Notepad/Word detect UTF-8; ChordPro parsers are better without it.
      const blob = new Blob([(chordPro ? '' : '﻿') + payload.text + '\r\n'], { type: 'text/plain;charset=utf-8' });
      await downloadBlob(chromeApi, blob, safeFileName(baseName(prefs), chordPro ? 'cho' : 'txt'));
      toast(`Saved .${chordPro ? 'cho' : 'txt'} to Downloads.`);
    });
  },
  'download-pptx'() {
    const prefs = prefsStore.get();
    const songs = songsInScope(prefs);
    return withBusy('Download', async () => {
      const { data } = await renderPptx(globalThis.PptxGenJS, songs, { ...prefs.pptx, docTitle: baseName(prefs) }, canvasMeasure, 'blob');
      await downloadBlob(chromeApi, data, safeFileName(baseName(prefs), 'pptx'));
      toast('Saved .pptx to Downloads.');
    });
  },
};

async function addCurrentSong() {
  if (!state.song) return;
  const song = state.song;
  const result = await setList.add(song);
  if (result.duplicate) {
    // Remember WHICH song was flagged: the page may move on before the user answers.
    state.pendingDuplicate = { uid: result.duplicate, song, sig: songSig(song) };
    $('#dup-prompt').hidden = false;
    return;
  }
  toast(`Added to “${setList.get().name}” (${setList.get().items.length}).`);
}

function dismissDuplicatePrompt() {
  state.pendingDuplicate = null;
  $('#dup-prompt').hidden = true;
}

async function resolveDuplicate(choice) {
  const pending = state.pendingDuplicate;
  dismissDuplicatePrompt();
  if (!pending || choice === 'cancel') return;
  if (choice === 'add') await setList.add(pending.song, { force: true });
  if (choice === 'replace') await setList.replaceSong(pending.uid, pending.song);
  toast(choice === 'add' ? 'Added again.' : 'Replaced.');
}

// ---------------------------------------------------------------- events

function bindEvents() {
  document.addEventListener('change', (e) => {
    const input = e.target.closest('[data-pref]');
    if (!input) return;
    const [section, field] = input.dataset.pref.split('.');
    prefsStore.update(section, { [field]: readControl(input) }).then((p) => {
      syncControls(p);
      render();
    });
  });

  const tabs = $$('[role="tab"]');
  for (const tab of tabs) {
    tab.addEventListener('click', () => prefsStore.update('ui', { tab: tab.dataset.tab }).then(render));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }
  for (const b of $$('[data-scope]')) b.addEventListener('click', () => prefsStore.update('ui', { scope: b.dataset.scope }).then(render));
  for (const b of $$('[data-goto]')) b.addEventListener('click', () => prefsStore.update('ui', { tab: b.dataset.goto, scope: 'setlist' }).then(render));
  for (const b of $$('[data-action]')) b.addEventListener('click', () => actions[b.dataset.action]());
  for (const b of $$('[data-dup]')) b.addEventListener('click', () => resolveDuplicate(b.dataset.dup));

  $('#add-to-set').addEventListener('click', addCurrentSong);
  $('#setlist-name').addEventListener('change', (e) => setList.rename(e.target.value));
  $('#setlist-clear').addEventListener('click', () => {
    const n = setList.get().items.length;
    setList.clear().then(() => toast(`Cleared ${n} song${n === 1 ? '' : 's'}.`));
  });
  window.addEventListener('resize', () => {
    if (prefsStore.get().ui.tab === 'pptx') render();
  });
}

// ---------------------------------------------------------------- startup

const link = createTabLink(chromeApi, {
  onSong(raw, tabId) {
    state.song = normalizeSong(raw);
    state.status = 'song';
    state.tabId = tabId;
    if (state.pendingDuplicate && state.pendingDuplicate.sig !== songSig(state.song)) dismissDuplicatePrompt();
    render();
  },
  onStatus({ status, tabId }) {
    state.status = status;
    if (tabId !== undefined) state.tabId = tabId;
    // Keep showing the last song while reconnecting, to avoid a flash.
    if (status !== 'connecting' && status !== 'disconnected') {
      state.song = null;
      dismissDuplicatePrompt();
    }
    render();
  },
});

async function init() {
  buildSelects();
  bindEvents();
  await Promise.all([prefsStore.load(), setList.load()]);
  syncControls(prefsStore.get());
  prefsStore.subscribe((p) => {
    syncControls(p);
    render();
  });
  setList.subscribe(render);
  render();
  link.refresh();
}

init();

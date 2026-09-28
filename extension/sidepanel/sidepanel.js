// Side panel: shows the current Songbase song (or the set list) and exports it.

import { normalizeSong, metaItems, songSig } from '../shared/ir.js';
import { chromeArea } from '../shared/storage.js';
import { createPrefsStore, FONTS, MONO_FONTS, SLIDE_FONTS } from '../shared/prefs.js';
import { createSetListStore } from '../shared/setlist.js';
import { renderWordHtml, renderWordPreview } from '../shared/html.js';
import { planPages } from '../shared/pagination.js';
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
const SONGBASE_URL = 'https://songbase.life/';
const UTF8_BOM = String.fromCharCode(0xfeff); // helps Notepad and Word detect UTF-8

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
  dragging: false,
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

// What the body says when there is nothing to export yet (no song and an empty set list).
const WELCOME = {
  'not-songbase': { title: 'Open a song on Songbase', text: 'Export any song to Word, text or PowerPoint, with chords, verse numbers and choruses intact.', steps: true, action: { label: 'Open songbase.life', run: openSongbase } },
  'not-song': { title: 'Choose a song', text: 'You are on Songbase, but not on a song. Open one to export it.', steps: true },
  connecting: { title: 'Connecting to Songbase…', text: 'One moment.' },
  disconnected: { title: 'Reconnecting…', text: 'One moment.' },
  loading: { title: 'Waiting for the song to load…', text: 'Songbase is still fetching it.' },
  'no-content-script': { title: 'Reload the Songbase tab', text: 'This tab was open before the extension started, so it cannot read the song yet.', action: { label: 'Reload tab', run: reloadTab } },
  'site-error': { title: 'Songbase shows an error', text: 'The page could not load this song. Try reloading it.', action: { label: 'Reload tab', run: reloadTab } },
  empty: { title: 'This song has no lines', text: 'There is nothing to export from this page.' },
  'no-tab': { title: 'No active tab', text: 'Switch to a Songbase tab to export a song.', action: { label: 'Open songbase.life', run: openSongbase } },
};

function openSongbase() {
  chromeApi.tabs.create({ url: SONGBASE_URL });
}

function reloadTab() {
  if (state.tabId !== null && state.tabId !== undefined) chromeApi.tabs.reload(state.tabId);
}

// ---------------------------------------------------------------- small helpers

const SVG_NS = 'http://www.w3.org/2000/svg';

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

// An <svg> that points at a symbol in the sprite at the top of sidepanel.html.
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let toastTimer = null;
let toastMs = 0;

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').classList.remove('show');
  // A faded toast must not leave its button behind: invisible but still focusable, so Tab and
  // Enter minutes later would run an old Undo.
  const button = $('#toast-action');
  button.hidden = true;
  button.onclick = null;
}

function armToast() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastMs);
}

// A short message above the action bar. `action` adds a button ({ label, run }) such as Undo;
// a toast with a button stays longer, and stays while the pointer or focus is on it.
function toast(message, { kind = 'ok', action = null, ms = action ? 7000 : 2800 } = {}) {
  const box = $('#toast');
  const button = $('#toast-action');
  $('#toast-text').textContent = message;
  box.dataset.kind = kind;
  button.hidden = !action;
  button.textContent = action ? action.label : '';
  button.onclick = action
    ? () => {
        hideToast();
        action.run();
      }
    : null;
  box.classList.add('show');
  toastMs = ms;
  armToast();
}

// Briefly turns a button into a confirmation ("Copied") so the click visibly did something.
function flash(button, text = 'Copied') {
  const label = $('.btn-label', button);
  if (!label) return;
  if (!button.classList.contains('is-done')) label.dataset.idle = label.textContent;
  label.textContent = text;
  button.classList.add('is-done');
  clearTimeout(button._flash);
  button._flash = setTimeout(() => {
    label.textContent = label.dataset.idle;
    button.classList.remove('is-done');
  }, 1600);
}

function effectiveScope(prefs) {
  if (prefs.ui.tab === 'setlist') return 'setlist';
  if (!state.song) return 'setlist';
  // A set-list scope with nothing in the list would be a dead end: show the current song.
  return prefs.ui.scope === 'setlist' && setList.get().items.length === 0 ? 'song' : prefs.ui.scope;
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

// One line under each "Options" heading that says what is set, so it need not be opened.
function paintOptionSummaries(prefs) {
  const { word: w, text: t, pptx: p } = prefs;
  $('#opts-summary-word').textContent = `${w.font} ${w.sizePt} pt · ${w.page === 'a4' ? 'A4' : 'Letter'}`;
  const shown = [t.numbers && 'verse numbers', t.meta && 'title info', t.comments && 'notes'].filter(Boolean);
  $('#opts-summary-text').textContent = shown.length ? shown.join(', ') : 'lyrics and chords only';
  $('#opts-summary-pptx').textContent = `${p.font} · ${p.minPt}–${p.maxPt} pt`;
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
  for (const group of $$('[data-seg]')) {
    const [section, field] = group.dataset.seg.split('.');
    const value = String(prefs[section][field]);
    for (const b of $$('[data-value]', group)) {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  for (const box of $$('details[data-opts]')) {
    const open = Boolean(prefs.ui[box.dataset.opts]);
    if (box.open !== open) box.open = open;
  }
  for (const row of $$('[data-show-when]')) {
    const [path, expected] = row.dataset.showWhen.split('=');
    const [section, field] = path.split('.');
    row.hidden = String(prefs[section][field]) !== expected;
  }
  paintOptionSummaries(prefs);
}

// ---------------------------------------------------------------- painting

function paintHeader(welcome) {
  const s = state.song;
  const title = $('#song-title');
  const meta = $('#song-meta');
  const eyebrow = $('#status-line');
  if (s) {
    title.textContent = s.title;
    meta.textContent = metaItems(s, { chords: true }).join(' · ');
    eyebrow.textContent = s.transpose ? `Current song · transposed ${s.transpose > 0 ? '+' : ''}${s.transpose}` : 'Current song';
  } else if (welcome) {
    title.textContent = 'Songbase Export';
    meta.textContent = '';
    eyebrow.textContent = '';
  } else {
    title.textContent = STATUS_TITLES[state.status] || 'Songbase Export';
    meta.textContent = state.status === 'not-songbase' || state.status === 'not-song' ? 'Your set list is still available below.' : '';
    eyebrow.textContent = 'Songbase Export';
  }

  const inList = Boolean(s && setList.findDuplicate(s));
  const add = $('#add-to-set');
  add.hidden = welcome; // nothing to add yet, and the welcome card says what to do
  add.disabled = !s;
  add.classList.toggle('is-added', inList);
  $('#add-label').textContent = inList ? 'In set list' : 'Add to set list';
  $('#add-icon').setAttribute('href', inList ? '#i-check' : '#i-plus');
  add.title = !s
    ? 'Open a song on Songbase to add it'
    : inList
      ? 'Already in the set list, in this key. Click to add it again or replace it.'
      : 'Add this song, in its current key, to the set list';

  const banner = $('#banner');
  const action = $('#banner-action');
  action.hidden = true;
  action.onclick = null;
  if (welcome) {
    banner.hidden = true;
  } else if (state.status === 'no-content-script') {
    $('#banner-text').textContent = 'This tab was open before the extension started. Reload it to connect.';
    action.textContent = 'Reload tab';
    action.hidden = false;
    action.onclick = reloadTab;
    banner.hidden = false;
  } else if (s && s.warnings.length) {
    $('#banner-text').textContent = "Songbase's page looks different than expected. Check the output before using it.";
    banner.title = s.warnings.join('\n');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function paintTabs(prefs, welcome) {
  for (const tab of $$('[role="tab"]')) {
    const selected = tab.dataset.tab === prefs.ui.tab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of $$('[role="tabpanel"]')) panel.hidden = welcome || panel.dataset.panel !== prefs.ui.tab;
  const count = setList.get().items.length;
  $('#set-count').textContent = String(count);
  $('#scope-count').textContent = String(count);

  const scopeBar = $('#scope');
  scopeBar.hidden = welcome || prefs.ui.tab === 'setlist';
  const scope = effectiveScope(prefs);
  for (const b of $$('[data-scope]', scopeBar)) {
    const isSong = b.dataset.scope === 'song';
    b.setAttribute('aria-checked', String(b.dataset.scope === scope));
    b.tabIndex = b.dataset.scope === scope ? 0 : -1;
    b.disabled = isSong ? !state.song : count === 0;
    b.title = b.disabled ? (isSong ? 'Open a song on Songbase first' : 'Add songs to the set list first') : '';
  }
}

function paintWelcome(welcome) {
  const card = $('#welcome');
  card.hidden = !welcome;
  if (!welcome) return;
  const info = WELCOME[state.status] || WELCOME['not-songbase'];
  $('#welcome-title').textContent = info.title;
  $('#welcome-text').textContent = info.text;
  $('#welcome-text').hidden = !info.text;
  $('#welcome-steps').hidden = !info.steps;
  const button = $('#welcome-action');
  button.hidden = !info.action;
  button.textContent = info.action ? info.action.label : '';
  button.onclick = info.action ? info.action.run : null;
}

// The action bar shows the buttons of the current tab only; the toast sits just above it.
function paintDock(prefs, welcome) {
  const dock = $('#dock');
  const emptyList = setList.get().items.length === 0;
  for (const group of $$('[data-dock]', dock)) {
    // The set list's export buttons have nothing to export while the list is empty.
    group.hidden = group.dataset.dock !== prefs.ui.tab || (group.dataset.dock === 'setlist' && emptyList);
  }
  dock.hidden = welcome || $$('[data-dock]', dock).every((group) => group.hidden);
  $('#txt-ext').textContent = prefs.text.style === 'chordpro' ? '.cho' : '.txt';
  requestAnimationFrame(() => document.documentElement.style.setProperty('--dock-h', `${dock.hidden ? 0 : dock.offsetHeight}px`));
}

function chordHint(prefs) {
  if (effectiveScope(prefs) !== 'song' || !state.song) return '';
  if (state.song.chordsHidden) return "Chords are hidden on Songbase. Turn them on with Songbase's ♫ button to include them.";
  if (!state.song.hasChords) return 'This song has no chords, so it exports as lyrics.';
  return '';
}

function setActions(group, enabled) {
  for (const b of $$(`[data-dock="${group}"] [data-action]`)) b.disabled = !enabled || state.busy;
}

function emptyNote(prefs) {
  return effectiveScope(prefs) === 'setlist'
    ? 'Your set list is empty. Add songs with “Add to set list” while viewing them on Songbase.'
    : 'Open a song on songbase.life to see a preview.';
}

// Word's preview is laid out at Word's text width and scaled to fit the panel.
const SHEET_WIDTH_PX = (6.5 + 0.7) * 96;

function updatePreviewZoom() {
  const box = $('#preview-word');
  const room = box.clientWidth - 22; // padding and border
  if (room <= 0) return;
  box.style.setProperty('--pv-zoom', Math.max(0.3, Math.min(1, room / SHEET_WIDTH_PX)).toFixed(3));
}

// Wraps each rendered page in a labelled block ("Page 2 · two songs share this page").
function labelSheets(target) {
  const sheets = $$('.sbx-sheet', target);
  for (const sheet of sheets) {
    const songs = Number(sheet.dataset.songs);
    const label = sheets.length === 1 && songs === 1 ? null : `Page ${sheet.dataset.sheet}${songs === 2 ? ' · two songs share this page' : ''}`;
    const wrap = el('div', { class: 'pv-page' }, label ? el('div', { class: 'pv-label' }, label) : null);
    sheet.replaceWith(wrap);
    wrap.append(sheet);
  }
}

function describePages(plan, count, prefs) {
  const long = plan.heights.some((h) => h > plan.content.heightPt);
  const summary = `${plural(count, 'song')} · ${long ? 'about ' : ''}${plural(plan.pageCount, 'page')}`;
  let note = '';
  if (plan.pairedPages === 1) note = 'One page holds two short songs.';
  else if (plan.pairedPages > 1) note = `${plan.pairedPages} pages hold two short songs each.`;
  else if (prefs.word.pairShort && count > 1) note = 'Each song has its own page: no two neighbouring songs are short enough to share one.';
  return { summary, note };
}

function paintWord(prefs, songs) {
  const panel = $('[data-panel="word"]');
  const hint = $('[data-hint="chords"]', panel);
  hint.textContent = chordHint(prefs);
  hint.hidden = !hint.textContent;

  // Without chords in the export, "Chords above words" is not an option: show what will happen.
  const anyChords = songs.some((s) => s.hasChords);
  const seg = $('[data-seg="word.mode"]', panel);
  const chordsButton = $('[data-value="chords"]', seg);
  chordsButton.disabled = !anyChords;
  chordsButton.title = anyChords ? '' : 'There are no chords to show';
  const layout = anyChords && prefs.word.mode === 'chords' ? 'chords' : 'lyrics';
  for (const b of $$('[data-value]', seg)) {
    b.setAttribute('aria-checked', String(b.dataset.value === layout));
    b.tabIndex = b.dataset.value === layout ? 0 : -1;
  }

  const target = $('#preview-word');
  const summary = $('#word-summary');
  const note = $('#word-note');
  if (!songs.length) {
    target.replaceChildren(el('p', { class: 'empty' }, emptyNote(prefs)));
    summary.textContent = '';
    note.hidden = true;
    state.payload.word = null;
    return setActions('word', false);
  }
  // Which songs share a page is decided once here and reused by the preview, the copy and
  // (planned again on click, from the same inputs) the .docx.
  const plan = planPages(songs, prefs.word, { measure: canvasMeasure });
  const options = { ...prefs.word, pages: plan.pages };
  // Every piece of song text in this HTML went through escapeHtml in the renderer.
  target.innerHTML = renderWordPreview(songs, options);
  labelSheets(target);
  updatePreviewZoom();
  const described = describePages(plan, songs.length, prefs);
  summary.textContent = described.summary;
  note.textContent = described.note;
  note.hidden = !described.note;
  state.payload.word = {
    html: renderWordHtml(songs, options),
    text: renderText(songs, { style: layout, numbers: prefs.word.numbers, meta: prefs.word.meta, comments: prefs.word.comments }),
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
  const range = !sizes.length ? '' : sizes.length === 1 ? ` · text ${sizes[0]} pt` : ` · text ${Math.min(...sizes)}–${Math.max(...sizes)} pt`;
  summary.textContent = `${plural(plan.slides.length, 'slide')}${range}${plan.warnings.length ? ` · ${plan.warnings.join('; ')}` : ''}`;
  // Thumbnail scale: CSS px per point at the thumbnail's width.
  const width = Math.max(120, (target.clientWidth - 8) / 2);
  const k = width / (SLIDE.w * 72);
  target.replaceChildren(...plan.slides.map((s, i) => slideThumb(s, i, prefs, k)));
  setActions('pptx', true);
}

function setItem(item, i, total) {
  const s = item.song;
  const bits = metaItems(s, { chords: true });
  if (s.transpose) bits.push(`transposed ${s.transpose > 0 ? '+' : ''}${s.transpose}`);
  const isCurrent = state.song && state.song.id === s.id;
  const differs = isCurrent && songSig(state.song) !== songSig(s);
  const grip = el('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip'));
  const li = el(
    'li',
    { class: 'set-item', dataset: { uid: item.uid } },
    grip,
    el('span', { class: 'set-num' }, String(i + 1)),
    el('div', { class: 'set-text' }, el('div', { class: 'set-title' }, s.title), el('div', { class: 'meta' }, bits.join(' · ') || 'No chords')),
    el(
      'div',
      { class: 'set-buttons' },
      differs
        ? el('button', { type: 'button', class: 'btn btn-small', dataset: { act: 'update' }, title: 'Replace with the song as it is shown now (key, tune)', onclick: () => setList.replaceSong(item.uid, state.song).then(() => toast('Updated from the page.')) }, 'Update')
        : null,
      el('button', { type: 'button', class: 'icon-btn', dataset: { act: 'up' }, title: 'Move up', 'aria-label': `Move ${s.title} up`, disabled: i === 0, onclick: () => setList.move(item.uid, -1) }, icon('up')),
      el('button', { type: 'button', class: 'icon-btn', dataset: { act: 'down' }, title: 'Move down', 'aria-label': `Move ${s.title} down`, disabled: i === total - 1, onclick: () => setList.move(item.uid, 1) }, icon('down')),
      el('button', { type: 'button', class: 'icon-btn', dataset: { act: 'remove' }, title: 'Remove', 'aria-label': `Remove ${s.title}`, onclick: () => removeSong(item, i) }, icon('close')),
    ),
  );
  // Only the grip starts a drag, so text in the row stays selectable and the buttons stay clickable.
  grip.addEventListener('mousedown', () => {
    li.draggable = true;
  });
  return li;
}

function paintSetList() {
  if (state.dragging) return; // rebuilding the list would cancel the drag in progress
  const sl = setList.get();
  const name = $('#setlist-name');
  if (document.activeElement !== name) name.value = sl.name;
  const list = $('#setlist-items');

  // Rebuilding the rows would drop keyboard focus, so a press of "Move up" would lose its
  // place: remember which control had it and put it back afterwards.
  const active = document.activeElement;
  const held = active && list.contains(active) && active.dataset.act
    ? { uid: active.closest('.set-item').dataset.uid, act: active.dataset.act, index: $$('.set-item', list).indexOf(active.closest('.set-item')) }
    : null;
  list.replaceChildren(...sl.items.map((item, i) => setItem(item, i, sl.items.length)));
  if (held) {
    const rows = $$('.set-item', list);
    // The same row if it is still there (a moved song), else whatever now sits at that position (a removed one).
    const row = rows.find((r) => r.dataset.uid === held.uid) || rows[Math.min(held.index, rows.length - 1)];
    // Same control if it can still be used (Move up at the top is disabled), else the row's first usable one.
    (row && ($(`[data-act="${held.act}"]:not(:disabled)`, row) || $('[data-act]:not(:disabled)', row)))?.focus();
  }
  const empty = sl.items.length === 0;
  $('#setlist-empty').hidden = !empty;
  $('#setlist-tools').hidden = empty;
}

function render() {
  const prefs = prefsStore.get();
  const welcome = !state.song && setList.get().items.length === 0 && prefs.ui.tab !== 'setlist';
  paintHeader(welcome);
  paintTabs(prefs, welcome);
  paintWelcome(welcome);
  paintDock(prefs, welcome);
  if (welcome) {
    state.payload = { word: null, text: null };
  } else {
    const songs = songsInScope(prefs);
    if (prefs.ui.tab === 'word') paintWord(prefs, songs);
    else if (prefs.ui.tab === 'text') paintText(prefs, songs);
    else if (prefs.ui.tab === 'pptx') paintSlides(prefs, songs);
  }
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
    toast(`${label} failed: ${err?.message || err}`, { kind: 'error' });
  } finally {
    state.busy = false;
    render();
  }
}

function savedToast(id, name) {
  const canShow = id !== null && id !== undefined && chromeApi?.downloads?.show;
  toast(`Saved ${name} to Downloads.`, { action: canShow ? { label: 'Show', run: () => chromeApi.downloads.show(id) } : null });
}

const actions = {
  'copy-word'(button) {
    const payload = state.payload.word;
    if (!payload) return;
    copyRich(payload).then((how) => {
      if (how) flash(button);
      toast(how ? 'Copied. Paste into Word with Ctrl+V.' : 'Copy failed — try again.', { kind: how ? 'ok' : 'error' });
    });
  },
  'copy-text'(button) {
    const payload = state.payload.text;
    if (!payload) return;
    copyRich({ text: payload.text }).then((how) => {
      if (how) flash(button);
      toast(how ? 'Copied as plain text.' : 'Copy failed — try again.', { kind: how ? 'ok' : 'error' });
    });
  },
  'download-docx'() {
    const prefs = prefsStore.get();
    const songs = songsInScope(prefs);
    if (!songs.length) return;
    return withBusy('Download', async () => {
      const plan = planPages(songs, prefs.word, { measure: canvasMeasure });
      const blob = await renderDocx(songs, { ...prefs.word, docTitle: baseName(prefs), pages: plan.pages }, globalThis.JSZip, 'blob');
      const name = safeFileName(baseName(prefs), 'docx');
      savedToast(await downloadBlob(chromeApi, blob, name), name);
    });
  },
  'download-txt'() {
    const prefs = prefsStore.get();
    const payload = state.payload.text;
    if (!payload) return;
    return withBusy('Download', async () => {
      const chordPro = prefs.text.style === 'chordpro';
      // ChordPro parsers are better without the BOM.
      const blob = new Blob([(chordPro ? '' : UTF8_BOM) + payload.text + '\r\n'], { type: 'text/plain;charset=utf-8' });
      const name = safeFileName(baseName(prefs), chordPro ? 'cho' : 'txt');
      savedToast(await downloadBlob(chromeApi, blob, name), name);
    });
  },
  'download-pptx'() {
    const prefs = prefsStore.get();
    const songs = songsInScope(prefs);
    if (!songs.length) return;
    return withBusy('Download', async () => {
      const { data } = await renderPptx(globalThis.PptxGenJS, songs, { ...prefs.pptx, docTitle: baseName(prefs) }, canvasMeasure, 'blob');
      const name = safeFileName(baseName(prefs), 'pptx');
      savedToast(await downloadBlob(chromeApi, data, name), name);
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
  const count = setList.get().items.length;
  toast(`Added to “${setList.get().name}” (${count}).`, { action: { label: 'View', run: () => prefsStore.update('ui', { tab: 'setlist' }).then(render) } });
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

// Removing or clearing can be undone from the toast: nothing here is lost by a slip of the mouse.
async function removeSong(item, index) {
  await setList.remove(item.uid);
  toast(`Removed “${item.song.title}”.`, { action: { label: 'Undo', run: () => setList.insert([item], index) } });
}

async function clearSetList() {
  const items = setList.get().items;
  if (!items.length) return;
  await setList.clear();
  toast(`Cleared ${plural(items.length, 'song')}.`, { action: { label: 'Undo', run: () => setList.insert(items, 0) }, ms: 9000 });
}

// ---------------------------------------------------------------- events

// Arrow keys move through a radio group (segmented control, swatches, scope) like native radios.
function onRadioKeys(e) {
  const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
  const group = e.target.closest?.('[role="radiogroup"]');
  if (!group) return;
  const radios = $$('[role="radio"]:not(:disabled)', group);
  const at = radios.indexOf(e.target);
  if (at < 0) return;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (at + keys[e.key] + radios.length) % radios.length;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}

function bindSetListDrag() {
  const list = $('#setlist-items');
  let dragged = null;
  const others = () => $$('.set-item', list).filter((li) => li !== dragged);
  // Where the dragged row would land: its index in the list without it.
  const dropIndex = (y) => {
    let index = 0;
    for (const li of others()) {
      const box = li.getBoundingClientRect();
      if (y <= box.top + box.height / 2) break;
      index += 1;
    }
    return index;
  };
  const clearMarks = () => $$('.drop-above, .drop-below', list).forEach((li) => li.classList.remove('drop-above', 'drop-below'));
  const finish = () => {
    if (dragged) {
      dragged.classList.remove('dragging');
      dragged.draggable = false;
    }
    dragged = null;
    state.dragging = false;
    clearMarks();
    paintSetList();
  };
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('.set-item');
    if (!li) return;
    dragged = li;
    state.dragging = true;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.uid);
  });
  list.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    const rest = others();
    const index = dropIndex(e.clientY);
    if (index < rest.length) rest[index].classList.add('drop-above');
    else rest.at(-1)?.classList.add('drop-below');
  });
  list.addEventListener('drop', (e) => {
    if (!dragged) return;
    e.preventDefault();
    setList.moveTo(dragged.dataset.uid, dropIndex(e.clientY));
  });
  list.addEventListener('dragend', finish);
  // A press on the grip that never turned into a drag must not leave the row draggable.
  document.addEventListener('mouseup', () => {
    if (state.dragging) return;
    for (const li of $$('.set-item[draggable="true"]', list)) li.draggable = false;
  });
}

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

  // Segmented controls and colour swatches.
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-seg] [data-value]');
    if (!button || button.disabled) return;
    const [section, field] = button.closest('[data-seg]').dataset.seg.split('.');
    prefsStore.update(section, { [field]: button.dataset.value }).then((p) => {
      syncControls(p);
      render();
    });
  });
  document.addEventListener('keydown', onRadioKeys);

  for (const box of $$('details[data-opts]')) {
    box.addEventListener('toggle', () => {
      if (prefsStore.get().ui[box.dataset.opts] !== box.open) prefsStore.update('ui', { [box.dataset.opts]: box.open });
    });
  }

  const tabs = $$('[role="tab"]');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      prefsStore.update('ui', { tab: tab.dataset.tab }).then(() => {
        $('#scroll').scrollTop = 0;
        render();
      });
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }
  for (const b of $$('[data-scope]')) b.addEventListener('click', () => prefsStore.update('ui', { scope: b.dataset.scope }).then(render));
  for (const b of $$('[data-goto]')) {
    b.addEventListener('click', () =>
      prefsStore.update('ui', { tab: b.dataset.goto, scope: 'setlist' }).then(() => {
        $('#scroll').scrollTop = 0;
        render();
      }),
    );
  }
  for (const b of $$('[data-action]')) b.addEventListener('click', () => actions[b.dataset.action](b));
  for (const b of $$('[data-dup]')) b.addEventListener('click', () => resolveDuplicate(b.dataset.dup));

  $('#add-to-set').addEventListener('click', addCurrentSong);
  $('#setlist-name').addEventListener('change', (e) => setList.rename(e.target.value));
  $('#setlist-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
  $('#setlist-clear').addEventListener('click', clearSetList);
  $('#setlist-open-songbase').addEventListener('click', openSongbase);

  // Keep a toast that has a button on screen while the pointer or focus is on it.
  const box = $('#toast');
  box.addEventListener('mouseenter', () => clearTimeout(toastTimer));
  box.addEventListener('mouseleave', armToast);
  box.addEventListener('focusin', () => clearTimeout(toastTimer));
  box.addEventListener('focusout', armToast);

  bindSetListDrag();

  // Panel resized: refit the Word preview; slide thumbnails are sized from the width too.
  new ResizeObserver(() => {
    updatePreviewZoom();
    if (prefsStore.get().ui.tab === 'pptx') render();
  }).observe($('#scroll'));
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

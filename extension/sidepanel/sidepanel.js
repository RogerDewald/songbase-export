// Side panel: two tabs - the current Songbase song, and the set list - and an Export menu that
// drops down from the Export button (like GitHub's "Code" button) with the format tabs, their
// options, and the copy / download actions. The tab is what gets exported.

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
  menuOpen: false, // the Export menu; painted by paintMenu, so it survives tab switches
};

// What the song tab says when there is no song to show.
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

const PREVIEW_TITLES = { word: 'Word preview', text: 'Text preview', pptx: 'Slide preview' };

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

// A short message at the bottom of the panel. `action` adds a button ({ label, run }) such as
// Undo; a toast with a button stays longer, and stays while the pointer or focus is on it.
let toastSeq = 0;

function toast(message, { kind = 'ok', action = null, ms = action ? 7000 : 2800 } = {}) {
  toastSeq += 1;
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

// The tab is the export scope: This song exports the page's song, Set list the whole list.
// An empty result means there is nothing to export, so no Export button and no preview.
function songsInScope(prefs) {
  if (prefs.ui.tab === 'setlist') return setList.get().items.map((i) => i.song);
  return state.song ? [state.song] : [];
}

function baseName(prefs) {
  if (prefs.ui.tab === 'setlist') return `${setList.get().name} ${isoDate()}`;
  return state.song?.title || 'song';
}

function showTab(tab) {
  if (prefsStore.get().ui.tab === tab) return Promise.resolve();
  return prefsStore.update('ui', { tab }).then(() => {
    $('#scroll').scrollTop = 0;
    render();
  });
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

// ---------------------------------------------------------------- Export menu

// The menu opens in the flow of the page under the active tab's Export button (each tab has a
// slot for it), so what follows it stays in view and scrolls with it. Open/closed is plain
// state that paintMenu draws: it survives a tab switch (the menu moves to the other slot) and
// the song going away and coming back, and only the button or Escape changes it.
const menuEl = () => $('#export-menu');
const activeToggle = () => $(`[data-panel="${prefsStore.get().ui.tab}"] [data-export-toggle]`);

function openMenu() {
  state.menuOpen = true;
  render();
  $('[data-format][aria-selected="true"]', menuEl())?.focus();
}

function closeMenu() {
  state.menuOpen = false;
  render();
  activeToggle()?.focus();
}

// ---------------------------------------------------------------- painting

function paintTabs(prefs) {
  for (const tab of $$('.tabs [data-tab]')) {
    const selected = tab.dataset.tab === prefs.ui.tab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of $$('[data-panel]')) panel.hidden = panel.dataset.panel !== prefs.ui.tab;
  $('#set-count').textContent = String(setList.get().items.length);
}

function paintWelcome() {
  const info = WELCOME[state.status] || WELCOME['not-songbase'];
  $('#welcome-title').textContent = info.title;
  $('#welcome-text').textContent = info.text;
  $('#welcome-text').hidden = !info.text;
  $('#welcome-steps').hidden = !info.steps;
  const button = $('#welcome-action');
  button.hidden = !info.action;
  button.textContent = info.action ? info.action.label : '';
  button.onclick = info.action ? info.action.run : null;
  // The set list is a tab away, and exports on its own.
  const count = setList.get().items.length;
  const list = $('#welcome-list');
  list.hidden = !count;
  list.textContent = count ? `Your set list (${plural(count, 'song')}) is on its own tab, and still exports.` : '';
}

// The song tab: the song's title and details with Add / Export, or a card saying why there is none.
function paintSongTab() {
  const s = state.song;
  $('#welcome').hidden = Boolean(s);
  $('#song-body').hidden = !s;
  if (s) {
    $('#song-title').textContent = s.title;
    $('#song-meta').textContent = metaItems(s, { chords: true }).join(' · ');
    $('#status-line').textContent = s.transpose ? `Current song · transposed ${s.transpose > 0 ? '+' : ''}${s.transpose}` : 'Current song';
  } else {
    paintWelcome();
  }

  const inList = Boolean(s && setList.findDuplicate(s));
  const add = $('#add-to-set');
  add.disabled = !s;
  add.classList.toggle('is-added', inList);
  $('#add-label').textContent = inList ? 'In set list' : 'Add to set list';
  $('#add-icon').setAttribute('href', inList ? '#i-check' : '#i-plus');
  add.title = inList ? 'Already in the set list, in this key. Click to add it again or replace it.' : 'Add this song, in its current key, to the set list';
}

// The notice above both tabs: a Songbase tab that needs reloading, or songs about to be exported
// whose page looked different than expected. On the song tab with no song the card says it all.
function paintBanner(prefs, songs) {
  const banner = $('#banner');
  const action = $('#banner-action');
  action.hidden = true;
  action.onclick = null;
  banner.title = '';
  const warned = songs.filter((s) => s.warnings.length);
  if (prefs.ui.tab === 'song' && !state.song) {
    banner.hidden = true;
  } else if (state.status === 'no-content-script') {
    $('#banner-text').textContent = 'This tab was open before the extension started. Reload it to connect.';
    action.textContent = 'Reload tab';
    action.hidden = false;
    action.onclick = reloadTab;
    banner.hidden = false;
  } else if (warned.length) {
    $('#banner-text').textContent =
      prefs.ui.tab === 'setlist'
        ? `${plural(warned.length, 'song')} in the set list looked different than expected when added. Check the output before using it.`
        : "Songbase's page looks different than expected. Check the output before using it.";
    banner.title = warned.flatMap((s) => s.warnings).join('\n');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function paintMenu(prefs, canExport) {
  const menu = menuEl();
  // Under the active tab's button. Moving a node drops focus from anything inside it, so put it back.
  const slot = $(`[data-menu-slot="${prefs.ui.tab}"]`);
  const focused = menu.contains(document.activeElement) ? document.activeElement : null;
  if (menu.parentElement !== slot) {
    slot.append(menu);
    focused?.focus();
  }
  const open = state.menuOpen && canExport;
  menu.hidden = !open;
  for (const b of $$('[data-export-toggle]')) b.setAttribute('aria-expanded', String(open));
  // Hidden from under the user's focus (the song went away): land on the tab, not on <body>.
  if (!open && focused) $('.tabs [aria-selected="true"]')?.focus();

  const format = prefs.ui.format;
  for (const tab of $$('[data-format]')) {
    const selected = tab.dataset.format === format;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of $$('[data-format-panel]')) panel.hidden = panel.dataset.formatPanel !== format;
}

// Whether the chosen format, as it is set up, would include chords: the only case the chord hint helps.
const USES_CHORDS = { text: (p) => p.text.style !== 'lyrics', word: (p) => p.word.mode === 'chords', pptx: (p) => p.pptx.notes };

function chordHint(prefs) {
  if (prefs.ui.tab !== 'song' || !state.song) return '';
  if (state.song.chordsHidden) return "Chords are hidden on Songbase. Turn them on with Songbase's ♫ button to include them.";
  if (!state.song.hasChords) return 'This song has no chords, so it exports as lyrics.';
  return '';
}

function setActions(format, enabled) {
  for (const b of $$(`[data-format-panel="${format}"] [data-action]`)) b.disabled = !enabled || state.busy;
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
  // Without chords in the export, "Chords above words" is not an option: show what will happen.
  const anyChords = songs.some((s) => s.hasChords);
  const seg = $('[data-seg="word.mode"]');
  const chordsButton = $('[data-value="chords"]', seg);
  chordsButton.disabled = !anyChords;
  chordsButton.title = anyChords ? '' : 'There are no chords to show';
  const layout = anyChords && prefs.word.mode === 'chords' ? 'chords' : 'lyrics';
  for (const b of $$('[data-value]', seg)) {
    b.setAttribute('aria-checked', String(b.dataset.value === layout));
    b.tabIndex = b.dataset.value === layout ? 0 : -1;
  }

  // Which songs share a page is decided once here and reused by the preview, the copy and
  // (planned again on click, from the same inputs) the .docx.
  const plan = planPages(songs, prefs.word, { measure: canvasMeasure });
  const options = { ...prefs.word, pages: plan.pages };
  const target = $('#preview-word');
  // Every piece of song text in this HTML went through escapeHtml in the renderer.
  target.innerHTML = renderWordPreview(songs, options);
  labelSheets(target);
  updatePreviewZoom();
  const described = describePages(plan, songs.length, prefs);
  $('#preview-summary').textContent = described.summary;
  const note = $('#preview-note');
  note.textContent = described.note;
  note.hidden = !described.note;
  state.payload.word = {
    html: renderWordHtml(songs, options),
    text: renderText(songs, { style: layout, numbers: prefs.word.numbers, meta: prefs.word.meta, comments: prefs.word.comments }),
  };
  setActions('word', true);
}

function paintText(prefs, songs) {
  const text = renderText(songs, prefs.text);
  $('#preview-text').textContent = text.replace(/\r\n/g, '\n');
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
  const plan = planDeck(songs, prefs.pptx, canvasMeasure);
  const lyricSlides = plan.slides.filter((s) => s.kind === 'lyrics');
  const sizes = [...new Set(lyricSlides.map((s) => s.pt))];
  const range = !sizes.length ? '' : sizes.length === 1 ? ` · text ${sizes[0]} pt` : ` · text ${Math.min(...sizes)}–${Math.max(...sizes)} pt`;
  $('#preview-summary').textContent = `${plural(plan.slides.length, 'slide')}${range}${plan.warnings.length ? ` · ${plan.warnings.join('; ')}` : ''}`;
  // Thumbnail scale: CSS px per point at the thumbnail's width.
  const width = Math.max(120, (target.clientWidth - 8) / 2);
  const k = width / (SLIDE.w * 72);
  target.replaceChildren(...plan.slides.map((s, i) => slideThumb(s, i, prefs, k)));
  setActions('pptx', true);
}

// The preview block under the active tab, in the format chosen in the Export menu.
function paintPreview(prefs, songs) {
  state.payload = { word: null, text: null };
  $('#preview').hidden = !songs.length;
  if (!songs.length) {
    for (const b of $$('#export-menu [data-action]')) b.disabled = true;
    return;
  }
  const format = prefs.ui.format;
  for (const p of $$('[data-preview]')) p.hidden = p.dataset.preview !== format;
  $('#preview-title').textContent = PREVIEW_TITLES[format];
  $('#preview-summary').textContent = '';
  $('#preview-note').hidden = true;
  const hint = $('#hint');
  hint.textContent = USES_CHORDS[format](prefs) ? chordHint(prefs) : '';
  hint.hidden = !hint.textContent;
  if (format === 'word') paintWord(prefs, songs);
  else if (format === 'text') paintText(prefs, songs);
  else paintSlides(prefs, songs);
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
  $('#setlist-foot').hidden = empty;
}

function render() {
  const prefs = prefsStore.get();
  const songs = songsInScope(prefs);
  paintTabs(prefs);
  paintSongTab();
  paintBanner(prefs, songs);
  paintSetList();
  paintMenu(prefs, songs.length > 0);
  paintPreview(prefs, songs);
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

// Copy confirms on the row itself; a download reports in the toast, which says where the file
// went. Neither closes the menu: the next export is often the same songs in another format.
// A download's title and file name are fixed BEFORE the render starts: the page can move to
// another song while a deck is being built, and the file must still be named for what is in it.
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
    const title = baseName(prefs);
    const name = safeFileName(title, 'docx');
    return withBusy('Download', async () => {
      const plan = planPages(songs, prefs.word, { measure: canvasMeasure });
      const blob = await renderDocx(songs, { ...prefs.word, docTitle: title, pages: plan.pages }, globalThis.JSZip, 'blob');
      savedToast(await downloadBlob(chromeApi, blob, name), name);
    });
  },
  'download-txt'() {
    const prefs = prefsStore.get();
    const payload = state.payload.text;
    if (!payload) return;
    const name = safeFileName(baseName(prefs), 'txt');
    return withBusy('Download', async () => {
      const blob = new Blob([UTF8_BOM + payload.text + '\r\n'], { type: 'text/plain;charset=utf-8' });
      savedToast(await downloadBlob(chromeApi, blob, name), name);
    });
  },
  'download-pptx'() {
    const prefs = prefsStore.get();
    const songs = songsInScope(prefs);
    if (!songs.length) return;
    const title = baseName(prefs);
    const name = safeFileName(title, 'pptx');
    return withBusy('Download', async () => {
      const { data } = await renderPptx(globalThis.PptxGenJS, songs, { ...prefs.pptx, docTitle: title }, canvasMeasure, 'blob');
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
  toast(`Added to “${setList.get().name}” (${count}).`, { action: { label: 'View', run: () => showTab('setlist') } });
}

function dismissDuplicatePrompt() {
  state.pendingDuplicate = null;
  $('#dup-prompt').hidden = true;
}

async function resolveDuplicate(choice) {
  const pending = state.pendingDuplicate;
  dismissDuplicatePrompt();
  if (!pending || choice === 'cancel') return;
  // The prompt outlives tab switches, so the flagged item may have been removed meanwhile:
  // replacing nothing would report success and change nothing.
  const stillThere = setList.get().items.some((it) => it.uid === pending.uid);
  if (choice === 'add' || (choice === 'replace' && !stillThere)) {
    await setList.add(pending.song, { force: true });
    toast(choice === 'add' ? 'Added again.' : 'The old copy was removed, so this one was added.');
    return;
  }
  await setList.replaceSong(pending.uid, pending.song);
  toast('Replaced.');
}

// Removing or clearing can be undone from the toast: nothing here is lost by a slip of the mouse.
// Removals made while one Undo is still on offer join it, so a second slip does not orphan the first.
let removedBatch = [];
let removedBatchToast = -1;

async function undoRemoved(batch) {
  // Newest first: each index was measured against the list as it stood after the earlier removals.
  for (const { item, index } of [...batch].reverse()) await setList.insert([item], index);
}

async function removeSong(item, index) {
  await setList.remove(item.uid);
  const undoOffered = $('#toast').classList.contains('show') && removedBatchToast === toastSeq;
  if (!undoOffered) removedBatch = [];
  removedBatch.push({ item, index });
  const batch = removedBatch;
  toast(batch.length === 1 ? `Removed “${item.song.title}”.` : `Removed ${plural(batch.length, 'song')}.`, {
    action: { label: 'Undo', run: () => undoRemoved(batch) },
  });
  removedBatchToast = toastSeq;
}

async function clearSetList() {
  const items = setList.get().items;
  if (!items.length) return;
  await setList.clear();
  toast(`Cleared ${plural(items.length, 'song')}.`, { action: { label: 'Undo', run: () => setList.insert(items, 0) }, ms: 9000 });
}

// ---------------------------------------------------------------- events

// Arrow keys move through a radio group (segmented control, swatches) like native radios.
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
  // Nothing to move to (a lone enabled radio): clicking would save a choice the user never made,
  // e.g. "Lyrics" written to the prefs while Chords is only disabled for this song.
  if (next !== at) radios[next].click();
}

// A row of tabs: click picks, Left/Right move and pick (both the main tabs and the format tabs).
function bindTabList(tabs, pick) {
  for (const tab of tabs) {
    tab.addEventListener('click', () => pick(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      pick(next);
    });
  }
}

function bindExportMenu() {
  for (const b of $$('[data-export-toggle]')) b.addEventListener('click', () => (state.menuOpen ? closeMenu() : openMenu()));
  bindTabList($$('[data-format]'), (tab) => prefsStore.update('ui', { format: tab.dataset.format }).then(render));
  // Escape closes the menu only from inside it (or from its button): elsewhere, Escape means
  // whatever it means there - backing out of the set list name, say - and must not steal focus.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || !state.menuOpen) return;
    if (!menuEl().contains(e.target) && !e.target.closest?.('[data-export-toggle]')) return;
    e.preventDefault();
    closeMenu();
  });
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

  bindTabList($$('.tabs [data-tab]'), (tab) => showTab(tab.dataset.tab));
  bindExportMenu();
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
    if (prefsStore.get().ui.format === 'pptx' && songsInScope(prefsStore.get()).length) render();
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

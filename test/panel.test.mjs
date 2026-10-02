// The side panel end to end, in jsdom: the real sidepanel.html and sidepanel.js against a stub
// `chrome`, driven the way a user drives it. Songs are the invented placeholder fixtures.
//
// One panel instance for the whole file (the module initialises itself on import), so the
// tests below run in order and build on each other's state, like one sitting with the panel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveObjectURL } from 'node:buffer';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

import { hymn, refrain, long } from './fixtures/songs.mjs';
import { SETLIST_KEY } from '../extension/shared/setlist.js';

// ---------------------------------------------------------------- environment

const dom = new JSDOM(readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8'), {
  url: 'https://panel.test/sidepanel.html',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// Text measured at 0.5em per character, so wrapping (and so page planning) is deterministic.
window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (text) => ({ width: text.length * 50 }) });

// Timers longer than half a second (toasts, the 60s blob revoke) must not hold the test process open.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  const timer = realSetTimeout(fn, ms, ...rest);
  if (ms > 500) timer.unref?.();
  return timer;
};

const tick = (ms = 25) => new Promise((resolve) => realSetTimeout(resolve, ms));
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function events() {
  const fns = new Set();
  return { addListener: (fn) => fns.add(fn), removeListener: (fn) => fns.delete(fn), emit: (...args) => [...fns].forEach((fn) => fn(...args)) };
}

function makeChrome() {
  const store = {};
  const onChanged = events();
  const chrome = {
    runtime: { lastError: undefined },
    tabs: {
      url: 'https://example.com/', // the active tab
      port: null,
      reloaded: [],
      opened: [],
      onActivated: events(),
      onUpdated: events(),
      async query() {
        return [{ id: 1, windowId: 1, active: true, url: chrome.tabs.url }];
      },
      connect() {
        const onMessage = events();
        const onDisconnect = events();
        chrome.tabs.port = { name: 'sbx', onMessage, onDisconnect, postMessage() {}, disconnect() {}, emit: (msg) => onMessage.emit(clone(msg)) };
        return chrome.tabs.port;
      },
      async reload(id) {
        chrome.tabs.reloaded.push(id);
      },
      async create({ url }) {
        chrome.tabs.opened.push(url);
      },
    },
    storage: {
      onChanged,
      local: {
        async get(key) {
          return { [key]: clone(store[key]) };
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(store[k]), newValue: clone(v) };
            store[k] = clone(v);
          }
          onChanged.emit(changes, 'local');
        },
      },
    },
    downloads: {
      saved: [],
      shown: [],
      async download({ url, filename }) {
        chrome.downloads.saved.push({ filename, blob: resolveObjectURL(url) });
        return chrome.downloads.saved.length;
      },
      show(id) {
        chrome.downloads.shown.push(id);
      },
    },
  };
  return { chrome, store };
}
const { chrome, store } = makeChrome();

// What "Copy" hands to the clipboard: clipboard.js listens for the copy event that execCommand fires.
const clipboard = {};
document.execCommand = () => {
  const event = new window.Event('copy', { cancelable: true });
  event.clipboardData = { setData: (type, value) => (clipboard[type] = value) };
  document.dispatchEvent(event);
  return true;
};

Object.assign(globalThis, {
  window,
  document,
  chrome,
  JSZip,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: (fn) => window.requestAnimationFrame(fn),
});

await import('../extension/sidepanel/sidepanel.js');
await tick(60);
after(() => window.close());

// ---------------------------------------------------------------- helpers

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = async (sel) => {
  const node = typeof sel === 'string' ? $(sel) : sel;
  assert.ok(node, `no element for ${sel}`);
  node.click();
  await tick();
};
const text = (sel) => $(sel).textContent.trim();
const visible = (sel) => !$(sel).hidden;
// Visible with all its ancestors (a button inside a hidden toolbar is not on screen).
const shown = (node) => !(typeof node === 'string' ? $(node) : node).closest('[hidden]');
const toastText = () => `${text('#toast-text')}${visible('#toast-action') ? ` [${text('#toast-action')}]` : ''}`;
const titles = () => $$('.set-item .set-title').map((n) => n.textContent);
const key = (node, k) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
// The Export button of the active tab (each tab has its own; only one is on screen).
const exportButton = () => $$('[data-export-toggle]').filter(shown);
const openMenu = async () => {
  const [button] = exportButton();
  assert.ok(button, 'an Export button is on screen');
  if (!visible('#export-menu')) await click(button);
  assert.ok(visible('#export-menu'));
  return button;
};
// Tests share one panel, so a test that looks at one format's controls says so instead of
// relying on whatever an earlier test left selected.
const useFormat = async (format) => {
  await openMenu();
  if ($(`[data-format="${format}"]`).getAttribute('aria-selected') !== 'true') await click(`[data-format="${format}"]`);
};

// Point the (stub) browser at Songbase, once, then push songs down the content-script port.
async function showSong(song) {
  if (!chrome.tabs.url.startsWith('https://songbase.life/')) {
    chrome.tabs.url = 'https://songbase.life/101';
    chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
    await tick();
  }
  chrome.tabs.port.emit({ type: 'song', song });
  await tick();
}
const status = async (name) => {
  chrome.tabs.port?.emit({ type: 'status', status: name });
  await tick();
};

// ---------------------------------------------------------------- tests

test('first run: two tabs, a welcome card that says what to do, and nothing to export yet', async () => {
  assert.deepEqual($$('.tabs [role="tab"]').map((t) => t.dataset.tab), ['song', 'setlist']);
  assert.equal($('[data-tab="song"]').getAttribute('aria-selected'), 'true');
  assert.ok(visible('#panel-song'));
  assert.ok(visible('#welcome'));
  assert.equal(text('#welcome-title'), 'Open a song on Songbase');
  assert.ok(!visible('#welcome-list'), 'nothing in the set list to point at');
  assert.ok(!shown('#add-to-set'), 'no dead Add button');
  assert.deepEqual(exportButton(), [], 'no Export button without anything to export');
  assert.ok(!visible('#preview'));
  assert.ok(!visible('#export-menu'));
  await click('#welcome-action');
  assert.deepEqual(chrome.tabs.opened, ['https://songbase.life/']);
});

test('a song arrives: header, Export button and the Text preview (the default format)', async () => {
  await showSong(hymn());
  assert.ok(!visible('#welcome'));
  assert.ok(shown('#song-body'));
  assert.equal(text('#song-title'), 'Placeholder Hymn of Testing');
  assert.equal(text('#song-meta'), 'Hymnal #12 · Key: D · Capo 2');
  assert.equal(exportButton().length, 1);
  assert.ok(visible('#preview'));
  assert.equal(store['sbx.prefs'], undefined, 'nothing stored yet: this is the default');
  assert.equal(text('#preview-title'), 'Text preview');
  assert.deepEqual($$('[data-preview]').filter((p) => !p.hidden).map((p) => p.dataset.preview), ['text']);
  assert.match(text('#preview-text'), /Placeholder Hymn of Testing/);
  assert.match(text('#preview-text'), /^\s*D\s+G\s+A\s*$/m, 'chords on their own line above the words');
});

test('the Export menu opens under the button, in the flow: format tabs, options and actions; Escape or the button closes it', async () => {
  const [button] = exportButton();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Export', 'named even when the narrow layout hides its text');
  assert.equal(button.getAttribute('aria-haspopup'), null, 'a disclosure, not a dialog');
  await click(button);
  assert.ok(visible('#export-menu'));
  assert.equal($('#export-menu').parentElement.dataset.menuSlot, 'song', 'sits in the song tab, under its button');
  assert.ok(visible('#preview'), 'the preview stays on the page under it');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.deepEqual($$('[data-format]').map((t) => t.dataset.format), ['text', 'word', 'pptx'], 'Text first');
  assert.equal($('[data-format="text"]').getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, $('[data-format="text"]'), 'focus moves into the menu');
  assert.deepEqual($$('[data-format-panel]').filter((p) => !p.hidden).map((p) => p.dataset.formatPanel), ['text']);
  assert.deepEqual($$('[data-format-panel="text"] [data-action]').map((b) => [b.dataset.action, b.disabled]), [['copy-text', false], ['download-txt', false]]);
  assert.ok($('[data-format-panel="text"] details[data-opts="optsText"]'), 'the format options live in the menu');
  for (const panel of $$('[data-format-panel]')) assert.equal($(`#${panel.getAttribute('aria-labelledby')}`).dataset.format, panel.dataset.formatPanel, 'each format panel is named by its tab');

  key(document.activeElement, 'Escape');
  await tick();
  assert.ok(!visible('#export-menu'));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, button, 'focus returns to the button');

  await click(button);
  assert.ok(visible('#export-menu'));
  document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  $('#preview').dispatchEvent(new window.Event('scroll', { bubbles: true }));
  $('#add-to-set').focus();
  key($('#add-to-set'), 'Escape');
  await tick();
  assert.ok(visible('#export-menu'), 'clicking, scrolling, focusing or pressing Escape elsewhere leaves it open: the preview is meant to be used beside it');
  assert.equal(document.activeElement, $('#add-to-set'), 'and does not steal focus');

  await click(button);
  assert.ok(!visible('#export-menu'), 'the button toggles');
});

test('adding to the set list is key-aware, and toasts with a way to view the list', async () => {
  assert.equal(text('#add-label'), 'Add to set list');
  await click('#add-to-set');
  assert.equal(toastText(), 'Added to “Set list” (1). [View]');
  assert.equal(text('#add-label'), 'In set list');
  assert.equal(text('#set-count'), '1');

  const transposed = hymn();
  transposed.groups[1].parts[0].lines[0].chords[0].name = 'Eb';
  await showSong(transposed);
  assert.equal(text('#add-label'), 'Add to set list', 'a different key is a different song');
  assert.match(text('#status-line'), /Current song/);

  await showSong(hymn());
  await click('#add-to-set'); // already there, same key
  assert.ok(visible('#dup-prompt'));
  await click('[data-dup="cancel"]');
  assert.ok(!visible('#dup-prompt'));
  assert.equal(text('#set-count'), '1');
});

test('the Set list tab exports the list: two short songs share a page, and the panel says so', async () => {
  await showSong(refrain());
  await click('#add-to-set');
  await showSong(long());
  await click('#add-to-set');
  assert.equal(text('#set-count'), '3');

  await click('[data-tab="setlist"]');
  assert.ok(visible('#panel-setlist') && !visible('#panel-song'));
  assert.equal(exportButton().length, 1, 'the set list has its own Export button');
  assert.ok(visible('#preview'), 'and the preview follows the tab');
  await openMenu();
  assert.equal($('#export-menu').parentElement.dataset.menuSlot, 'setlist', 'the menu moved under this tab\'s button');
  await click('[data-format="word"]');
  assert.equal(text('#preview-title'), 'Word preview');
  assert.deepEqual($$('[data-seg="word.mode"] [data-value]').map((b) => b.getAttribute('aria-checked')), ['true', 'false']);
  key(document.activeElement, 'Escape');
  await tick();
  assert.equal(text('#preview-summary'), '3 songs · 2 pages');
  assert.equal(text('#preview-note'), 'One page holds two short songs.');
  const sheets = $$('.sbx-sheet');
  assert.deepEqual(sheets.map((s) => s.dataset.songs), ['2', '1']);
  assert.deepEqual($$('.pv-label').map((n) => n.textContent), ['Page 1 · two songs share this page', 'Page 2']);
  assert.equal(sheets[0].querySelectorAll('h1').length, 2);
});

test('turning "Fit two short songs on one page" off gives one song per page', async () => {
  await openMenu();
  const box = $('[data-pref="word.pairShort"]');
  assert.equal(box.checked, true, 'on by default');
  box.checked = false;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.ok(visible('#export-menu'), 'changing an option keeps the menu open');
  assert.equal(text('#preview-summary'), '3 songs · 3 pages');
  assert.ok(!visible('#preview-note') || text('#preview-note') === '');
  assert.equal($$('.sbx-sheet').length, 3);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(text('#preview-summary'), '3 songs · 2 pages');
});

test('Copy for Word puts the page plan on the clipboard and confirms on the row', async () => {
  await useFormat('word');
  await click('[data-action="copy-word"]');
  const html = clipboard['text/html'];
  assert.ok(html, 'HTML flavour written');
  assert.equal((html.match(/border-top:\.75pt solid #BFBFBF/g) || []).length, 1, 'one rule: the second song of the shared page');
  assert.equal((html.match(/page-break-before:always/g) || []).length, 1, 'one page break: before the third song');
  assert.match(clipboard['text/plain'], /Placeholder Hymn of Testing/);
  assert.equal(toastText(), 'Copied. Paste into Word with Ctrl+V.');
  assert.ok($('[data-action="copy-word"]').classList.contains('is-done'), 'the row itself confirms');
  assert.ok(visible('#export-menu'), 'copying keeps the menu open');
});

test('Download .docx saves the same plan, and the toast can show the file', async () => {
  await openMenu();
  await click('[data-action="download-docx"]');
  await tick(150);
  assert.ok(visible('#export-menu'), 'a download leaves the menu open for the next format');
  const saved = chrome.downloads.saved.at(-1);
  assert.match(saved.filename, /^Set list \d{4}-\d{2}-\d{2}\.docx$/);
  const xml = await (await JSZip.loadAsync(await saved.blob.arrayBuffer())).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 1);
  assert.equal((xml.match(/<w:pBdr>/g) || []).length, 1);
  assert.match(toastText(), /^Saved Set list .*\.docx to Downloads\. \[Show\]$/);
  await click('#toast-action');
  assert.deepEqual(chrome.downloads.shown, [1]);
});

test('no chords: "Chords above words" is unavailable and the panel says why', async () => {
  await click('[data-tab="song"]');
  await useFormat('word');
  await showSong(refrain());
  const [chords, lyrics] = $$('[data-seg="word.mode"] [data-value]');
  assert.equal(chords.disabled, true);
  assert.equal(lyrics.getAttribute('aria-checked'), 'true');
  assert.equal(text('#hint'), 'This song has no chords, so it exports as lyrics.');
  await showSong(hymn());
  assert.equal($$('[data-seg="word.mode"] [data-value]')[0].disabled, false);
  assert.ok(!visible('#hint'));
});

test('arrow keys move through a segmented control and save the choice', async () => {
  await openMenu();
  const [chords] = $$('[data-seg="word.mode"] [data-value]');
  chords.focus();
  key(chords, 'ArrowRight');
  await tick();
  assert.equal(store['sbx.prefs'].word.mode, 'lyrics');
  assert.equal(document.activeElement.dataset.value, 'lyrics');
  key(document.activeElement, 'ArrowLeft');
  await tick();
  assert.equal(store['sbx.prefs'].word.mode, 'chords');
});

test('an options panel remembers whether it was open', async () => {
  const box = $('details[data-opts="optsWord"]');
  assert.equal(box.open, false);
  box.open = true;
  box.dispatchEvent(new window.Event('toggle')); // jsdom does not raise it for a script's change
  await tick();
  assert.equal(store['sbx.prefs'].ui.optsWord, true);
  assert.match(text('#opts-summary-word'), /Calibri 12 pt · Letter/);
  box.open = false;
  box.dispatchEvent(new window.Event('toggle'));
  await tick();
  assert.equal(store['sbx.prefs'].ui.optsWord, false);
});

test('format tabs in the menu: the preview follows, the choice is remembered, and the text style switches', async () => {
  await openMenu();
  await click('[data-format="text"]');
  assert.equal(store['sbx.prefs'].ui.format, 'text');
  assert.ok(visible('#export-menu'), 'picking a format keeps the menu open');
  assert.deepEqual($$('[data-format-panel]').filter((p) => !p.hidden).map((p) => p.dataset.formatPanel), ['text']);
  assert.equal(text('#preview-title'), 'Text preview');
  assert.deepEqual($$('[data-preview]').filter((p) => !p.hidden).map((p) => p.dataset.preview), ['text']);
  assert.deepEqual($$('[data-seg="text.style"] [data-value]').map((b) => b.dataset.value), ['chords', 'lyrics'], 'two styles, no ChordPro');
  assert.match(text('#preview-text'), /^\s*D\s+G\s+A\s*$/m);
  await click('[data-seg="text.style"] [data-value="lyrics"]');
  assert.doesNotMatch(text('#preview-text'), /^\s*D\s+G\s+A\s*$/m, 'lyrics only drops the chord rows');
  await click('[data-seg="text.style"] [data-value="chords"]');

  // Left/Right on the format tabs pick the neighbour, wrapping round.
  $('[data-format="text"]').focus();
  key(document.activeElement, 'ArrowRight');
  await tick();
  assert.equal(store['sbx.prefs'].ui.format, 'word');
  assert.equal(text('#preview-title'), 'Word preview');
  key(document.activeElement, 'ArrowRight');
  await tick();
  assert.equal(store['sbx.prefs'].ui.format, 'pptx');
  assert.equal(text('#preview-title'), 'Slide preview');
  assert.ok($$('.slide').length > 0, 'slide thumbnails are drawn');
  key(document.activeElement, 'ArrowRight');
  await tick();
  assert.equal(store['sbx.prefs'].ui.format, 'text', 'wraps round to the first');
  assert.equal(document.activeElement, $('[data-format="text"]'));
  await click('[data-format="word"]'); // the tests below look at the Word layout control
  key(document.activeElement, 'Escape');
  await tick();
});

test('Set list tab: remove, clear and their Undo; nothing to export while the list is empty', async () => {
  await click('[data-tab="setlist"]');
  assert.deepEqual($$('[data-dock]'), [], 'the old bottom action bar is gone');
  assert.equal(exportButton().length, 1);
  const before = titles();
  assert.equal(before.length, 3);

  await click($$('.set-item')[1].querySelector('[data-act="remove"]'));
  assert.deepEqual(titles(), [before[0], before[2]]);
  assert.equal(toastText(), `Removed “${before[1]}”. [Undo]`);
  await click('#toast-action');
  assert.deepEqual(titles(), before, 'back in the same place');
  // Once a toast has gone, its button must not linger: invisible but focusable, Enter would run a stale Undo.
  assert.ok(!visible('#toast-action'));
  assert.equal($('#toast-action').onclick, null);

  await openMenu();
  await click('#setlist-clear');
  assert.deepEqual(titles(), []);
  assert.ok(visible('#setlist-empty'));
  assert.ok(!visible('#setlist-tools'));
  assert.deepEqual(exportButton(), [], 'nothing to export, so no Export button');
  assert.ok(!visible('#export-menu'), 'and the open menu went with it');
  assert.ok(!visible('#preview'));
  assert.equal(toastText(), 'Cleared 3 songs. [Undo]');
  await click('#toast-action');
  assert.deepEqual(titles(), before);
  assert.ok(!visible('#setlist-empty'));
  assert.equal(exportButton().length, 1);
  assert.ok(visible('#preview'));
  assert.ok(visible('#export-menu'), 'the menu was only waiting for something to export');
  key($('[data-format][aria-selected="true"]'), 'Escape');
  await tick();
});

test('Set list tab: the arrow buttons reorder and keyboard focus follows the song', async () => {
  const before = titles();
  const down = $$('.set-item')[0].querySelector('[data-act="down"]');
  down.focus();
  await click(down);
  assert.deepEqual(titles(), [before[1], before[0], before[2]]);
  assert.equal(document.activeElement.dataset.act, 'down', 'focus is back on a Move down button after the list was rebuilt');
  assert.equal(document.activeElement.closest('.set-item').querySelector('.set-title').textContent, before[0], 'the same song');
  await click($$('.set-item')[1].querySelector('[data-act="up"]'));
  assert.deepEqual(titles(), before);
});

test('Set list tab: dragging a row by its grip drops it where the pointer is', async () => {
  const list = $('#setlist-items');
  const before = titles();
  const rows = $$('.set-item');
  // jsdom has no layout: give each row a box, 50px apart, so "where the pointer is" means something.
  rows.forEach((row, i) => (row.getBoundingClientRect = () => ({ top: i * 50, height: 40 })));
  const drag = (type, y = 0) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y });
    event.dataTransfer = { effectAllowed: '', dropEffect: '', setData() {} };
    return event;
  };
  rows[2].querySelector('.grip').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(rows[2].draggable, true, 'only a press on the grip makes the row draggable');
  rows[2].dispatchEvent(drag('dragstart'));
  list.dispatchEvent(drag('dragover', 5)); // above the middle of the first row
  assert.ok(rows[0].classList.contains('drop-above'), 'the insertion marker shows where it will land');
  list.dispatchEvent(drag('drop', 5));
  rows[2].dispatchEvent(drag('dragend'));
  await tick();
  assert.deepEqual(titles(), [before[2], before[0], before[1]]);
  assert.ok($$('.set-item').every((row) => !row.draggable), 'draggable is switched off again');
});

test('removing two songs in a row keeps one Undo that brings both back in place', async () => {
  await click('[data-tab="setlist"]');
  const before = titles();
  await click($$('.set-item')[0].querySelector('[data-act="remove"]'));
  await click($$('.set-item')[1].querySelector('[data-act="remove"]')); // originally the third song
  assert.deepEqual(titles(), [before[1]]);
  assert.equal(toastText(), 'Removed 2 songs. [Undo]');
  await click('#toast-action');
  assert.deepEqual(titles(), before, 'the first removal was not orphaned by the second');
  // A removal after the Undo starts a fresh one.
  await click($$('.set-item')[2].querySelector('[data-act="remove"]'));
  assert.equal(toastText(), `Removed “${before[2]}”. [Undo]`);
  await click('#toast-action');
  assert.deepEqual(titles(), before);
});

test('Replace on a duplicate prompt whose song has since been removed adds it instead of reporting a phantom "Replaced"', async () => {
  const name = hymn().title;
  await click('[data-tab="song"]');
  await showSong(hymn());
  await click('#add-to-set');
  assert.ok(visible('#dup-prompt'));
  assert.equal($('#dup-prompt').getAttribute('role'), 'alert', 'the prompt is announced, not silent');
  assert.equal($('#banner').getAttribute('role'), 'status');

  await click('[data-tab="setlist"]');
  const row = $$('.set-item').find((li) => li.querySelector('.set-title').textContent === name);
  await click(row.querySelector('[data-act="remove"]'));
  assert.ok(!titles().includes(name));

  await click('[data-dup="replace"]');
  assert.ok(titles().includes(name), 'the song is in the list again');
  assert.equal(titles().filter((t) => t === name).length, 1);
  assert.equal(toastText(), 'The old copy was removed, so this one was added.');
});

test('switching tabs keeps the menu open, under the new tab\'s button; clicking the selected tab changes nothing', async () => {
  await openMenu();
  assert.equal($('#export-menu').parentElement.dataset.menuSlot, 'setlist');
  await click('[data-tab="song"]');
  assert.ok(visible('#export-menu'));
  assert.equal($('#export-menu').parentElement.dataset.menuSlot, 'song');
  assert.ok(exportButton().every((b) => b.getAttribute('aria-expanded') === 'true'));
  $('#scroll').scrollTop = 120;
  const writes = JSON.stringify(store['sbx.prefs']);
  await click('[data-tab="song"]');
  assert.ok(visible('#export-menu'), 'still open');
  assert.equal($('#scroll').scrollTop, 120, 'no jump to the top');
  assert.equal(JSON.stringify(store['sbx.prefs']), writes, 'nothing stored');
  $('#scroll').scrollTop = 0;
});

test('an arrow key on a lone enabled radio does not save a choice the user never made', async () => {
  assert.equal(store['sbx.prefs'].word.mode, 'chords');
  await showSong(refrain()); // no chords: Chords is disabled, Lyrics is the only radio left
  await openMenu();
  const lyrics = $$('[data-seg="word.mode"] [data-value]')[1];
  lyrics.focus();
  key(lyrics, 'ArrowRight');
  await tick();
  assert.equal(store['sbx.prefs'].word.mode, 'chords', 'the stored preference is untouched');
  key(document.activeElement, 'Escape');
  await tick();
  await showSong(hymn());
  assert.equal($$('[data-seg="word.mode"] [data-value]')[0].getAttribute('aria-checked'), 'true', 'later songs with chords still export with chords');
});

test('no song but a set list: the song tab points at the list, which still exports', async () => {
  assert.equal(text('#set-count'), '3');
  await status('not-songbase');
  assert.ok(visible('#welcome'));
  assert.equal(text('#welcome-title'), 'Open a song on Songbase');
  assert.ok(visible('#welcome-list'));
  assert.match(text('#welcome-list'), /^Your set list \(3 songs\) is on its own tab/);
  assert.deepEqual(exportButton(), []);
  await click('[data-tab="setlist"]');
  assert.equal(exportButton().length, 1);
  assert.ok(visible('#preview'));
  assert.equal(text('#preview-summary'), '3 songs · 2 pages');
  await click('[data-tab="song"]');
});

test('the tab needs a reload: the card offers it, and reloading works', async () => {
  // Empty the set list so nothing else is left to show, then lose the page.
  await click('[data-tab="setlist"]');
  await click('#setlist-clear');
  await click('[data-tab="song"]');
  await status('no-content-script');
  assert.ok(visible('#welcome'));
  assert.equal(text('#welcome-title'), 'Reload the Songbase tab');
  assert.ok(!visible('#welcome-list'));
  assert.ok(!visible('#banner'), 'the card already says it; no second notice above it');
  await click('#welcome-action');
  assert.deepEqual(chrome.tabs.reloaded, [1]);
});

test('the menu survives the song going away (another Chrome tab, say) and coming back', async () => {
  await showSong(hymn());
  await openMenu();
  await status('not-songbase');
  assert.ok(!visible('#export-menu'), 'nothing to export on this tab for the moment');
  assert.equal(document.activeElement, $('[data-tab="song"]'), 'focus moved to the tab, not to <body>');
  await showSong(hymn());
  assert.ok(visible('#export-menu'), 'back, and still open');
  assert.equal(document.activeElement, $('[data-tab="song"]'));
});

test('Escape in the set list name backs out of the field without closing the menu or committing the text', async () => {
  await click('#add-to-set');
  await click('[data-tab="setlist"]');
  assert.ok(visible('#export-menu'));
  const name = $('#setlist-name');
  name.focus();
  name.value = 'Half-typ';
  key(name, 'Escape');
  await tick();
  assert.ok(visible('#export-menu'), "Escape outside the menu is not the menu's business");
  assert.equal(document.activeElement, name, 'focus stays in the field');
  assert.equal(store[SETLIST_KEY].name, 'Set list', 'nothing was committed by a stolen blur');
  name.value = 'Set list';
  name.blur();
});

test('warnings on a set-list song show on the Set list tab, and the tooltip does not linger', async () => {
  const odd = long();
  odd.warnings = ['The chorus marker moved'];
  await click('[data-tab="song"]');
  await showSong(odd);
  assert.ok(visible('#banner'));
  assert.match(text('#banner-text'), /looks different than expected/);
  assert.equal($('#banner').title, 'The chorus marker moved');
  await click('#add-to-set');
  await showSong(hymn()); // a clean page song
  assert.ok(!visible('#banner'), 'the page song is fine');
  assert.equal($('#banner').title, '', 'no stale tooltip');
  await click('[data-tab="setlist"]');
  assert.ok(visible('#banner'), 'but one song in the list is not');
  assert.match(text('#banner-text'), /^1 song in the set list looked different than expected/);
  assert.equal($('#banner').title, 'The chorus marker moved');
  await click('[data-tab="song"]');
  assert.ok(!visible('#banner'));
});

test('a download is named for the song it was started from, even if the page moves on meanwhile', async () => {
  await showSong(hymn());
  await useFormat('word');
  $('[data-action="download-docx"]').click(); // no tick: the page changes while the .docx is being built
  await showSong(long());
  await tick(200);
  assert.match(chrome.downloads.saved.at(-1).filename, /^Placeholder Hymn of Testing\.docx$/);
  assert.equal(text('#song-title'), 'A Very Long Stanza');
});

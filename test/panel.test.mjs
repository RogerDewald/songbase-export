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
const toastText = () => `${text('#toast-text')}${visible('#toast-action') ? ` [${text('#toast-action')}]` : ''}`;
const titles = () => $$('.set-item .set-title').map((n) => n.textContent);

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

test('first run: a welcome card that says what to do, and nothing to export yet', async () => {
  assert.ok(visible('#welcome'));
  assert.equal(text('#welcome-title'), 'Open a song on Songbase');
  assert.ok(!visible('#dock'), 'no action bar without anything to export');
  assert.ok(!visible('#scope'));
  assert.ok(!visible('#add-to-set'), 'no dead Add button');
  assert.equal($$('[role="tabpanel"]').filter((p) => !p.hidden).length, 0);
  await click('#welcome-action');
  assert.deepEqual(chrome.tabs.opened, ['https://songbase.life/']);
});

test('a song arrives: header, Word preview, and the action bar for the Word tab', async () => {
  await showSong(hymn());
  assert.ok(!visible('#welcome'));
  assert.equal(text('#song-title'), 'Placeholder Hymn of Testing');
  assert.equal(text('#song-meta'), 'Hymnal #12 · Key: D · Capo 2');
  assert.ok(visible('#panel-word'));
  assert.equal(text('#word-summary'), '1 song · 1 page');
  assert.equal($$('.sbx-sheet').length, 1);
  assert.deepEqual($$('[data-dock]').filter((g) => !g.hidden).map((g) => g.dataset.dock), ['word']);
  assert.ok($$('[data-dock="word"] [data-action]').every((b) => !b.disabled));
  assert.deepEqual($$('[data-seg="word.mode"] [data-value]').map((b) => b.getAttribute('aria-checked')), ['true', 'false']);
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

test('a set list of three: two short songs share a page, and the panel says so', async () => {
  await showSong(refrain());
  await click('#add-to-set');
  await showSong(long());
  await click('#add-to-set');
  assert.equal(text('#set-count'), '3');

  await click('[data-scope="setlist"]');
  assert.equal(text('#word-summary'), '3 songs · 2 pages');
  assert.equal(text('#word-note'), 'One page holds two short songs.');
  const sheets = $$('.sbx-sheet');
  assert.deepEqual(sheets.map((s) => s.dataset.songs), ['2', '1']);
  assert.deepEqual($$('.pv-label').map((n) => n.textContent), ['Page 1 · two songs share this page', 'Page 2']);
  assert.equal(sheets[0].querySelectorAll('h1').length, 2);
});

test('turning "Fit two short songs on one page" off gives one song per page', async () => {
  const box = $('[data-pref="word.pairShort"]');
  assert.equal(box.checked, true, 'on by default');
  box.checked = false;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(text('#word-summary'), '3 songs · 3 pages');
  assert.ok(!visible('#word-note') || text('#word-note') === '');
  assert.equal($$('.sbx-sheet').length, 3);
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(text('#word-summary'), '3 songs · 2 pages');
});

test('Copy for Word puts the page plan on the clipboard and confirms', async () => {
  await click('[data-action="copy-word"]');
  const html = clipboard['text/html'];
  assert.ok(html, 'HTML flavour written');
  assert.equal((html.match(/border-top:\.75pt solid #BFBFBF/g) || []).length, 1, 'one rule: the second song of the shared page');
  assert.equal((html.match(/page-break-before:always/g) || []).length, 1, 'one page break: before the third song');
  assert.match(clipboard['text/plain'], /Placeholder Hymn of Testing/);
  assert.equal(toastText(), 'Copied. Paste into Word with Ctrl+V.');
  assert.ok($('[data-action="copy-word"]').classList.contains('is-done'), 'the button itself confirms');
});

test('Download .docx saves the same plan, and the toast can show the file', async () => {
  await click('[data-action="download-docx"]');
  await tick(150);
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
  await click('[data-scope="song"]');
  await showSong(refrain());
  const [chords, lyrics] = $$('[data-seg="word.mode"] [data-value]');
  assert.equal(chords.disabled, true);
  assert.equal(lyrics.getAttribute('aria-checked'), 'true');
  assert.equal(text('[data-panel="word"] [data-hint]'), 'This song has no chords, so it exports as lyrics.');
  await showSong(hymn());
  assert.equal($$('[data-seg="word.mode"] [data-value]')[0].disabled, false);
});

test('arrow keys move through a segmented control and save the choice', async () => {
  const [chords] = $$('[data-seg="word.mode"] [data-value]');
  chords.focus();
  chords.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await tick();
  assert.equal(store['sbx.prefs'].word.mode, 'lyrics');
  assert.equal(document.activeElement.dataset.value, 'lyrics');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
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

test('Text tab: the ChordPro style changes the file type on the button', async () => {
  await click('[data-tab="text"]');
  assert.deepEqual($$('[data-dock]').filter((g) => !g.hidden).map((g) => g.dataset.dock), ['text']);
  assert.equal(text('#txt-ext'), '.txt');
  await click('[data-seg="text.style"] [data-value="chordpro"]');
  assert.equal(text('#txt-ext'), '.cho');
  assert.match(text('#preview-text'), /\[D\]This is the \[G\]opening line/);
  await click('[data-seg="text.style"] [data-value="chords"]');
});

test('Set list tab: remove, clear and their Undo, and the dock only offers exports that make sense', async () => {
  await click('[data-tab="setlist"]');
  assert.ok(!visible('#scope'), 'no scope switch on the list itself');
  assert.deepEqual($$('[data-dock]').filter((g) => !g.hidden).map((g) => g.dataset.dock), ['setlist']);
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

  await click('#setlist-clear');
  assert.deepEqual(titles(), []);
  assert.ok(visible('#setlist-empty'));
  assert.ok(!visible('#setlist-tools'));
  assert.ok(!visible('#dock'), 'nothing to export, so no export buttons');
  assert.equal(toastText(), 'Cleared 3 songs. [Undo]');
  await click('#toast-action');
  assert.deepEqual(titles(), before);
  assert.ok(!visible('#setlist-empty'));
  assert.ok(visible('#dock'));
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

test('the tab needs a reload: the card offers it, and reloading works', async () => {
  // Empty the set list so nothing else is left to show, then lose the page.
  await click('[data-tab="setlist"]');
  await click('#setlist-clear');
  await click('[data-tab="word"]');
  await status('no-content-script');
  assert.ok(visible('#welcome'));
  assert.equal(text('#welcome-title'), 'Reload the Songbase tab');
  await click('#welcome-action');
  assert.deepEqual(chrome.tabs.reloaded, [1]);
});

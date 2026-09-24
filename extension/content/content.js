// Content script: serves the current song to side-panel Ports.
//
// - Watches the page only while at least one panel is connected.
// - Sends an update only after two identical extractions 150 ms apart, so a half-rendered
//   SPA navigation is never exported.
// - Adds book numbers ("Hymnal #N") and the canonical title from the page's own IndexedDB,
//   read-only and best-effort: it never creates, upgrades or holds that database open.
(function () {
  'use strict';
  if (globalThis.__sbxContentLoaded) return;
  globalThis.__sbxContentLoaded = true;

  const ports = new Set();
  let observer = null;
  let timer = null;
  let pendingSig = null;
  let sentSig = null;

  const alive = () => {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false; // extension was reloaded: this script is orphaned
    }
  };

  // ------------------------------------------------------------ IndexedDB lookups

  // Promise<Map<songId, [{name, number}]>>. The PROMISE is cached, so concurrent lookups
  // share one read instead of the second seeing a half-built map; an empty result (the
  // site may still be filling its cache on a first visit) is not kept, so it retries.
  let booksIndex = null;

  async function openSongbaseDb() {
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        if (!dbs.some((d) => d.name === 'songbaseDB')) return null;
      }
    } catch (e) {
      return null;
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (db) => {
        if (settled) {
          if (db) db.close();
          return;
        }
        settled = true;
        resolve(db);
      };
      const timeout = setTimeout(() => finish(null), 1500);
      let req;
      try {
        req = indexedDB.open('songbaseDB'); // no version: never triggers an upgrade of an existing DB
      } catch (e) {
        clearTimeout(timeout);
        return finish(null);
      }
      req.onupgradeneeded = () => {
        // Only happens if the DB does not exist: abort so we never create it.
        try {
          req.transaction.abort();
        } catch (e) {
          /* ignore */
        }
      };
      req.onsuccess = () => {
        clearTimeout(timeout);
        const db = req.result;
        db.onversionchange = () => db.close(); // let the site upgrade freely
        finish(db);
      };
      req.onerror = () => {
        clearTimeout(timeout);
        finish(null);
      };
    });
  }

  function read(db, store, op) {
    return new Promise((resolve) => {
      try {
        const req = op(db.transaction(store, 'readonly').objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function loadBooks(db) {
    const index = new Map();
    const books = (await read(db, 'books', (s) => s.getAll())) || [];
    for (const book of books) {
      for (const [id, number] of Object.entries(book.songs || {})) {
        const key = Number(id);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ name: String(book.name), number: String(number) });
      }
    }
    return index;
  }

  async function lookup(songId) {
    const db = await openSongbaseDb();
    if (!db) return { books: [], title: null };
    try {
      if (!booksIndex) {
        const pending = loadBooks(db);
        booksIndex = pending;
        pending.then((index) => {
          if (!index.size && booksIndex === pending) booksIndex = null;
        });
      }
      const index = await booksIndex;
      const record = await read(db, 'songs', (s) => s.get(songId));
      return { books: index.get(songId) || [], title: record && record.title ? String(record.title) : null };
    } finally {
      db.close();
    }
  }

  // ------------------------------------------------------------ extraction + sending

  function extractNow() {
    return globalThis.SBX_extract(document, location, window.localStorage);
  }

  async function messageFor(result) {
    if (!result.ok) return { type: 'status', status: result.reason };
    const song = result.song;
    try {
      const extra = await lookup(song.id);
      song.books = extra.books;
      if (extra.title) song.title = extra.title;
    } catch (e) {
      /* best effort */
    }
    return { type: 'song', song };
  }

  // Sends finish out of order when lookups take different times; only the newest one
  // may deliver. (A refresh reply that loses this race is covered by the broadcast the
  // refresh handler always schedules.)
  let sendSeq = 0;

  async function send(result, only) {
    const seq = ++sendSeq;
    const msg = await messageFor(result);
    if (seq !== sendSeq) return;
    for (const port of only ? [only] : [...ports]) {
      try {
        port.postMessage(msg);
      } catch (e) {
        ports.delete(port);
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, 150);
  }

  function tick() {
    if (!alive()) return shutdown();
    if (!ports.size) return;
    const result = extractNow();
    const sig = JSON.stringify(result);
    if (sig !== pendingSig) {
      pendingSig = sig; // wait until two consecutive reads agree
      return schedule();
    }
    if (sig === sentSig) return;
    sentSig = sig;
    send(result);
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-uncopyable-text', 'class'] });
    window.addEventListener('popstate', schedule);
  }

  function stopObserving() {
    if (observer) observer.disconnect();
    observer = null;
    window.removeEventListener('popstate', schedule);
    clearTimeout(timer);
    pendingSig = null;
    sentSig = null;
  }

  function shutdown() {
    stopObserving();
    for (const port of ports) {
      try {
        port.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    ports.clear();
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sbx') return;
    ports.add(port);
    startObserving();
    port.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'refresh') return;
      const result = extractNow();
      send(result, port);
      sentSig = null; // let the stability check re-confirm and broadcast
      pendingSig = JSON.stringify(result);
      schedule();
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (!ports.size) stopObserving();
    });
  });
})();

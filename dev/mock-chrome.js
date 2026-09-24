// Mock of the chrome.* APIs the side panel uses, for dev/harness.html. Classic script,
// injected before the panel's own scripts by dev/serve.mjs. Songs come from the
// placeholder fixtures in test/fixtures (invented text only).
(function () {
  'use strict';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const makeEvent = () => {
    const fns = new Set();
    return {
      addListener: (fn) => fns.add(fn),
      removeListener: (fn) => fns.delete(fn),
      emit: (...args) => fns.forEach((fn) => fn(...args)),
    };
  };

  const mock = {
    songs: {},
    current: 'hymn',
    status: null, // null = serve the song; otherwise a status string
    url: 'https://songbase.life/101',
    downloads: [],
    reloads: 0,
    port: null,
  };
  window.__mock = mock;

  const store = {};
  try {
    Object.assign(store, JSON.parse(localStorage.getItem('sbx-mock-storage') || '{}'));
  } catch (e) {
    /* start empty */
  }
  const persist = () => localStorage.setItem('sbx-mock-storage', JSON.stringify(store));

  const runtime = { id: 'mock-extension', lastError: undefined };
  const onActivated = makeEvent();
  const onUpdated = makeEvent();
  const onChanged = makeEvent();

  function makePort() {
    const onMessage = makeEvent();
    const onDisconnect = makeEvent();
    const port = {
      name: 'sbx',
      onMessage,
      onDisconnect,
      connected: true,
      postMessage(msg) {
        if (msg && msg.type === 'refresh') setTimeout(() => mock.push(), 30);
      },
      disconnect() {
        port.connected = false;
      },
      emit(msg) {
        if (port.connected) onMessage.emit(clone(msg));
      },
    };
    return port;
  }

  mock.push = () => {
    const port = mock.port;
    if (!port || !port.connected) return;
    if (mock.status) port.emit({ type: 'status', status: mock.status });
    else if (mock.songs[mock.current]) port.emit({ type: 'song', song: mock.songs[mock.current] });
  };
  mock.activate = () => onActivated.emit({ tabId: 1, windowId: 1 });
  mock.setSong = (name) => {
    mock.status = null;
    mock.current = name;
    mock.url = 'https://songbase.life/' + (mock.songs[name] ? mock.songs[name].id : 1);
    mock.activate();
  };
  mock.setStatus = (status) => {
    mock.status = status === 'not-songbase' || status === 'no-content-script' ? null : status;
    mock.url = status === 'not-songbase' ? 'https://example.com/' : 'https://songbase.life/101';
    mock.noContentScript = status === 'no-content-script';
    mock.activate();
  };
  const STEPS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  const ALIASES = { 'A#': 'Bb', 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab' };
  mock.transpose = (delta) => {
    const song = mock.songs[mock.current];
    if (!song) return;
    song.transpose = (song.transpose || 0) + delta;
    for (const g of song.groups) {
      for (const p of g.parts) {
        for (const l of p.lines || []) {
          for (const c of l.chords) {
            c.name = c.name.replace(/([A-G][b#]?)/g, (root) => {
              const i = STEPS.indexOf(ALIASES[root] || root);
              return i < 0 ? root : STEPS[(i + delta + 120) % 12];
            });
          }
        }
      }
    }
    mock.push();
  };
  mock.setChordsHidden = (hidden) => {
    const song = mock.songs[mock.current];
    if (!song) return;
    if (hidden) {
      song._chords = song._chords || song.groups.map((g) => g.parts.map((p) => (p.lines || []).map((l) => l.chords)));
      song.groups.forEach((g) => g.parts.forEach((p) => (p.lines || []).forEach((l) => (l.chords = []))));
    } else if (song._chords) {
      song.groups.forEach((g, gi) => g.parts.forEach((p, pi) => (p.lines || []).forEach((l, li) => (l.chords = song._chords[gi][pi][li]))));
    }
    song.chordsHidden = hidden;
    mock.push();
  };

  window.chrome = {
    runtime,
    tabs: {
      async query() {
        return [{ id: 1, windowId: 1, active: true, url: mock.url }];
      },
      connect() {
        const port = makePort();
        mock.port = port;
        if (mock.noContentScript) {
          setTimeout(() => {
            port.connected = false; // like Chrome: a dead port delivers nothing more
            runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
            port.onDisconnect.emit(port);
            runtime.lastError = undefined;
          }, 20);
        }
        return port;
      },
      onActivated,
      onUpdated,
      async reload() {
        mock.reloads++;
        mock.noContentScript = false;
        setTimeout(() => onUpdated.emit(1, { status: 'complete' }), 50);
      },
    },
    storage: {
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
          persist();
          onChanged.emit(changes, 'local');
        },
      },
      onChanged,
    },
    downloads: {
      async download({ url, filename }) {
        const blob = await (await fetch(url)).blob();
        mock.downloads.push({ filename, size: blob.size, type: blob.type });
        return mock.downloads.length;
      },
    },
  };

  import('/test/fixtures/songs.mjs').then((m) => {
    mock.songs = { hymn: m.hymn(), refrain: m.refrain(), long: m.long() };
    mock.ready = true;
    mock.push();
  });
})();

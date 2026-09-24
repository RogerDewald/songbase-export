// Keeps the panel connected to the songbase.life tab that is active in ITS window.
// One Port per connection; reconnects on tab switch, navigation and page reload.

const SONGBASE = /^https:\/\/songbase\.life\//;

export function createTabLink(chromeApi, { onSong, onStatus }) {
  let port = null;
  let tabId = null;
  let windowId = null;
  let generation = 0;

  function drop() {
    if (!port) return;
    const p = port;
    port = null;
    try {
      p.disconnect();
    } catch {
      /* already gone */
    }
  }

  async function refresh() {
    const gen = ++generation;
    let tab = null;
    try {
      [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    } catch {
      tab = null;
    }
    if (gen !== generation) return;
    drop();
    if (!tab) return onStatus({ status: 'no-tab' });
    tabId = tab.id;
    windowId = tab.windowId;
    // Without host permission for a site, tab.url is undefined: not Songbase either way.
    if (!SONGBASE.test(tab.url || '')) return onStatus({ status: 'not-songbase', tabId });

    onStatus({ status: 'connecting', tabId });
    let p;
    try {
      p = chromeApi.tabs.connect(tab.id, { name: 'sbx' });
    } catch {
      return onStatus({ status: 'no-content-script', tabId });
    }
    port = p;
    p.onMessage.addListener((msg) => {
      if (gen !== generation || !msg) return;
      if (msg.type === 'song') onSong(msg.song, tab.id);
      else if (msg.type === 'status') onStatus({ status: msg.status, tabId: tab.id });
    });
    p.onDisconnect.addListener(() => {
      const err = chromeApi.runtime.lastError; // must be read, or Chrome logs it as unchecked
      if (gen !== generation) return;
      port = null;
      const missing = /Receiving end does not exist|Could not establish connection/i.test(err?.message || '');
      onStatus({ status: missing ? 'no-content-script' : 'disconnected', tabId: tab.id });
    });
    try {
      p.postMessage({ type: 'refresh' });
    } catch {
      /* onDisconnect reports it */
    }
  }

  chromeApi.tabs.onActivated.addListener((info) => {
    if (windowId === null || info.windowId === windowId) refresh();
  });
  chromeApi.tabs.onUpdated.addListener((id, change) => {
    if (id === tabId && (change.url || change.status === 'complete')) refresh();
  });

  return {
    refresh,
    get tabId() {
      return tabId;
    },
    requestSong() {
      try {
        port?.postMessage({ type: 'refresh' });
      } catch {
        refresh();
      }
    },
  };
}

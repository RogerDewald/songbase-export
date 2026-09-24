// A tiny storage-area interface so stores run on chrome.storage.local in the extension
// and on memory in Node tests:  { get(key), set(key, value), subscribe(key, cb) }.

export function chromeArea(chromeApi, areaName = 'local') {
  const area = chromeApi.storage[areaName];
  return {
    async get(key) {
      const out = await area.get(key);
      return out ? out[key] : undefined;
    },
    set: (key, value) => area.set({ [key]: value }),
    subscribe(key, cb) {
      const listener = (changes, name) => {
        if (name === areaName && changes[key]) cb(changes[key].newValue);
      };
      chromeApi.storage.onChanged.addListener(listener);
      return () => chromeApi.storage.onChanged.removeListener(listener);
    },
  };
}

export function memoryArea(initial = {}) {
  const data = { ...initial };
  const subs = new Map();
  return {
    data,
    async get(key) {
      return data[key] === undefined ? undefined : structuredClone(data[key]);
    },
    async set(key, value) {
      data[key] = structuredClone(value);
      for (const cb of subs.get(key) || []) cb(structuredClone(value));
    },
    subscribe(key, cb) {
      if (!subs.has(key)) subs.set(key, new Set());
      subs.get(key).add(cb);
      return () => subs.get(key).delete(cb);
    },
  };
}

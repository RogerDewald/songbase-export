// Service worker: the toolbar icon (and Alt+Shift+S) opens the side panel; the badge
// shows how many songs are in the set list.

const SETLIST_KEY = 'sbx.setlist';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.warn('setPanelBehavior', err));

async function updateBadge() {
  const stored = await chrome.storage.local.get(SETLIST_KEY);
  const count = stored[SETLIST_KEY]?.items?.length || 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#2B5797' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETLIST_KEY]) updateBadge();
});
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

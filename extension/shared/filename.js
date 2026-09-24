// File names that Windows (and chrome.downloads) will accept.

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MAX_BASE = 120;

export function safeFileName(base, ext) {
  let name = String(base ?? '')
    .normalize('NFC')
    // Chromium's IsFilenameLegal rejects control (Cc) and format (Cf) characters anywhere
    // (soft hyphen, zero-width space/joiners, bidi marks ...), and noncharacters.
    .replace(/[\p{Cc}\p{Cf}﷐-﷯￾￿]/gu, '')
    .replace(/[<>:"/\\|?*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')      // a leading dot makes a hidden file / is rejected by chrome.downloads
    .replace(/[. ]+$/, '');   // Windows silently strips trailing dots and spaces
  if (name.length > MAX_BASE) name = name.slice(0, MAX_BASE).replace(/[. ]+$/, '');
  if (!name) name = 'song';
  if (RESERVED.test(name)) name = `_${name}`;
  const cleanExt = String(ext ?? '').replace(/^\.+/, '');
  return cleanExt ? `${name}.${cleanExt}` : name;
}

export function isoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

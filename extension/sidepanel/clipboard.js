// Clipboard writes. The caller passes a PREBUILT payload so the write starts inside the
// click handler with nothing awaited first (clipboard access needs the user activation
// that the click provides; the extension's clipboardWrite permission covers the rest).

export async function copyRich({ html = null, text = '' }) {
  // Rich HTML goes through the classic copy event first: it hands our markup to the
  // clipboard untouched. The async Clipboard API may re-serialise HTML, and Word-only
  // styles (mso-tab-count, mso-pagination) would not survive a CSS round-trip.
  if (html && execCommandCopy({ html, text })) return 'execCommand';
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const flavours = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
      if (html) flavours['text/html'] = new Blob([html], { type: 'text/html' });
      await navigator.clipboard.write([new ClipboardItem(flavours)]);
      return 'async';
    }
  } catch {
    /* fall through */
  }
  if (!html && execCommandCopy({ html, text })) return 'execCommand';
  return null;
}

// A one-shot `copy` listener supplies both flavours. A throwaway selection makes sure
// the copy event fires at all.
function execCommandCopy({ html, text }) {
  let wrote = false;
  const onCopy = (event) => {
    event.clipboardData.setData('text/plain', text);
    if (html) event.clipboardData.setData('text/html', html);
    event.preventDefault();
    wrote = true;
  };
  const holder = document.createElement('span');
  holder.textContent = ' ';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre;user-select:text';
  document.body.appendChild(holder);
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection.removeAllRanges();
  selection.addRange(range);
  document.addEventListener('copy', onCopy, true);
  try {
    return document.execCommand('copy') && wrote;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    selection.removeAllRanges();
    holder.remove();
  }
}

// Saves a Blob as a file in the user's Downloads folder. Resolves to Chrome's download id
// (so the caller can offer "Show in folder"), or null when the plain-link fallback was used.

export async function downloadBlob(chromeApi, blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chromeApi?.downloads?.download) {
      return await chromeApi.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return null;
  } finally {
    // Revoking at once can cancel the download before Chrome has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

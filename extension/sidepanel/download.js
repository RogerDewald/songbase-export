// Saves a Blob as a file in the user's Downloads folder.

export async function downloadBlob(chromeApi, blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chromeApi?.downloads?.download) {
      await chromeApi.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    // Revoking at once can cancel the download before Chrome has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

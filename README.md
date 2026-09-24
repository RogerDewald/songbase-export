# Songbase Export

A Chrome extension that exports songs from [songbase.life](https://songbase.life) to
**Word**, **plain text** or **PowerPoint**, with chords, verse numbers and choruses intact.
It can export one song or a whole **set list** of songs.

## Why copy/paste doesn't work on Songbase

Songbase draws chords and verse numbers with CSS. They are not real text in the page, so
selecting a song and copying it drops every chord and verse number and flattens the
chorus indent. This extension reads the song as it is shown, including your transpose,
the selected tune and whether chords are on. It then writes each format properly.

## Which export to use

| You want… | Use | Notes |
|---|---|---|
| A song sheet in **Word** | **Copy for Word**, then Ctrl+V in Word | Keeps the bold title, hymn number, verse numbers with hanging indents and the indented chorus. Chords sit above the words in a fixed-width font (Consolas). |
| A **Word file** to keep or print | **Download .docx** | Uses named styles (*Verse*, *Chorus*, *Chord*, *Verse Number*, *Song Meta*), so you can restyle every chord or verse in one click. Each song starts on a new page. |
| **Plain text** (email, messages, notes) | **Copy text** with *Chords over lyrics* or *Lyrics only* | Chords line up in any fixed-width font. |
| A **music app** (OnSong, SongbookPro, Planning Center, ChordPro tools) | **Copy text** or **Download** with *ChordPro* | Saved as `.cho`. |
| **PowerPoint** slides | **Download .pptx** | Pasted text always lands on one slide, so the extension builds the deck itself: one slide per verse or chorus, a title slide, and text sized to fit. The chorus can repeat after every verse. Chords go in the speaker notes. |

## Install (one time)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder inside this repository
   (download it with **Code → Download ZIP** and unzip it first, or clone it).
4. Click the puzzle-piece icon in the toolbar and **pin** "Songbase Export".
5. If a songbase.life tab was already open, reload it once.

To update after changing files, click the reload icon on the extension's card in
`chrome://extensions` and reload the Songbase tab.

## Use

1. Open a song on songbase.life. Transpose it or pick a tune there if you like.
2. Click the extension icon (or press **Alt+Shift+S**). The side panel opens and stays open
   while you move between songs.
3. Pick **Word**, **Text** or **PowerPoint**, adjust the options and check the preview.
   Then copy or download.
4. **Set list:** on each song, press **+ Set list**. Each song keeps the key it was in when
   you added it. In any format tab, switch *This song / Set list* to export the whole list
   as one document or one deck. Reorder, rename or clear the list on the **Set list** tab.
   The toolbar badge shows how many songs are in it.

Tips:
- If Songbase hides chords (its ♫ button), the export has no chords. Turn them back on to
  include them.
- The panel says **Reload tab** if the tab was open before the extension was installed or
  reloaded.
- Downloaded Office files may open in *Protected View*. Click **Enable Editing**.
- The shortcut can be changed at `chrome://extensions/shortcuts`.

## Credits

- [Songbase](https://github.com/ReganRyanNZ/songbase) by Regan Ryan (MIT License). Key
  detection and the markup rules used in tests are derived from its code.
- [JSZip](https://stuk.github.io/jszip/) and [PptxGenJS](https://gitbrent.github.io/PptxGenJS/)
  are bundled for building the .docx and .pptx files.

Full licence notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Privacy

Everything happens in your browser. The extension makes no network requests of its own.
It reads the song from the Songbase page, and hymn numbers from the site's own local cache
(read-only). Your set list and settings are stored in Chrome's extension storage on this
computer.

Exports are for your own use. Projecting or printing copyrighted songs is covered by your
church's licence (for example CCLI), not by this tool.

## Acceptance checklist

- [ ] The icon and Alt+Shift+S open the panel on a Songbase song.
- [ ] Transposing on Songbase updates the preview (the header shows *transposed +N*).
- [ ] **Copy for Word** → Ctrl+V in Word, in both *Chords above words* and *Lyrics only*.
- [ ] **Download .docx** and **Download .pptx** open in Word and PowerPoint.
- [ ] **Copy text** → paste into Notepad; the chords line up.
- [ ] Add 2–3 songs to the set list, restart Chrome, and they are still there.
- [ ] On a non-Songbase tab the panel shows only the set list, and it still exports.
- [ ] After reloading the extension, the panel's **Reload tab** button recovers.

## For developers

Requires Node 24.15 or newer (jsdom needs it). Office checks need Windows with Word and PowerPoint installed.

```
npm install          # pinned dev deps: jszip, pptxgenjs, jsdom
npm test             # unit tests (node:test)
npm run vendor       # copy the pinned browser builds into extension/vendor
npm run samples      # write sample .docx/.pptx/.html/.txt into out/ (placeholder songs)
npm run harness      # side panel with a mocked chrome API at http://localhost:5173/
```

Office checks (these open Word/PowerPoint invisibly and never close documents you have open):

```
pwsh -File test/office/verify-docx.ps1
pwsh -File test/office/verify-pptx.ps1
node tools/cfhtml.mjs out/sample-word-lyrics.html out/sample-word-chords.html
powershell -NoProfile -STA -File test/office/verify-paste.ps1
```

To check the real Chrome clipboard path, open the panel on a Songbase song and choose
*Lyrics only*. Click **Copy for Word**, then run:

```
powershell -NoProfile -STA -File test/office/verify-paste.ps1 -FromClipboard
```

It pastes into a hidden Word document and reports tabs, indents, keep-together and page breaks.

Live-site check of the extractor: paste `extension/content/extract.js`, then
`tools/live-check.js`, into DevTools on any songbase.life page. Then run
`await SBX_liveCheck({ sample: 30 })`. It prints counts and song ids only.

Layout:

```
extension/            the unpacked extension (nothing dev-only inside)
  content/            extract.js (DOM → song model), content.js (panel link, cache lookups)
  sidepanel/          the UI
  shared/             pure renderers: text, Word HTML, .docx, slides/.pptx, set list, prefs
  vendor/             jszip 3.10.1, pptxgenjs 4.0.1 (MIT)
dev/                  harness + mock chrome API
test/                 unit tests, fixtures (invented placeholder lyrics only), Office checks
tools/                vendoring, samples, icons, clipboard/live-site helpers
```

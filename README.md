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
| A **Word file** to keep or print | **Download .docx** | Uses named styles (*Verse*, *Chorus*, *Chord*, *Verse Number*, *Song Meta*), so you can restyle every chord or verse in one click. Each song starts on its own page, unless two neighbouring songs both fit whole on one page (see below). |
| **Plain text** (email, messages, notes) | **Copy text** or **Download .txt** with *Chords + lyrics* or *Lyrics only* | Chords line up in any fixed-width font. |
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
3. The panel has two tabs: **This song** and **Set list**. Whichever tab is open is what gets
   exported. Press **Export** and pick **Text**, **Word** or **PowerPoint** in the menu that
   opens under the button (Text is selected to begin with). The menu stays open until you press
   **Export** again or Esc, and it follows you between the tabs. On **This song** the preview
   sits right below it; on **Set list** the list of songs comes first and the preview follows.
   The choice that matters most (chords above the words or lyrics only, text
   style, slide colours) is right there; fonts and the rest are under **Options**, which
   shows a one-line summary and remembers whether you left it open. The rows at the bottom
   of the menu copy or download (**Copy for Word**, **Download .docx**, **Copy text**,
   **Download .txt**, **Download .pptx**). The preview under the tab follows the format you
   picked and updates as you change options.
4. **Set list:** on each song, press **Add to set list** (it turns into **In set list** once the
   song is there in that key). Each song keeps the key it was in when you added it. On the
   **Set list** tab, **Export** exports the whole list as one document or one deck; drag songs
   by the grip (or use the arrows) to reorder them, and rename the list; removing a song or
   clearing the list has an **Undo** in the message that appears. The tab and the toolbar
   badge both show how many songs are in the list.

### Pages in Word

With **Fit two short songs on one page** on (the default; it is under *Fonts & options*),
every song starts on its own page, except that two neighbouring songs share a page when
**both fit whole** on it. A song is never split to make that work, songs are never
reordered (a set list stays in worship order), and never more than two share a page.
The second song of a shared page gets a thin rule above its title. The preview shows the
pages as they will fall ("Page 2 · two songs share this page"), with a page count.

How it decides: the panel measures each song with the real font, works out its height the
way Word lays it out, and pairs songs only when the two, plus the space between them, fit
in a page with a little to spare. It plans for a page with Word's standard one-inch margins,
so the plan also holds when you paste ("Copy for Word") into a blank document (your own
template may have other margins). If Word ever disagrees, nothing gets cut in half: the
second song of a shared page is set to keep together, so Word moves it whole to the next
page. Untick the option for one song per page.

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
- [ ] A set list with a few short songs and a long one: **Download .docx** puts two short
      neighbours on one page (rule between them), the long song on its own page, and no song
      is cut across two pages. Unticking *Fit two short songs on one page* gives one per page.
- [ ] **Copy text** → paste into Notepad; the chords line up.
- [ ] Add 2–3 songs to the set list, restart Chrome, and they are still there.
- [ ] Remove a song and clear the set list; **Undo** brings them back in place.
- [ ] On a non-Songbase tab, **This song** says to open one and the **Set list** tab still exports.
- [ ] **Export** opens the menu under the button on both tabs; on **This song** the preview is right below it. Esc (from inside the menu) or the button closes it; switching tabs or clicking elsewhere does not.
- [ ] With the menu open, switch to a non-Songbase tab and back: the menu is still open.
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
node tools/cfhtml.mjs out/sample-word-lyrics.html out/sample-word-chords.html out/sample-word-pairs.html out/sample-word-forced.html out/sample-word-forced-comment.html
powershell -NoProfile -STA -File test/office/verify-paste.ps1
pwsh -File test/office/verify-pages.ps1
powershell -NoProfile -STA -File test/office/verify-pages.ps1 -Paste
```

`verify-pages.ps1` checks the page-sharing feature against Word's real layout: songs start on
the pages the plan says and none is split (including deliberately over-paired samples, one
whose first song ends with a comment, that must fall back to one song per page), the
planner's height estimate is within 1.5% of Word's,
and the per-font line heights in `pagination.js` match Word's. Run it after changing fonts,
sizes, spacing or `pagination.js`. (`-Paste` replaces the clipboard contents.)

To check the real Chrome clipboard path, open the panel on a Songbase song, press **Export**,
pick **Word** and *Lyrics only*, click **Copy for Word**, then run:

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
  shared/             pure renderers: text, Word HTML, .docx, slides/.pptx, set list, prefs,
                      and pagination.js (which Word songs share a page)
  vendor/             jszip 3.10.1, pptxgenjs 4.0.1 (MIT)
dev/                  harness + mock chrome API
test/                 unit tests, fixtures (invented placeholder lyrics only), Office checks
tools/                vendoring, samples, icons, clipboard/live-site helpers
```

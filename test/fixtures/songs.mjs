// Fixture songs. Every word here is invented placeholder text written for these tests.
import { songFromMarkup } from '../helpers.mjs';

export const HYMN_MARKUP = `# Tune: Placeholder melody
#capo 2

1
[D]This is the [G]opening line of [A]verse one
The [D]second line keeps the [A]test going
[G]Third line for [D]checking layout
[A]Fourth line ends [D]here

  [G]Chorus words are [D]indented here
  [A]Sing the refrain [D]again

2
Second verse has no chords at all
Another line of simple placeholder words
Third line of the second verse
Last line of the second verse

3
Third verse line one for testing
Third verse line two for testing
Third verse line three for testing
Third verse line four for testing`;

export const REFRAIN_MARKUP = `Opening words of a song without numbers
Here a tie joins two_words together
  An indented refrain line inside the verse
Back to the verse for the closing line

Second group opening line
Second group closing line`;

export const LONG_MARKUP = `1
Line one of a long stanza,
Line two of a long stanza;
Line three of a long stanza
Line four of a long stanza.
Line five of a long stanza
Line six of a long stanza
Line seven of a long stanza
Line eight of a long stanza
Line nine of a long stanza
Line ten of a long stanza`;

export const hymn = () =>
  songFromMarkup(HYMN_MARKUP, { id: 101, title: 'Placeholder Hymn of Testing', books: [{ name: 'Hymnal', number: '12' }] });
export const refrain = () => songFromMarkup(REFRAIN_MARKUP, { id: 202, title: 'Song With A Refrain' });
export const long = () => songFromMarkup(LONG_MARKUP, { id: 303, title: 'A Very Long Stanza' });

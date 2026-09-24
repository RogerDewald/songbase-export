// Key detection, ported from Songbase's own `getKeyFromChords` so the "Key:" line
// agrees with what the site would say for the chords being displayed.
//
// Site algorithm: take the root of the first chord in every [..] (A–G, optional b/#,
// optional m); if the first root equals the last, that is the key (a minor root becomes
// its relative major); otherwise pick the key whose common-chord list contains the most
// roots, ties going to the earliest entry of KEYS.
//
// Two deliberate fixes over the site (sitePure:true reproduces the site exactly):
//  1. Sharp spellings are compared by pitch, so C#m resolves to E instead of falling
//     off the flat-spelled KEYS table (the site returns B there).
//  2. "maj" is not read as minor: the site takes [Dmaj7] as a D-minor chord.

export const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];

export const KEY_COMMON_CHORDS = {
  A: ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
  Bb: ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm'],
  B: ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m'],
  C: ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
  Db: ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm'],
  D: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
  Eb: ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm'],
  E: ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'],
  F: ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
  Gb: ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm'],
  G: ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
  Ab: ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm'],
};

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod12 = (n) => ((n % 12) + 12) % 12;

function pitchClass(root) {
  const base = LETTER_PC[root[0]];
  if (base === undefined) return -1;
  const acc = root.slice(1);
  return mod12(base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
}

// "Gb" / "F#m" -> "6" / "6m": a spelling-independent token.
function canon(root) {
  const minor = root.endsWith('m');
  const pc = pitchClass(minor ? root.slice(0, -1) : root);
  return pc < 0 ? null : `${pc}${minor ? 'm' : ''}`;
}

const COMMON_CANON = Object.fromEntries(
  Object.entries(KEY_COMMON_CHORDS).map(([key, list]) => [key, list.map(canon)]),
);

const SITE_ROOT = /^([A-G][b#]?m?)/;
const FIXED_ROOT = /^([A-G][b#]?)(m(?!aj))?/;

export function chordRoot(name, { sitePure = false } = {}) {
  if (sitePure) {
    const m = SITE_ROOT.exec(name);
    return m ? m[1] : null;
  }
  const m = FIXED_ROOT.exec(name);
  return m ? m[1] + (m[2] ? 'm' : '') : null;
}

export function detectKey(chordNames, { sitePure = false } = {}) {
  const roots = [];
  for (const name of chordNames || []) {
    const root = chordRoot(String(name), { sitePure });
    if (root) roots.push(root);
  }
  if (!roots.length) return null;

  const first = roots[0];
  const last = roots[roots.length - 1];
  if (first === last) {
    if (!first.endsWith('m')) return first;
    const major = first.slice(0, -1);
    if (sitePure) {
      // Site: keys.indexOf() of a sharp spelling is -1, which still indexes the table.
      return KEYS[mod12(KEYS.indexOf(major) + 3)];
    }
    return KEYS[mod12(KEYS.indexOf(KEYS.find((k) => pitchClass(k) === pitchClass(major))) + 3)];
  }

  const counts = KEYS.map((key) =>
    sitePure
      ? roots.filter((r) => KEY_COMMON_CHORDS[key].includes(r)).length
      : roots.filter((r) => COMMON_CANON[key].includes(canon(r))).length,
  );
  const best = Math.max(...counts);
  const key = KEYS[counts.indexOf(best)];
  if (sitePure) return key;

  // Spell the two common sharp keys the way the chords are spelled.
  const sharps = roots.filter((r) => r.includes('#')).length;
  const flats = roots.filter((r) => /^[A-G]b/.test(r)).length;
  if (sharps > flats) return { Gb: 'F#', Db: 'C#' }[key] || key;
  return key;
}

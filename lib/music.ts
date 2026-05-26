const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_INDEX: Record<string, number> = {
  'C':0, 'C#':1, 'Db':1, 'D':2, 'D#':3, 'Eb':3,
  'E':4, 'F':5, 'F#':6, 'Gb':6,
  'G':7, 'G#':8, 'Ab':8, 'A':9, 'A#':10, 'Bb':10, 'B':11,
};

// Scale degree intervals and expected chord qualities
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'];

const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // natural minor
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''];

export interface ChordLike { chord: string }

/** All chords that are diatonic to the given key (e.g. "G major", "A minor") */
export function getDiatonicChords(key: string): Set<string> {
  const m = key.match(/^([A-G][#b]?) (major|minor)$/);
  if (!m) return new Set();

  const root = NOTE_INDEX[m[1]];
  const isMajor = m[2] === 'major';
  const intervals = isMajor ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const quals     = isMajor ? MAJOR_QUALITIES : MINOR_QUALITIES;

  const chords = new Set<string>();

  for (let deg = 0; deg < 7; deg++) {
    const note = NOTE_NAMES[(root + intervals[deg]) % 12];
    const q    = quals[deg];

    chords.add(note + q); // basic triad

    if (q === '') {
      chords.add(note + 'maj7');
      chords.add(note + 'sus2');
      chords.add(note + 'sus4');
      chords.add(note + 'add9');
      if (isMajor && deg === 4) chords.add(note + '7'); // V7 in major
    }
    if (q === 'm') {
      chords.add(note + 'm7');
    }
  }

  // Harmonic minor: also include V major and V7
  if (!isMajor) {
    const vNote = NOTE_NAMES[(root + 7) % 12];
    chords.add(vNote);
    chords.add(vNote + '7');
  }

  return chords;
}

// ── Random progression generator ─────────────────────────────────────────────

// Degree indices (0 = I/i … 6 = vii/VII). Avoids dim chords (deg 6 major, deg 1 minor).
const MAJOR_PATTERNS: number[][] = [
  [0, 4, 5, 3], // I  – V  – vi – IV  (the evergreen)
  [0, 5, 3, 4], // I  – vi – IV – V
  [0, 3, 4, 0], // I  – IV – V  – I
  [0, 3, 5, 4], // I  – IV – vi – V
  [5, 3, 0, 4], // vi – IV – I  – V
  [0, 1, 3, 4], // I  – ii – IV – V
  [0, 5, 1, 4], // I  – vi – ii – V
  [3, 0, 4, 0], // IV – I  – V  – I
];

const MINOR_PATTERNS: number[][] = [
  [0, 5, 2, 6], // i  – VI – III – VII
  [0, 5, 6, 0], // i  – VI – VII – i
  [0, 3, 6, 2], // i  – iv – VII – III
  [0, 3, 4, 0], // i  – iv – v   – i
  [0, 6, 5, 6], // i  – VII– VI  – VII
  [0, 2, 6, 5], // i  – III– VII – VI
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export interface RandomProgression {
  chords: string[];
  bpm:    number;
  key:    string;
}

/** Generate a random 4-chord diatonic progression with a randomised BPM. */
export function randomProgression(): RandomProgression {
  const root     = NOTE_NAMES[Math.floor(Math.random() * 12)];
  const isMajor  = Math.random() > 0.4; // slight bias toward major
  const rootIdx  = NOTE_INDEX[root];
  const intervals = isMajor ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const qualities = isMajor ? MAJOR_QUALITIES : MINOR_QUALITIES;

  // Build the 7 diatonic chord names
  const diatonic = intervals.map((iv, deg) =>
    NOTE_NAMES[(rootIdx + iv) % 12] + qualities[deg],
  );

  const pattern = pick(isMajor ? MAJOR_PATTERNS : MINOR_PATTERNS);
  const chords  = pattern.map(deg => diatonic[deg]);

  // BPM: multiples of 5 between 70 and 155
  const bpm = 70 + Math.floor(Math.random() * 18) * 5;

  return { chords, bpm, key: `${root} ${isMajor ? 'major' : 'minor'}` };
}

export function detectKey(chords: ChordLike[]): string {
  if (chords.length === 0) return '';

  // Count occurrences so repeated chords carry more weight
  const counts = new Map<string, number>();
  for (const { chord } of chords) {
    counts.set(chord, (counts.get(chord) ?? 0) + 1);
  }

  let bestScore = -1;
  let bestKey = '';

  for (let root = 0; root < 12; root++) {
    let majorScore = 0;
    let minorScore = 0;

    for (const [chord, count] of counts) {
      const m = chord.match(/^([A-G][#b]?)(.*)/);
      if (!m) continue;
      const chordRoot = NOTE_INDEX[m[1]];
      const quality = m[2];
      if (chordRoot === undefined) continue;

      const interval = (chordRoot - root + 12) % 12;

      // ── Major key ──────────────────────────────────────────
      const mDeg = MAJOR_INTERVALS.indexOf(interval);
      if (mDeg >= 0) {
        const exp = MAJOR_QUALITIES[mDeg];
        if (quality === exp)                                    majorScore += 2 * count;
        else if (mDeg === 4 && quality === '7')                 majorScore += 2 * count; // V7 is diatonic
        else if (quality === 'm7'   && exp === 'm')             majorScore += 1.5 * count;
        else if (quality === 'maj7' && exp === '')              majorScore += 1.5 * count;
        else if (quality.startsWith('sus') || quality === 'add9') majorScore += 0.8 * count;
        else                                                    majorScore += 0.2 * count;
      } else if (quality.startsWith('sus') || quality === 'add9') {
        majorScore += 0.4 * count; // sus/add9 are tonally flexible
      }

      // ── Minor key (natural + harmonic) ──────────────────────
      const nDeg = MINOR_INTERVALS.indexOf(interval);
      if (nDeg >= 0) {
        const exp = MINOR_QUALITIES[nDeg];
        if (quality === exp)                                    minorScore += 2 * count;
        else if (nDeg === 4 && (quality === '' || quality === '7')) minorScore += 2 * count; // V / V7 harmonic minor
        else if (quality === 'm7'   && exp === 'm')             minorScore += 1.5 * count;
        else if (quality === 'maj7' && exp === '')              minorScore += 1.5 * count;
        else if (quality.startsWith('sus') || quality === 'add9') minorScore += 0.8 * count;
        else                                                    minorScore += 0.2 * count;
      } else if (quality.startsWith('sus') || quality === 'add9') {
        minorScore += 0.4 * count;
      }
    }

    // Tiebreaker: first chord being the tonic is a strong signal
    const first = chords[0]?.chord;
    if (first) {
      const m = first.match(/^([A-G][#b]?)(.*)/);
      if (m && NOTE_INDEX[m[1]] === root) {
        if (m[2] === '')  majorScore += 0.5;
        if (m[2] === 'm') minorScore += 0.5;
      }
    }

    if (majorScore > bestScore) { bestScore = majorScore; bestKey = NOTE_NAMES[root] + ' major'; }
    if (minorScore > bestScore) { bestScore = minorScore; bestKey = NOTE_NAMES[root] + ' minor'; }
  }

  return bestKey; // e.g. "G major", "A minor"
}

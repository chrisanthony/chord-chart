// Chord notes and guitar shapes

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_INDEX: Record<string, number> = {
  'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
  'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,
};
const QUALITY_INTERVALS: Record<string, number[]> = {
  '':     [0, 4, 7],
  'm':    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7':   [0, 3, 7, 10],
  'dim':  [0, 3, 6],
  'aug':  [0, 4, 8],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'add9': [0, 4, 7, 2],
};

export const QUALITY_LABELS: Record<string, string> = {
  '': 'Major', 'm': 'Minor', '7': 'Dominant 7th', 'maj7': 'Major 7th',
  'm7': 'Minor 7th', 'dim': 'Diminished', 'aug': 'Augmented',
  'sus2': 'Sus 2', 'sus4': 'Sus 4', 'add9': 'Add 9',
};

export function getChordNotes(chordName: string): string[] {
  const m = chordName.match(/^([A-G][#b]?)(.*)/);
  if (!m) return [];
  const root = NOTE_INDEX[m[1]];
  if (root === undefined) return [];
  const intervals = QUALITY_INTERVALS[m[2]] ?? ([0, 4, 7] as number[]);
  return intervals.map(i => NOTE_NAMES[(root + i) % 12]);
}

export function getQualityLabel(chordName: string): string {
  const m = chordName.match(/^([A-G][#b]?)(.*)/);
  if (!m) return '';
  const q = m[2];
  return QUALITY_LABELS[q] ?? (q || 'Major');
}

// ── Guitar shapes ─────────────────────────────────────────────────────────────
// frets: [E6, A5, D4, G3, B2, e1], -1=muted, 0=open, n=absolute fret
// baseFret: lowest fret shown in diagram (usually 1)
// barre: absolute fret where barre crosses all strings

export interface GuitarShape {
  frets: number[];
  baseFret: number;
  barre?: number;
}

// Hand-coded open/common shapes
const SHAPES: Record<string, GuitarShape> = {
  // Major
  'C':     { frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 },
  'D':     { frets: [-1, -1, 0, 2, 3, 2], baseFret: 1 },
  'E':     { frets: [0, 2, 2, 1, 0, 0], baseFret: 1 },
  'F':     { frets: [1, 3, 3, 2, 1, 1], baseFret: 1, barre: 1 },
  'G':     { frets: [3, 2, 0, 0, 0, 3], baseFret: 1 },
  'A':     { frets: [-1, 0, 2, 2, 2, 0], baseFret: 1 },
  'B':     { frets: [-1, 2, 4, 4, 4, 2], baseFret: 2, barre: 2 },
  // Minor
  'Cm':    { frets: [-1, 3, 5, 5, 4, 3], baseFret: 3, barre: 3 },
  'Dm':    { frets: [-1, -1, 0, 2, 3, 1], baseFret: 1 },
  'Em':    { frets: [0, 2, 2, 0, 0, 0], baseFret: 1 },
  'Fm':    { frets: [1, 3, 3, 1, 1, 1], baseFret: 1, barre: 1 },
  'Gm':    { frets: [-1, 1, 0, 0, 3, 3], baseFret: 3 },
  'Am':    { frets: [-1, 0, 2, 2, 1, 0], baseFret: 1 },
  'Bm':    { frets: [-1, 2, 4, 4, 3, 2], baseFret: 2, barre: 2 },
  // Dom 7
  'C7':    { frets: [-1, 3, 2, 3, 1, 0], baseFret: 1 },
  'D7':    { frets: [-1, -1, 0, 2, 1, 2], baseFret: 1 },
  'E7':    { frets: [0, 2, 0, 1, 0, 0], baseFret: 1 },
  'G7':    { frets: [3, 2, 0, 0, 0, 1], baseFret: 1 },
  'A7':    { frets: [-1, 0, 2, 0, 2, 0], baseFret: 1 },
  'B7':    { frets: [-1, 2, 1, 2, 0, 2], baseFret: 1 },
  // Maj 7
  'Cmaj7': { frets: [-1, 3, 2, 0, 0, 0], baseFret: 1 },
  'Dmaj7': { frets: [-1, -1, 0, 2, 2, 2], baseFret: 1 },
  'Emaj7': { frets: [0, 2, 1, 1, 0, 0], baseFret: 1 },
  'Fmaj7': { frets: [-1, -1, 3, 2, 1, 0], baseFret: 1 },
  'Gmaj7': { frets: [3, 2, 0, 0, 0, 2], baseFret: 1 },
  'Amaj7': { frets: [-1, 0, 2, 1, 2, 0], baseFret: 1 },
  // Min 7
  'Am7':   { frets: [-1, 0, 2, 0, 1, 0], baseFret: 1 },
  'Bm7':   { frets: [-1, 2, 4, 2, 3, 2], baseFret: 2, barre: 2 },
  'Dm7':   { frets: [-1, -1, 0, 2, 1, 1], baseFret: 1 },
  'Em7':   { frets: [0, 2, 2, 0, 3, 0], baseFret: 1 },
  'Gm7':   { frets: [-1, 1, 0, 0, 1, 1], baseFret: 3, barre: 3 },
  // Sus 4  (root, 4th, 5th)
  'Csus4': { frets: [-1, 3, 3, 0, 1, 1], baseFret: 1 },
  'Dsus4': { frets: [-1, -1, 0, 2, 3, 3], baseFret: 1 },
  'Esus4': { frets: [0, 2, 2, 2, 0, 0], baseFret: 1 },
  'Fsus4': { frets: [1, 3, 3, 3, 1, 1], baseFret: 1, barre: 1 },
  'Gsus4': { frets: [3, 3, 0, 0, 1, 3], baseFret: 1 },
  'Asus4': { frets: [-1, 0, 2, 2, 3, 0], baseFret: 1 },
  // Sus 2  (root, 2nd, 5th)
  'Csus2': { frets: [-1, 3, 0, 0, 3, 3], baseFret: 1 },
  'Dsus2': { frets: [-1, -1, 0, 2, 3, 0], baseFret: 1 },
  'Esus2': { frets: [0, 2, 4, 4, 0, 0], baseFret: 1 },
  'Fsus2': { frets: [1, 3, 5, 5, 1, 1], baseFret: 1, barre: 1 },
  'Gsus2': { frets: [3, -1, 0, 0, 3, 3], baseFret: 1 },
  'Asus2': { frets: [-1, 0, 2, 2, 0, 0], baseFret: 1 },
};

// Relative fret patterns for barre chords (position 1 = barre/root fret)
// E-shape: root on 6th string; A-shape: root on 5th string
const E_MAJOR  = [1, 3, 3, 2, 1, 1];
const E_MINOR  = [1, 3, 3, 1, 1, 1];
const E_DOM7   = [1, 3, 1, 2, 1, 1];
const E_MAJ7   = [1, 3, 2, 2, 1, 1];  // e.g. Fmaj7: F-C-E-A-C-F
const E_M7     = [1, 3, 3, 1, 4, 1];  // e.g. Fm7:   F-C-F-Ab-Eb-F
const E_SUS4   = [1, 3, 3, 3, 1, 1];  // sus4 barre (verified: F,C,F,A#,C,F)
const E_SUS2   = [1, 3, 5, 5, 1, 1];  // sus2 barre — spans 5 frets, shown in expanded diagram
const A_MAJOR  = [-1, 1, 3, 3, 3, 1];
const A_MINOR  = [-1, 1, 3, 3, 2, 1];
const A_DOM7   = [-1, 1, 3, 1, 3, 1];
const A_MAJ7   = [-1, 1, 3, 2, 3, -1]; // e.g. C#maj7: mute-C#-G#-C-F-mute
const A_M7     = [-1, 1, 3, 1, 2,  1]; // e.g. C#m7:   mute-C#-G#-B-E-G#
const A_SUS4   = [-1, 1, 3, 3, 4, 1]; // sus4 barre (verified: Bb, F, Bb, Eb, F)
const A_SUS2   = [-1, 1, 3, 3, 1, 1]; // sus2 barre (verified: Bb, F, Bb, C, F)

// Fret of root note on each string (standard tuning, fret 0 = open)
const FRET_ON_6: Record<string, number> = // low E string
  { E:0, F:1, 'F#':2, G:3, 'G#':4, A:5, 'A#':6, B:7, C:8, 'C#':9, D:10, 'D#':11 };
const FRET_ON_5: Record<string, number> = // A string
  { A:0, 'A#':1, B:2, C:3, 'C#':4, D:5, 'D#':6, E:7, F:8, 'F#':9, G:10, 'G#':11 };

function barreShape(root: string, quality: string): GuitarShape | null {
  const f6 = FRET_ON_6[root];
  const f5 = FRET_ON_5[root];

  // Pick E-shape vs A-shape: prefer the lower fret position (more practical)
  let pattern: number[] | null = null;
  let baseFret = 99;
  let useE = false;

  const EQ: Record<string, number[]> = { '': E_MAJOR, 'm': E_MINOR, '7': E_DOM7, 'maj7': E_MAJ7, 'm7': E_M7, 'sus4': E_SUS4, 'sus2': E_SUS2 };
  const AQ: Record<string, number[]> = { '': A_MAJOR, 'm': A_MINOR, '7': A_DOM7, 'maj7': A_MAJ7, 'm7': A_M7, 'sus4': A_SUS4, 'sus2': A_SUS2 };
  const eq = EQ[quality] ?? null;
  const aq = AQ[quality] ?? null;

  if (eq !== null && f6 !== undefined && f6 > 0 && f6 < baseFret) {
    pattern = eq; baseFret = f6; useE = true;
  }
  if (aq !== null && f5 !== undefined && f5 > 0 && f5 < baseFret) {
    pattern = aq; baseFret = f5; useE = false;
  }
  if (!pattern || baseFret === 99) return null;

  // Convert relative frets (1-based from barre) to absolute frets
  const frets = pattern.map(f => f === -1 ? -1 : f === 0 ? 0 : f - 1 + baseFret);
  return { frets, baseFret, barre: baseFret };
  void useE;
}

export function getGuitarShape(chordName: string): GuitarShape | null {
  if (SHAPES[chordName]) return SHAPES[chordName];
  const m = chordName.match(/^([A-G][#b]?)(.*)/);
  if (!m) return null;
  return barreShape(m[1], m[2]);
}

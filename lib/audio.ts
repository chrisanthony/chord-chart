import type { Player as SfPlayer } from 'soundfont-player';

// ── Sound type ────────────────────────────────────────────────────────────────

export type SoundType = 'acoustic-guitar' | 'electric-guitar' | 'piano' | 'synth' | 'organ';

// Maps each voice to its General MIDI soundfont instrument name (MusyngKite bank)
const SF_NAMES: Record<SoundType, string> = {
  'acoustic-guitar': 'acoustic_guitar_nylon',
  'electric-guitar': 'distortion_guitar',
  'piano':           'acoustic_grand_piano',
  'synth':           'pad_3_polysynth',
  'organ':           'church_organ',
};

// Guitars strum; everything else attacks simultaneously
const SF_STRUM: Partial<Record<SoundType, true>> = {
  'acoustic-guitar': true,
  'electric-guitar': true,
};

// ── Guitar chord voicings as MIDI note numbers (standard tuning: E2 A2 D3 G3 B3 E4) ──
const CHORD_MIDI: Record<string, number[]> = {
  'G':     [43, 47, 50, 55, 59, 67], // 320033
  'C':     [48, 52, 55, 60, 64],     // x32010
  'D':     [50, 57, 62, 66],         // xx0232
  'A':     [45, 52, 57, 61, 64],     // x02220
  'E':     [40, 47, 52, 56, 59, 64], // 022100
  'F':     [41, 48, 53, 57, 60, 65], // 133211
  'B':     [47, 54, 59, 63, 66],     // x24442
  'Em':    [40, 47, 52, 55, 59, 64], // 022000
  'Am':    [45, 52, 57, 60, 64],     // x02210
  'Dm':    [50, 57, 62, 65],         // xx0231
  'Bm':    [47, 54, 59, 62, 66],     // x24432
  'F#m':   [42, 49, 54, 57, 61, 66], // 244222
  'G7':    [43, 47, 50, 55, 59, 65], // 320001
  'C7':    [48, 52, 58, 60, 64],     // x32310
  'D7':    [50, 57, 60, 66],         // xx0212
  'A7':    [45, 52, 55, 61, 64],     // x02020
  'E7':    [40, 47, 50, 56, 59, 64], // 020100
  'B7':    [47, 51, 57, 59, 66],     // x21202
  'Cadd9': [48, 52, 55, 62, 64],     // x32030
  'Dsus2': [50, 57, 62, 64],         // xx0230
  'Asus2': [45, 52, 57, 59, 64],     // x02200
  'Gsus4': [43, 50, 55, 60, 67],     // 3x0013
};

// ── Voicing generator (fallback for chords not pre-defined above) ─────────────

const ROOT_MIDI: Record<string, number> = {
  'C': 48, 'C#': 49, 'Db': 49,
  'D': 50, 'D#': 51, 'Eb': 51,
  'E': 40, 'F': 41,
  'F#': 42, 'Gb': 42,
  'G': 43, 'G#': 44, 'Ab': 44,
  'A': 45, 'A#': 46, 'Bb': 46,
  'B': 47,
};

const QUALITY_INTERVALS: Record<string, number[]> = {
  '':     [0, 4, 7],
  'm':    [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7':   [0, 3, 7, 10],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim':  [0, 3, 6],
  'aug':  [0, 4, 8],
  'add9': [0, 4, 7, 14],
};

function generateVoicing(name: string): number[] | null {
  const match = name.match(/^([A-G][#b]?)(.*)/);
  if (!match) return null;
  const [, rootName, quality] = match;
  const root = ROOT_MIDI[rootName];
  const intervals = QUALITY_INTERVALS[quality];
  if (root === undefined || intervals === undefined) return null;

  const notes: number[] = [root];
  let cursor = root;

  for (const iv of intervals.slice(1)) {
    const n = root + iv;
    if (n > cursor) { notes.push(n); cursor = n; }
  }

  const octRoot = root + 12;
  if (notes.length < 5 && octRoot > cursor + 1) {
    notes.push(octRoot); cursor = octRoot;
    for (const iv of intervals.slice(1)) {
      if (notes.length >= 5) break;
      const n = root + 12 + iv;
      if (n > cursor) { notes.push(n); cursor = n; }
    }
  }

  return notes;
}

// ── MIDI → note name (soundfont-player format: "C4", "A#3", etc.) ────────────

const NOTE_NAMES_SF = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note   = NOTE_NAMES_SF[midi % 12];
  return `${note}${octave}`;
}

// ── Audio context + master compressor (used by metronome click) ───────────────

let ac: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;

function getAC(): AudioContext {
  if (!ac) {
    ac = new AudioContext();
    compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.3;
    compressor.connect(ac.destination);
    // Kick off preload of the default instrument
    loadInstrument(ac, SF_NAMES['acoustic-guitar']).catch(() => {});
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

// ── Soundfont instrument cache ────────────────────────────────────────────────

const sfCache   = new Map<string, SfPlayer>();
const sfLoading = new Map<string, Promise<SfPlayer>>();
let currentSfPlayer: SfPlayer | null = null;

function loadInstrument(ctx: AudioContext, name: string): Promise<SfPlayer> {
  if (sfCache.has(name)) return Promise.resolve(sfCache.get(name)!);
  if (!sfLoading.has(name)) {
    const p = import('soundfont-player').then(sf =>
      sf.instrument(ctx, name as Parameters<typeof sf.instrument>[1], {
        soundfont: 'MusyngKite',
        format: 'mp3',
      })
    ).then(player => { sfCache.set(name, player); return player; });
    sfLoading.set(name, p);
  }
  return sfLoading.get(name)!;
}

async function playSampleChord(
  name: string,
  sfName: string,
  durationSecs: number,
  strum: boolean,
): Promise<void> {
  const ctx = getAC();

  // Stop any currently playing soundfont notes
  if (currentSfPlayer) currentSfPlayer.stop();

  const player = await loadInstrument(ctx, sfName);
  // Re-resume in case iOS Safari suspended the context during the async load
  if (ctx.state === 'suspended') ctx.resume();
  currentSfPlayer = player;

  const notes     = CHORD_MIDI[name] ?? generateVoicing(name) ?? [];
  const strumStep = strum ? 0.035 : 0;
  const playAt    = ctx.currentTime; // re-read after async load

  notes.forEach((midi, i) => {
    player.play(midiToNoteName(midi), playAt + i * strumStep, {
      duration: durationSecs,
      gain: 0.8,
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Short oscillator click for the metronome.
 *  isAccent = true → downbeat (higher pitch + louder). */
export function playClick(isAccent: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx  = getAC();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(compressor!);
    osc.type = 'triangle';
    osc.frequency.value = isAccent ? 1050 : 680;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(isAccent ? 0.55 : 0.30, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.start(t); osc.stop(t + 0.08);
  } catch { /* ignore if Web Audio unavailable */ }
}

/** Play a chord using the given sound voice.
 *  Loads the soundfont sample on first use (cached for subsequent calls). */
export function playChordWithSound(name: string, sound: SoundType, durationSecs = 3): void {
  if (typeof window === 'undefined') return;
  playSampleChord(name, SF_NAMES[sound], durationSecs, !!SF_STRUM[sound]).catch(() => {});
}

/** Backward-compat wrapper — plays as acoustic guitar. */
export function playChord(name: string, durationSecs = 3): void {
  playChordWithSound(name, 'acoustic-guitar', durationSecs);
}

/** Backward-compat wrapper — plays as organ. */
export function playChordSynth(name: string, durationSecs = 3): void {
  playChordWithSound(name, 'organ', durationSecs);
}

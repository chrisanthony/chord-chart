// Client-side audio analysis: key + BPM + chord detection (no external dependencies)
// Uses the Goertzel algorithm for chromagram + Krumhansl-Schmuckler key profiles.

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface DecodedAudio {
  mono:       Float32Array;
  sampleRate: number;
  duration:   number;
  waveform:   number[];   // 200 normalised RMS values for waveform display
  metaBpm?:   number;     // BPM extracted from file metadata, if present
}

export interface AudioAnalysisResult {
  key:         string;    // e.g. "G major" | "A minor"
  bpm:         number;    // integer, clamped 40–220
  confidence?: number;    // 0–1 K-S correlation score
  chords?:     string[];  // browser-only chord progression estimate
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Krumhansl-Schmuckler tonal profiles (C-rooted)
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

// Chord templates: semitone offsets from root for major (0,4,7) and minor (0,3,7) triads
const MAJOR_OFFSETS = [0, 4, 7];
const MINOR_OFFSETS = [0, 3, 7];

// ── Core DSP ──────────────────────────────────────────────────────────────────

/** Goertzel algorithm: compute DFT power at one specific frequency. O(N). */
function goertzel(samples: Float32Array, freq: number, sampleRate: number): number {
  const N     = samples.length;
  const k     = N * freq / sampleRate;
  const w     = 2 * Math.PI * k / N;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let n = 0; n < N; n++) {
    s0 = samples[n] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s2 * s2 + s1 * s1 - coeff * s1 * s2;
}

/** Apply a Hann window in-place. */
function hannWindow(seg: Float32Array): void {
  const N = seg.length;
  for (let i = 0; i < N; i++)
    seg[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
}

/**
 * 12-bin chromagram via multi-octave Goertzel.
 *
 * Frequency range narrowed to 60–1200 Hz (C2–C6) to exclude the upper
 * register where guitar solos and vocals live. OCT_WEIGHTS rebalanced to
 * emphasise the bass octave (C2–C3) where chord roots are most reliable,
 * and eliminate oct +3 (C7, 2094 Hz) entirely.
 */
const OCT_WEIGHTS  = [0.5, 1.0, 1.0, 0.6, 0.1, 0.0]; // oct −2 … +3
const CHROMA_F_MIN = 60;   // Hz — one semitone below C2
const CHROMA_F_MAX = 1200; // Hz — C6 ceiling; excludes lead guitar / vocal upper register
const C4_HZ        = 440 * Math.pow(2, -9 / 12); // ≈ 261.63 Hz (hoisted from chromagram)

// Frequency bounds for the bass-only chromagram (chord root detection)
const BASS_F_MIN = 60;
const BASS_F_MAX = 280; // Hz — C4 + margin; covers C2–D4 bass range

function chromagram(seg: Float32Array, sr: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  for (let p = 0; p < 12; p++) {
    let energy = 0;
    for (let oct = -2; oct <= 3; oct++) {
      const w = OCT_WEIGHTS[oct + 2];
      if (w === 0) continue; // skip oct +3 — no Goertzel call
      const f = C4_HZ * Math.pow(2, p / 12 + oct);
      if (f < CHROMA_F_MIN || f > CHROMA_F_MAX) continue;
      energy += goertzel(seg, f, sr) * w;
    }
    chroma[p] = energy; // raw weighted sum; L1-normalised in matchChord
  }
  return chroma;
}

/**
 * Compute a chromagram using only the bass register (60–280 Hz).
 * The bass guitar reliably plays the chord root in C2–C4 range; this
 * low-frequency snapshot is used to identify the 2 most plausible roots
 * before full-spectrum chord matching.
 */
function chromagramBass(seg: Float32Array, sr: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  for (let p = 0; p < 12; p++) {
    for (let oct = -2; oct <= -1; oct++) {
      const f = C4_HZ * Math.pow(2, p / 12 + oct);
      if (f < BASS_F_MIN || f > BASS_F_MAX) continue;
      chroma[p] += goertzel(seg, f, sr);
    }
  }
  return chroma;
}

/**
 * From a bass chromagram, return the top-N most energetic pitch classes
 * that correspond to a chord root in the diatonic set.
 */
function detectBassRoots(
  bassChroma: number[],
  allowed:    Set<string>,
  topN = 2,
): Set<number> {
  const candidates: { pc: number; energy: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    if (allowed.has(NOTE_NAMES[pc]) || allowed.has(`${NOTE_NAMES[pc]}m`))
      candidates.push({ pc, energy: bassChroma[pc] });
  }
  candidates.sort((a, b) => b.energy - a.energy);
  const roots = new Set<number>();
  for (let i = 0; i < Math.min(topN, candidates.length); i++) roots.add(candidates[i].pc);
  return roots;
}

/**
 * Compute a chromagram by splitting `seg` into `nSub` equal sub-windows,
 * computing a chromagram per sub-window, then taking the per-pitch-class
 * median.
 *
 * Why median: a melody note held for part of the window appears in fewer
 * than half the sub-windows and is suppressed by the median. A chord tone
 * present throughout survives. Total Goertzel work equals one full-window
 * chromagram (nSub × shorter windows = same total samples).
 */
function chromagramMedian(seg: Float32Array, sr: number, nSub = 6): number[] {
  const subLen  = Math.floor(seg.length / nSub);
  const chromas: number[][] = [];
  for (let s = 0; s < nSub; s++) {
    const sub = seg.slice(s * subLen, (s + 1) * subLen);
    hannWindow(sub); // Hann per sub-window — do not pre-window the outer segment
    chromas.push(chromagram(sub, sr));
  }
  const result = new Array<number>(12).fill(0);
  const vals   = new Array<number>(nSub);
  for (let p = 0; p < 12; p++) {
    for (let s = 0; s < nSub; s++) vals[s] = chromas[s][p];
    vals.sort((a, b) => a - b);
    // Even nSub: average the two middle values
    result[p] = nSub % 2 === 1
      ? vals[Math.floor(nSub / 2)]
      : (vals[nSub / 2 - 1] + vals[nSub / 2]) / 2;
  }
  return result;
}

/** Pearson correlation between two arrays. */
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let sA = 0, sB = 0;
  for (let i = 0; i < n; i++) { sA += a[i]; sB += b[i]; }
  const mA = sA / n, mB = sB / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - mA) * (b[i] - mB);
    dA  += (a[i] - mA) ** 2;
    dB  += (b[i] - mB) ** 2;
  }
  return dA && dB ? num / Math.sqrt(dA * dB) : 0;
}

/** Best-matching key using K-S profiles. */
function findKey(chroma: number[]): { root: number; mode: 'major' | 'minor'; score: number } {
  let bestRoot = 0, bestMode: 'major' | 'minor' = 'major', bestScore = -Infinity;
  for (let r = 0; r < 12; r++) {
    const rot = Array.from({ length: 12 }, (_, i) => chroma[(i + r) % 12]);
    const maj = pearson(rot, MAJOR_PROFILE);
    const min = pearson(rot, MINOR_PROFILE);
    if (maj > bestScore) { bestScore = maj; bestRoot = r; bestMode = 'major'; }
    if (min > bestScore) { bestScore = min; bestRoot = r; bestMode = 'minor'; }
  }
  return { root: bestRoot, mode: bestMode, score: bestScore };
}

/**
 * Band-limited onset flux at 100 FPS.
 *
 * Rather than raw RMS energy (which responds equally to kick drums, guitar
 * strums, and vocal phrases), we separate the signal into three frequency
 * bands before computing onset strength:
 *
 *   low  (≤ 250 Hz) — kick drum / bass: most reliable beat indicator
 *   mid  (250–2 kHz) — snare / guitar body
 *   high (2–8 kHz)   — hihat / attack transients
 *
 * Each band is approximated with a simple biquad filter. Low-band flux gets
 * extra weight because the kick drum is the most consistent rhythmic cue.
 */
function computeFlux(samples: Float32Array, sr: number): Float32Array {
  const FPS = 100;
  const hop = Math.floor(sr / FPS);
  const nF  = Math.floor(samples.length / hop);
  const N   = nF * hop;

  // ── Simple 1-pole IIR low-pass and high-pass filters ─────────────────────
  // These are lightweight single-pole approximations — accurate enough for
  // band separation, no need for expensive multi-pole designs.
  function lowPass(x: Float32Array, fc: number): Float32Array {
    const dt = 1 / sr;
    const RC = 1 / (2 * Math.PI * fc);
    const a  = dt / (RC + dt);
    const y  = new Float32Array(x.length);
    y[0] = x[0] * a;
    for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + a * (x[i] - y[i - 1]);
    return y;
  }
  function highPass(x: Float32Array, fc: number): Float32Array {
    const dt = 1 / sr;
    const RC = 1 / (2 * Math.PI * fc);
    const a  = RC / (RC + dt);
    const y  = new Float32Array(x.length);
    y[0] = x[0];
    for (let i = 1; i < x.length; i++) y[i] = a * (y[i - 1] + x[i] - x[i - 1]);
    return y;
  }

  // Trim to integer number of frames for efficiency
  const trimmed = samples.subarray(0, N);

  const lo   = lowPass(trimmed, 250);         // ≤ 250 Hz
  const mid  = highPass(lowPass(trimmed, 2000), 250);  // 250–2000 Hz
  const hi   = highPass(trimmed, 2000);       // ≥ 2 kHz

  // Compute per-frame RMS energy for each band
  function frameEnergy(band: Float32Array): Float32Array {
    const E = new Float32Array(nF);
    for (let i = 0; i < nF; i++) {
      let s = 0;
      const base = i * hop;
      for (let j = 0; j < hop; j++) s += band[base + j] ** 2;
      E[i] = Math.sqrt(s / hop);
    }
    return E;
  }

  const Elo  = frameEnergy(lo);
  const Emid = frameEnergy(mid);
  const Ehi  = frameEnergy(hi);

  // Half-wave rectified flux (only rising energy = onsets)
  // Weighted: low band × 3, mid × 1.5, high × 1
  const flux = new Float32Array(nF);
  for (let i = 1; i < nF; i++) {
    flux[i] =
      3.0 * Math.max(0, Elo[i]  - Elo[i - 1]) +
      1.5 * Math.max(0, Emid[i] - Emid[i - 1]) +
      1.0 * Math.max(0, Ehi[i]  - Ehi[i - 1]);
  }
  return flux;
}

/**
 * BPM estimation via band-weighted onset-flux autocorrelation.
 *
 * Used as a fallback; user BPM hint, file metadata, and Gemini BPM take
 * priority. Chord detection is fixed-window and independent of this value.
 *
 * Improvements over naive argmax:
 *   1. Normalised autocorrelation (divide by N−lag) — removes the bias that
 *      makes short lags (fast tempos) accumulate more energy.
 *   2. Tempo prior — bell curve centred at 120 BPM (σ ≈ 35 BPM) that gently
 *      penalises implausible tempos without hard-cutting them.
 *   3. Harmonic doubling check — if 2× the candidate falls within range and
 *      has a competitive score, prefer the faster tempo (autocorrelation
 *      classically prefers half-tempo sub-harmonics).
 */
function estimateBPM(samples: Float32Array, sr: number): number {
  const FPS    = 100;
  const flux   = computeFlux(samples, sr);
  const nF     = flux.length;
  const lagMin = Math.ceil(FPS * 60 / 200);   // = 30 frames → 200 BPM
  const lagMax = Math.floor(FPS * 60 / 40);   // = 150 frames → 40 BPM

  // ── Normalised autocorrelation ────────────────────────────────────────────
  const scores = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    const pairs = nF - lag;
    for (let i = 0; i < pairs; i++) s += flux[i] * flux[i + lag];
    scores[lag] = pairs > 0 ? s / pairs : 0;
  }

  // ── Tempo prior: bell curve centred at 120 BPM, σ = 35 BPM ──────────────
  // Converts a lag to BPM and returns a weight in (0, 1].
  function tempoPrior(lag: number): number {
    const bpm    = (FPS * 60) / lag;
    const centre = 120;
    const sigma  = 35;
    return Math.exp(-((bpm - centre) ** 2) / (2 * sigma ** 2));
  }

  // Apply prior, find best lag
  let bestLag = lagMin, bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const weighted = scores[lag] * tempoPrior(lag);
    if (weighted > bestScore) { bestScore = weighted; bestLag = lag; }
  }

  // ── Harmonic doubling check ───────────────────────────────────────────────
  // Autocorrelation often locks onto half-tempo (2× the period). If the
  // double-tempo candidate exists in range and its weighted score is ≥ 70 %
  // of the current winner, prefer it (it is the true beat, the current winner
  // is its half-tempo ghost).
  const doubleLag = Math.round(bestLag / 2);
  if (doubleLag >= lagMin) {
    const doubleScore = scores[doubleLag] * tempoPrior(doubleLag);
    if (doubleScore >= bestScore * 0.70) bestLag = doubleLag;
  }

  return Math.round((FPS * 60) / bestLag);
}

// ── Chord detection ───────────────────────────────────────────────────────────

/** Match a chromagram against 24 triad templates, return best chord + confidence. */
/**
 * Match a chromagram against triad templates.
 *
 * `allowed`   — diatonic chord set; when provided only those candidates are scored.
 * `bassRoots` — pitch classes identified as most likely from the bass register.
 *               Chords whose root is in this set receive a +0.15 soft bonus,
 *               biasing toward the bass-confirmed root without hard-excluding others
 *               (handles songs with walking bass lines or no bass guitar).
 */
function matchChord(
  chroma:     number[],
  allowed?:   Set<string>,
  bassRoots?: Set<number>,
): { chord: string; confidence: number } {
  const BASS_BOOST = 0.15;

  // L1 normalise
  const sum = chroma.reduce((a, b) => a + b, 0);
  let norm  = sum > 0 ? chroma.map(v => v / sum) : [...chroma];

  // Zero out pitch classes below 12 % of the peak bin.
  // Lowered from 15 % so weak-but-real chord fifths survive suppression.
  const peak = Math.max(...norm);
  norm = norm.map(v => v > peak * 0.12 ? v : 0);

  let bestChord = NOTE_NAMES[0], bestScore = -Infinity;
  for (let r = 0; r < 12; r++) {
    const bassBonus = bassRoots?.has(r) ? BASS_BOOST : 0;
    if (!allowed || allowed.has(NOTE_NAMES[r])) {
      const s = MAJOR_OFFSETS.reduce((a, o) => a + norm[(r + o) % 12], 0) + bassBonus;
      if (s > bestScore) { bestScore = s; bestChord = NOTE_NAMES[r]; }
    }
    if (!allowed || allowed.has(`${NOTE_NAMES[r]}m`)) {
      const s = MINOR_OFFSETS.reduce((a, o) => a + norm[(r + o) % 12], 0) + bassBonus;
      if (s > bestScore) { bestScore = s; bestChord = `${NOTE_NAMES[r]}m`; }
    }
  }
  return { chord: bestChord, confidence: bestScore };
}

/**
 * Build the set of diatonic triads for a key.
 *
 * Major key  → I  ii  iii  IV  V  vi  (skip vii° — no dim template)
 * Minor key  → i  III  iv  v  V  VI  VII
 *   (both v and V included to capture harmonic minor's dominant)
 *
 * All 12 roots use NOTE_NAMES sharps, so Eb → D#, Bb → A#, etc.
 */
function buildDiatonicSet(root: number, mode: 'major' | 'minor'): Set<string> {
  // Semitone offsets of each scale degree from the root
  const MAJOR_STEPS   = [0, 2, 4, 5, 7, 9];       // I ii iii IV V vi
  const MAJOR_QUALS   = ['', 'm', 'm', '', '', 'm'] as const;
  const MINOR_STEPS   = [0, 3, 5, 7, 7, 8, 10];   // i III iv v V(harm) VI VII
  const MINOR_QUALS   = ['m', '', 'm', 'm', '', '', ''] as const;

  const steps  = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const quals  = mode === 'major' ? MAJOR_QUALS : MINOR_QUALS;
  const chords = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    chords.add(`${NOTE_NAMES[(root + steps[i]) % 12]}${quals[i]}`);
  }
  return chords;
}

/**
 * Mode-filter chord labels over a sliding ±halfWin window.
 * Each position is replaced by the most common chord in its neighbourhood,
 * so a single-beat melody outlier is outvoted by the surrounding correct beats.
 */
function smoothChordLabels(labels: string[], halfWin: number): string[] {
  return labels.map((_, i) => {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(labels.length, i + halfWin + 1);
    const counts = new Map<string, number>();
    let maxCount = 0, winner = labels[i];
    for (let j = lo; j < hi; j++) {
      const c = labels[j];
      const n = (counts.get(c) ?? 0) + 1;
      counts.set(c, n);
      if (n > maxCount) { maxCount = n; winner = c; }
    }
    return winner;
  });
}

/** Extract the shortest repeating chord pattern from a sequence of labels. */
function extractProgression(labels: string[]): string[] {
  if (labels.length === 0) return [];

  // Merge consecutive identical chords
  const deduped: string[] = [];
  for (const c of labels) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== c) deduped.push(c);
  }
  if (deduped.length <= 4) return deduped;

  // Find shortest repeating unit
  for (let len = 2; len <= Math.min(8, Math.floor(deduped.length / 2)); len++) {
    const pattern = deduped.slice(0, len);
    let matches   = 0;
    for (let i = 0; i + len <= deduped.length; i += len) {
      if (pattern.every((c, j) => deduped[i + j] === c)) matches++;
      else break;
    }
    if (matches >= 2) return pattern;
  }

  return deduped.slice(0, 8);
}

/**
 * Read BPM from audio file metadata without decoding the audio.
 * Supports ID3v2 TBPM frames (MP3) and iTunes tmpo atoms (M4A/AAC).
 * Returns the BPM integer if found and in the valid 40–220 range, else null.
 */
export function readBpmFromMetadata(buf: ArrayBuffer): number | null {
  const b = new Uint8Array(buf);

  // ── ID3v2 (MP3) ───────────────────────────────────────────────────────────
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // "ID3"
    const ver   = b[3]; // 2, 3, or 4
    const flags = b[5];
    const size  = ((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f);
    let   pos   = 10;
    if ((flags & 0x40) && ver >= 3) // skip extended header
      pos += 4 + ((b[10]<<24)|(b[11]<<16)|(b[12]<<8)|b[13]);
    const end = Math.min(10 + size, b.length);
    while (pos + 10 < end) {
      const id  = String.fromCharCode(b[pos],b[pos+1],b[pos+2],b[pos+3]);
      const fSz = ver === 4
        ? ((b[pos+4]&0x7f)<<21)|((b[pos+5]&0x7f)<<14)|((b[pos+6]&0x7f)<<7)|(b[pos+7]&0x7f)
        : (b[pos+4]<<24)|(b[pos+5]<<16)|(b[pos+6]<<8)|b[pos+7];
      if (fSz <= 0 || id === '\0\0\0\0') break;
      if (id === 'TBPM' && fSz > 1) {
        // byte at pos+10 is encoding; pos+11 onward is the BPM as ASCII text
        let txt = '';
        for (let i = pos + 11; i < pos + 10 + fSz && b[i]; i++)
          txt += String.fromCharCode(b[i]);
        const bpm = parseInt(txt, 10);
        if (bpm >= 40 && bpm <= 220) return bpm;
      }
      pos += 10 + fSz;
    }
  }

  // ── M4A / iTunes tmpo atom ────────────────────────────────────────────────
  // Scan the first 64 KB for "tmpo"; the 2-byte BPM follows at offset +8.
  const scan = Math.min(b.length, 65536);
  for (let i = 0; i < scan - 10; i++) {
    if (b[i]===0x74&&b[i+1]===0x6d&&b[i+2]===0x70&&b[i+3]===0x6f) { // "tmpo"
      const bpm = (b[i+8] << 8) | b[i+9];
      if (bpm >= 40 && bpm <= 220) return bpm;
    }
  }

  return null;
}

/** Compute a normalised 200-point RMS waveform for display. */
function computeWaveform(mono: Float32Array, numPoints = 200): number[] {
  const blockSize = Math.max(1, Math.floor(mono.length / numPoints));
  const waveform: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    const start = i * blockSize;
    const end   = Math.min(start + blockSize, mono.length);
    let rms = 0;
    for (let j = start; j < end; j++) rms += mono[j] ** 2;
    waveform.push(Math.sqrt(rms / (end - start)));
  }
  const peak = Math.max(...waveform, 1e-6);
  return waveform.map(v => v / peak);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Decode raw audio bytes into PCM + waveform. Call once per file; cache the
 * result so range re-analysis is fast (no re-decoding).
 */
export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
  // Read BPM from metadata before handing the buffer to the decoder
  // (decodeAudioData may mutate/consume the buffer on some platforms).
  const metaBpm = readBpmFromMetadata(arrayBuffer);

  const ctx = new AudioContext();
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await ctx.close();
  }

  const L    = buf.getChannelData(0);
  const R    = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = R ? (L[i] + R[i]) / 2 : L[i];

  return {
    mono,
    sampleRate: buf.sampleRate,
    duration:   buf.duration,
    waveform:   computeWaveform(mono),
    metaBpm:    metaBpm ?? undefined,
  };
}

/**
 * Analyse a decoded audio buffer, optionally restricted to [startSec, endSec].
 * Returns key, BPM, and a browser-estimated chord progression.
 */
export async function analyzeDecoded(
  audio:       DecodedAudio,
  opts?:       { startSec?: number; endSec?: number; bpmOverride?: number },
  onProgress?: (pct: number) => void,
): Promise<AudioAnalysisResult> {
  const { mono, sampleRate } = audio;
  const startSample = Math.floor((opts?.startSec ?? 0) * sampleRate);
  const endSample   = Math.min(
    Math.floor((opts?.endSec ?? audio.duration) * sampleRate),
    mono.length,
  );
  const slice    = mono.slice(startSample, endSample);
  const sliceDur = slice.length / sampleRate;

  onProgress?.(5);

  // ── Key detection — uses full audio, not just the selected range ──────────
  // Sampling from the full file gives a more reliable key even when the user
  // has trimmed to a short section (e.g. just the verse).
  const segLen    = Math.floor(sampleRate * 1.0);
  const fullDur   = mono.length / sampleRate;
  const N_SEGS    = Math.min(8, Math.max(1, Math.floor(fullDur)));
  const avgChroma = new Array<number>(12).fill(0);

  for (let s = 0; s < N_SEGS; s++) {
    const frac  = N_SEGS > 1 ? 0.1 + (s / (N_SEGS - 1)) * 0.8 : 0.5;
    const start = Math.floor(frac * mono.length);
    const end   = Math.min(start + segLen, mono.length);
    if (end - start < 1024) continue;

    const seg = mono.slice(start, end);
    hannWindow(seg);

    const ch = chromagram(seg, sampleRate);
    for (let p = 0; p < 12; p++) avgChroma[p] += ch[p];

    onProgress?.(5 + Math.round(((s + 1) / N_SEGS) * 45));
  }

  const peak = Math.max(...avgChroma);
  const norm = peak > 0 ? avgChroma.map(v => v / peak) : avgChroma;
  const { root, mode, score } = findKey(norm);
  onProgress?.(52);

  // Build the set of diatonic chords for this key.
  // Chord detection is constrained to this set, eliminating non-diatonic
  // false positives caused by vocal melody / overtone bleed.
  const diatonic = buildDiatonicSet(root, mode);

  // ── BPM detection ─────────────────────────────────────────────────────────
  // Priority: (1) user hint / caller override, (2) file metadata tag,
  // (3) HPS autocorrelation fallback.
  // Gemini's BPM (applied in app/page.tsx after the AI response) further
  // overrides the displayed result but does not affect chord window alignment.
  const bpm = opts?.bpmOverride
    ?? audio.metaBpm
    ?? Math.max(40, Math.min(220, estimateBPM(
        slice.slice(0, Math.min(slice.length, Math.floor(sampleRate * 30))),
        sampleRate,
      )));
  onProgress?.(68);

  // ── BPM-adaptive chord detection windows ──────────────────────────────────
  // Window = 1 musical bar at the detected tempo, clamped to [1.5 s, 4.0 s].
  // Slow songs (60–80 BPM) get longer windows that capture full chord cycles;
  // fast songs stay near the proven 1.5 s baseline.
  // Not strictly beat-synchronous — proportional to bar length, which is
  // robust to ~20% BPM errors unlike grid-aligned approaches.
  const secPerBar = (60 / bpm) * 4;
  const WIN_SECS  = Math.min(4.0, Math.max(1.5, secPerBar));
  const STEP_SECS = WIN_SECS / 3;                               // 3 steps per bar
  const WIN_LEN   = Math.floor(sampleRate * WIN_SECS);
  const STEP_LEN  = Math.floor(sampleRate * STEP_SECS);
  const NUM_SUBS  = Math.max(6, Math.round(WIN_SECS / 0.25));  // ~250 ms sub-windows
  const labels: string[] = [];

  for (let t = 0; t + WIN_LEN <= slice.length; t += STEP_LEN) {
    const seg = slice.slice(t, t + WIN_LEN);

    // Bass root: compute on the full window (long window = better low-frequency resolution)
    const bassHanned = seg.slice(0);
    hannWindow(bassHanned);
    const bassRoots = detectBassRoots(chromagramBass(bassHanned, sampleRate), diatonic);

    // Full-spectrum: median of NUM_SUBS × ~250 ms sub-windows (hannWindow applied inside)
    const { chord, confidence } = matchChord(
      chromagramMedian(seg, sampleRate, NUM_SUBS),
      diatonic,
      bassRoots,
    );
    if (confidence > 0.20) labels.push(chord);
  }

  // Mode-filter: replace each label with the most common chord in a ±2-step
  // neighbourhood (±1 s) so short melody spikes are outvoted.
  const smoothed = smoothChordLabels(labels, 2);
  const chords   = smoothed.length >= 2 ? extractProgression(smoothed) : undefined;
  onProgress?.(100);

  return {
    key:        `${NOTE_NAMES[root]} ${mode}`,
    bpm,
    confidence: Math.max(0, score),
    chords,
  };
}

/**
 * Encode a mono PCM slice as a 16-bit WAV at 16 kHz (down-sampled).
 * Downsampling keeps files well under Gemini's 20 MB inline-data limit
 * even for long selections; chord content is preserved at 16 kHz.
 */
export function encodePcmToWav(mono: Float32Array, sampleRate: number): Uint8Array {
  const TARGET_SR  = 16_000;
  const ratio      = sampleRate / TARGET_SR;
  const outLen     = Math.floor(mono.length / ratio);
  const pcm16      = new Int16Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const src   = mono[Math.floor(i * ratio)];
    pcm16[i]    = Math.max(-32768, Math.min(32767, Math.round(src * 32767)));
  }

  const byteCount = outLen * 2;
  const buf       = new ArrayBuffer(44 + byteCount);
  const view      = new DataView(buf);
  const str       = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  str(0,  'RIFF');  view.setUint32( 4, 36 + byteCount,   true);
  str(8,  'WAVE');  str(12, 'fmt ');
  view.setUint32(16, 16,            true);  // chunk size
  view.setUint16(20,  1,            true);  // PCM
  view.setUint16(22,  1,            true);  // mono
  view.setUint32(24, TARGET_SR,     true);
  view.setUint32(28, TARGET_SR * 2, true);  // byte rate
  view.setUint16(32,  2,            true);  // block align
  view.setUint16(34, 16,            true);  // bits per sample
  str(36, 'data');  view.setUint32(40, byteCount, true);

  new Int16Array(buf, 44).set(pcm16);
  return new Uint8Array(buf);
}

/**
 * Convenience wrapper — decode + analyse in one call.
 * Kept for backward compatibility (used by the YouTube flow).
 */
export async function analyzeAudio(
  arrayBuffer: ArrayBuffer,
  onProgress?: (pct: number) => void,
): Promise<AudioAnalysisResult> {
  onProgress?.(5);
  const decoded = await decodeAudioBuffer(arrayBuffer);
  onProgress?.(20);
  return analyzeDecoded(decoded, {}, pct => onProgress?.(20 + Math.round(pct * 0.8)));
}

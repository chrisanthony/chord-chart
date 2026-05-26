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

// ── MIDI helpers ──────────────────────────────────────────────────────────────

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES_SF = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToNoteName(midi: number): string {
  return `${NOTE_NAMES_SF[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// ── Audio context + master compressor ────────────────────────────────────────

let ac: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;

function getAC(): AudioContext {
  if (!ac) {
    ac = new AudioContext();

    // iOS 16.4+: Route Web Audio to the media channel (controlled by side-button
    // volume during playback, never silenced by the mute switch). Without this,
    // Web Audio uses the ambient/ringer channel which can be silenced by various
    // system conditions even when ringer volume is at maximum.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch { /* not supported — silent-audio fallback handles older iOS */ }

    compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.3;
    compressor.connect(ac.destination);
  }
  // Resume if suspended (e.g. after page backgrounding). Fine to call outside
  // a gesture here because the definitive unlock happens inside playChordWithSound.
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

// ── Web Audio synthesis (instant, no CDN) ────────────────────────────────────
// Used immediately on every tap; samples upgrade this once loaded.

/** Karplus-Strong pluck — acoustic guitar */
function pluck(ctx: AudioContext, dest: AudioNode, hz: number, when: number, dur: number) {
  const sr = ctx.sampleRate, period = Math.round(sr / hz), len = Math.ceil(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < period; i++) d[i] = Math.random() * 2 - 1;
  for (let i = 1; i < period; i++) d[i] = d[i] * 0.5 + d[i - 1] * 0.5;
  for (let i = period; i < len; i++) d[i] = 0.994 * (d[i - period] + d[i - period + 1]) / 2;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(1, when + 0.004);
  src.connect(env); env.connect(dest);
  src.start(when); src.stop(when + dur);
}

/** Brighter KS + mild overdrive — electric guitar */
function pluckElectric(ctx: AudioContext, dest: AudioNode, hz: number, when: number, dur: number) {
  const sr = ctx.sampleRate, period = Math.round(sr / hz), len = Math.ceil(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < period; i++) d[i] = Math.random() * 2 - 1;
  for (let i = 1; i < period; i++) d[i] = d[i] * 0.7 + d[i - 1] * 0.3;
  for (let i = period; i < len; i++) d[i] = 0.996 * (d[i - period] + d[i - period + 1]) / 2;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 8000;
  const ws = ctx.createWaveShaper();
  const k = 15, n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)); }
  ws.curve = curve; ws.oversample = '2x';
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when); env.gain.linearRampToValueAtTime(1, when + 0.003);
  src.connect(lpf); lpf.connect(ws); ws.connect(env); env.connect(dest);
  src.start(when); src.stop(when + dur);
}

/** Additive harmonics + hammer click — piano */
function pluckPiano(ctx: AudioContext, dest: AudioNode, hz: number, when: number, dur: number) {
  const harmonics = [1, 2, 3, 4, 5, 6];
  const amps      = [0.60, 0.22, 0.10, 0.05, 0.025, 0.01];
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, when);
  master.gain.linearRampToValueAtTime(1, when + 0.005);
  master.gain.exponentialRampToValueAtTime(0.001, when + dur);
  master.connect(dest);
  harmonics.forEach((h, i) => {
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = hz * h;
    const g = ctx.createGain(); g.gain.value = amps[i];
    osc.connect(g); g.connect(master);
    osc.start(when); osc.stop(when + dur + 0.05);
  });
  const nLen = Math.ceil(ctx.sampleRate * 0.015);
  const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nd = nBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
  const nGain = ctx.createGain(); nGain.gain.value = 0.04;
  nSrc.connect(nGain); nGain.connect(dest);
  nSrc.start(when);
}

/** Dual detuned sawtooth through LPF — synth pad */
function pluckSynth(ctx: AudioContext, dest: AudioNode, hz: number, when: number, dur: number) {
  const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = hz;
  const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = hz * 1.006;
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 900; lpf.Q.value = 2;
  const gain = ctx.createGain();
  const ATTACK = 0.15, RELEASE = 0.6;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.08, when + ATTACK);
  gain.gain.setValueAtTime(0.08, when + Math.max(ATTACK, dur - RELEASE));
  gain.gain.linearRampToValueAtTime(0, when + dur);
  osc1.connect(lpf); osc2.connect(lpf); lpf.connect(gain); gain.connect(dest);
  osc1.start(when); osc2.start(when);
  osc1.stop(when + dur + 0.05); osc2.stop(when + dur + 0.05);
}

/** Hammond-style drawbar sines — organ */
function pluckOrgan(ctx: AudioContext, dest: AudioNode, hz: number, when: number, dur: number) {
  const drawbars = [1, 2, 3, 4, 0.5];
  const levels   = [0.50, 0.30, 0.15, 0.08, 0.10];
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.12, when + 0.005);
  gain.gain.setValueAtTime(0.12, when + Math.max(0.005, dur - 0.04));
  gain.gain.linearRampToValueAtTime(0, when + dur);
  gain.connect(dest);
  drawbars.forEach((h, i) => {
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = hz * h;
    const hg = ctx.createGain(); hg.gain.value = levels[i];
    osc.connect(hg); hg.connect(gain);
    osc.start(when); osc.stop(when + dur + 0.05);
  });
}

/** Play a chord using synthesis. `startDelay` offsets scheduling into the future
 *  (used on first tap to give ctx.resume() time to complete). */
function playSynthChordNow(
  name: string,
  sound: SoundType,
  durationSecs: number,
  ctx: AudioContext,
  startDelay = 0,
): void {
  const dest  = compressor!;
  const now   = ctx.currentTime + startDelay;
  const notes = CHORD_MIDI[name] ?? generateVoicing(name) ?? [];
  const strum = SF_STRUM[sound] ? 0.035 : 0;

  notes.forEach((midi, i) => {
    const hz   = midiToHz(midi);
    const when = now + i * strum;
    switch (sound) {
      case 'acoustic-guitar': pluck(ctx, dest, hz, when, durationSecs); break;
      case 'electric-guitar': pluckElectric(ctx, dest, hz, when, durationSecs); break;
      case 'piano':           pluckPiano(ctx, dest, hz, when, durationSecs); break;
      case 'synth':           pluckSynth(ctx, dest, hz, when, durationSecs); break;
      case 'organ':           pluckOrgan(ctx, dest, hz, when, durationSecs); break;
    }
  });
}

// ── Soundfont instrument cache ────────────────────────────────────────────────

const sfCache   = new Map<string, SfPlayer>();
const sfLoading = new Map<string, Promise<SfPlayer>>();

function loadInstrument(ctx: AudioContext, name: string): Promise<SfPlayer> {
  if (sfCache.has(name)) return Promise.resolve(sfCache.get(name)!);
  if (!sfLoading.has(name)) {
    // RC3: 8-second timeout so DuckDuckGo (which blocks gleitz.github.io)
    // doesn't hang indefinitely — falls through to synthesis fallback.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('soundfont timeout')), 8000)
    );
    const fetchPromise = import('soundfont-player').then(sf => {
      // Handle both ESM named exports and CJS default-wrapped bundles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (sf as any).instrument ? sf : ((sf as any).default ?? sf);
      return mod.instrument(ctx, name, {
        soundfont: 'MusyngKite',
        format: 'mp3',
      }) as Promise<SfPlayer>;
    }).then(player => {
      sfCache.set(name, player);
      sfLoading.delete(name); // clean up so the map stays small
      return player;
    });
    const p = Promise.race([fetchPromise, timeoutPromise]).catch(err => {
      sfLoading.delete(name); // RC2: clear on failure so next call retries
      throw err;
    }) as Promise<SfPlayer>;
    sfLoading.set(name, p);
  }
  return sfLoading.get(name)!;
}

/** Schedule soundfont notes. `startDelay` offsets scheduling into the future
 *  (used on first tap to give ctx.resume() time to complete). */
function playSampleChord(
  ctx: AudioContext,
  player: SfPlayer,
  name: string,
  durationSecs: number,
  strum: boolean,
  startDelay = 0,
): void {
  const notes     = CHORD_MIDI[name] ?? generateVoicing(name) ?? [];
  const strumStep = strum ? 0.035 : 0;
  const playAt    = ctx.currentTime + startDelay;

  notes.forEach((midi, i) => {
    player.play(midiToNoteName(midi), playAt + i * strumStep, {
      duration: durationSecs,
      gain: 0.8,
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Short oscillator click for the metronome. */
export function playClick(isAccent: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx  = getAC();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(compressor!);
    osc.type = 'triangle';
    osc.frequency.value = isAccent ? 1050 : 680;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(isAccent ? 0.55 : 0.30, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.start(t); osc.stop(t + 0.08);
  } catch { /* ignore */ }
}

/**
 * Begin loading soundfont samples for the given voice in the background.
 * Call this on the first user interaction (touchstart / mousedown) so samples
 * are cached and ready by the time the user taps a chord.
 * iOS AudioContext unlock is handled per-tap inside playChordWithSound.
 */
export function prewarmAudio(sound: SoundType = 'acoustic-guitar'): void {
  if (typeof window === 'undefined') return;
  const ctx = getAC();
  const sfName = SF_NAMES[sound];
  if (!sfCache.has(sfName) && !sfLoading.has(sfName)) {
    loadInstrument(ctx, sfName).catch(() => {}); // silent failure on DuckDuckGo
  }
}

/**
 * Play a chord with the selected voice.
 *
 * iOS unlock strategy:
 *  • When the context is suspended, play a silent 1-frame AudioBufferSourceNode
 *    directly via ctx.destination. This is the most reliable cross-version iOS
 *    unlock — resume() alone is not always sufficient (iOS may invoke dnd-kit's
 *    tap handler programmatically after its 200ms delay, outside a native gesture
 *    context, causing resume() to be ignored).
 *  • ctx.resume() is called synchronously within the gesture — iOS honours this.
 *    Notes are then scheduled in .then() after the context is confirmed running,
 *    so currentTime is already advancing and startTime is never in the past.
 *
 * Playback strategy:
 *  • Samples cached  → play samples (best quality, no latency).
 *  • Samples missing → play synthesis immediately (instant, no CDN wait),
 *                      and start CDN load in background so the next tap uses samples.
 *
 * DuckDuckGo (CDN blocked): synthesis plays on every tap — no silence, no 8s wait.
 */
export function playChordWithSound(
  name: string,
  sound: SoundType,
  durationSecs = 3,
): void {
  if (typeof window === 'undefined') return;

  const ctx      = getAC();
  const sfName   = SF_NAMES[sound];
  const isGuitar = !!SF_STRUM[sound];

  function schedule() {
    // Context is guaranteed running here. Schedule 50ms ahead so automation
    // events (setValueAtTime etc.) are never in the past.
    const startDelay = 0.05;
    const cached = sfCache.get(sfName);

    if (cached) {
      // Samples ready — play immediately.
      playSampleChord(ctx, cached, name, durationSecs, isGuitar, startDelay);
    } else if (sfLoading.has(sfName)) {
      // Samples are in-flight (started loading during prewarm). Wait for them
      // rather than layering synthesis on top — that causes a double-play when
      // both finish within milliseconds of each other.
      sfLoading.get(sfName)!
        .then(player => playSampleChord(ctx, player, name, durationSecs, isGuitar, 0.05))
        .catch(() => playSynthChordNow(name, sound, durationSecs, ctx, 0.05));
    } else {
      // CDN unreachable (e.g. DuckDuckGo blocks gleitz.github.io) — use synthesis
      // as the fallback and retry the load in the background for next time.
      playSynthChordNow(name, sound, durationSecs, ctx, startDelay);
      loadInstrument(ctx, sfName).catch(() => {});
    }
  }

  if (ctx.state === 'running') {
    schedule(); // already running — schedule immediately
  } else {
    // iOS unlock: play a real (silent) AudioBufferSourceNode directly through
    // ctx.destination. This activates the iOS audio engine for this context on
    // ALL iOS versions — resume() alone is not always sufficient.
    try {
      const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = silentBuf;
      silentSrc.connect(ctx.destination);
      silentSrc.start(0);
    } catch { /* ignore */ }

    // Call resume() synchronously within the gesture (iOS requires this).
    // Schedule notes in .then() — no gesture needed for node creation/scheduling.
    ctx.resume().then(schedule).catch(() => {});
  }
}

/** Backward-compat wrapper — plays as acoustic guitar. */
export function playChord(name: string, durationSecs = 3): void {
  playChordWithSound(name, 'acoustic-guitar', durationSecs);
}

/** Backward-compat wrapper — plays as organ. */
export function playChordSynth(name: string, durationSecs = 3): void {
  playChordWithSound(name, 'organ', durationSecs);
}

'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { playChord, playChordWithSound, playClick, prewarmAudio, type SoundType } from '@/lib/audio';
import { detectKey, getDiatonicChords, randomProgression } from '@/lib/music';
import { getChordNotes, getQualityLabel, getGuitarShape } from '@/lib/guitar';
import {
  type LibraryEntry,
  getLibrary, upsertEntry, renameEntry, deleteEntry,
} from '@/lib/library';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

// ── Chord categories ──────────────────────────────────────────────────────────

const ROOTS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_CATEGORIES = [
  { label: 'Major',  chords: ROOTS.map(r => r) },
  { label: 'Minor',  chords: ROOTS.map(r => r + 'm') },
  { label: 'Dom 7',  chords: ROOTS.map(r => r + '7') },
  { label: 'Maj 7',  chords: ROOTS.map(r => r + 'maj7') },
  { label: 'Min 7',  chords: ROOTS.map(r => r + 'm7') },
  { label: 'Sus 2',  chords: ROOTS.map(r => r + 'sus2') },
  { label: 'Sus 4',  chords: ROOTS.map(r => r + 'sus4') },
];

const TIME_SIGS = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
] as const;

interface ChordSlot { id: string; chord: string; }

// ── Auto title ────────────────────────────────────────────────────────────────

// djb2-style hash over all characters of all chord names — much more varied
// than summing only the first character, so different progressions rarely collide.
function hashChords(chords: ChordSlot[]): number {
  let h = 5381;
  for (const { chord } of chords) {
    for (let i = 0; i < chord.length; i++) {
      h = (Math.imul(h, 31) + chord.charCodeAt(i)) | 0;
    }
  }
  return Math.abs(h);
}

const TITLE_POOLS: Record<string, string[]> = {
  happy: [
    'Barefoot on the Porch',
    'Gas Station Sunflowers',
    'Everything Worked Out Fine',
    'Accidentally Having Fun',
    'The Dog Was Happy Too',
    'Somebody Left the Windows Open',
    'Winning at Something Small',
    'Last Song Before the Drive Home',
    'Found Money in an Old Jacket',
    'Second Cup and Nowhere to Be',
    'The Part Where It Gets Good',
    'Said Yes for Once',
    'Morning Before Anything Goes Wrong',
    'Picnic Table Philosophy',
    'Spontaneous Tuesday',
    'All the Good Omens at Once',
    'Running Because It Feels Good',
    'The Neighbour Who Always Waves',
    'Easier Than Expected',
    'Nobody Called It a Miracle But',
    'First Day of Leaving Early',
    'Just Enough Shade',
    'Perfect Timing for Once',
    'The Summer That Actually Worked Out',
    'Didn\'t Even Have to Try',
  ],
  sad: [
    'The Rain Has a Point',
    'Three Chairs at a Four-Chair Table',
    'Technically Still Waving',
    'Left the Light On Again',
    'Nice Try, Sunshine',
    'Still Your Ringtone',
    'The Long Version of Fine',
    'Half the Photos on the Wall',
    'Forwarding Address Unknown',
    'The House That Sounds Different Now',
    'Almost Didn\'t Notice',
    'Saving the Last Good Day',
    'A Name I Still Type Wrong',
    'Sitting With It',
    'The Drive You Take Alone',
    'Something That Used to Be Easy',
    'Nobody\'s Fault, Apparently',
    'Forgot You Liked That Song',
    'The First Winter Back',
    'Before I Knew What I Was Losing',
    'Recognising Your Car in Traffic',
    'Keeps Coming Back in the Evening',
    'Held the Door for No One',
    'Quiet Side of the Moon',
    'Unopened',
  ],
  bluesy: [
    'Coffee Gone Cold',
    'Tuesday, Again',
    'The Ceiling Fan Understands',
    'Borrowed Lighter Blues',
    'Laundromat at Midnight',
    'Cheap Hotel, Good View',
    'Third Shift at the End of Things',
    'Nothing a Cigarette Won\'t Ignore',
    'Pay Phone Philosophy',
    'The Neon Stayed On All Night',
    'Slow Leak',
    'Twelve Bar Town',
    'Last Call for Something Better',
    'Empty Booth at the Back',
    'Been Down So Long',
    'The Jukebox Knows',
    'Smoke and an Old Wound',
    'Busted Air Conditioning Blues',
    'Miles of Nothing, Mostly',
    'Parking Lot Sermon',
    'Gravel Road Exit',
    'Honest to God I Tried',
    'Nothing Left to Pawn',
    'Two Days Past Payday',
    'Running on Fumes and Stubbornness',
  ],
  dreamy: [
    'Floating Above the Parking Lot',
    'The Moon Owes Me Money',
    'Soft Focus Everything',
    'Almost Asleep on the Porch',
    'Clouds Have No Opinions',
    'The Hour That Doesn\'t Count',
    'Light Through Someone Else\'s Curtains',
    'Not Quite Asleep, Not Quite Here',
    'Swimming in the Wrong Direction',
    'Half a Thought at 3am',
    'The Room Before the Room',
    'Translated Badly from a Dream',
    'Slow Motion Leaving',
    'Parallel Version of This',
    'Golden Hour, Extended Cut',
    'What the Stars Actually Said',
    'Signal Lost in a Good Way',
    'Ambient and Unbothered',
    'Something in the Upper Register',
    'The Hum Underneath Everything',
    'Drifting in Open Water',
    'Frequencies You Can\'t Name',
    'Borrowed Gravity',
    'Where the Map Runs Out',
    'Soft Landing Somewhere Else',
  ],
  bittersweet: [
    'Getting Better at Goodbyes',
    'Half a Happy Ending',
    'The Long Way Home',
    'Mostly Fine',
    'Fond of This Mess',
    'Good Memories, Poor Timing',
    'Grateful for the Damage',
    'Everything I Kept Anyway',
    'Still Think About It, Less',
    'Better Than It Had Any Right to Be',
    'Worth It, Mostly',
    'The Version I Tell Now',
    'Already Starting to Miss It',
    'Things That Got Easier',
    'One Good Year',
    'How It Felt at the Time',
    'The Part I Actually Loved',
    'What I Got Instead',
    'Close Enough',
    'Held Longer Than Expected',
    'Making Peace With the Ending',
    'Wouldn\'t Change Much',
    'Both Things at Once',
    'The Best Worst Summer',
    'Exactly What I Needed, Eventually',
  ],
};

function generateTitle(chords: ChordSlot[]): string {
  if (chords.length === 0) return '';
  let minor = 0, seventh = 0, sus = 0, major = 0;
  for (const { chord } of chords) {
    if (/m7?$|min/.test(chord) && !chord.includes('maj')) minor++;
    else if (/7/.test(chord)) seventh++;
    else if (/sus/.test(chord)) sus++;
    else major++;
  }
  const t = chords.length;
  let vibe = 'bittersweet';
  if (minor / t > 0.5)        vibe = 'sad';
  else if (seventh / t > 0.4) vibe = 'bluesy';
  else if (sus / t > 0.3)     vibe = 'dreamy';
  else if (major / t > 0.6)   vibe = 'happy';
  const pool = TITLE_POOLS[vibe];
  return pool[hashChords(chords) % pool.length];
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden>
      <circle cx="4" cy="3" r="1.6" /><circle cx="10" cy="3" r="1.6" />
      <circle cx="4" cy="9" r="1.6" /><circle cx="10" cy="9" r="1.6" />
      <circle cx="4" cy="15" r="1.6" /><circle cx="10" cy="15" r="1.6" />
    </svg>
  );
}
function PlayIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden><polygon points="2,1 11,6 2,11" /></svg>;
}
function StopIcon({ size = 13 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>;
}
function LoopIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
function ShareIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="1" x2="8" y2="10" /><polyline points="5,4 8,1 11,4" />
      <path d="M4 10v3.5a0.5 0.5 0 0 0 0.5 0.5h7a0.5 0.5 0 0 0 0.5-0.5V10" />
    </svg>
  );
}
function LockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 14" fill="currentColor" aria-hidden>
      <rect x="2" y="6" width="8" height="7" rx="1.5" />
      <path d="M4 6V4.5a2 2 0 1 1 4 0V6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function WarnIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.5L1 14h14L8 1.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="8" y1="6.5" x2="8" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}
function InfoIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  );
}
function UploadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 10V2" />
      <path d="M4 5l4-4 4 4" />
      <path d="M2 13h12" />
    </svg>
  );
}
function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden
      className="animate-spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
function MetronomeIcon({ size = 16 }: { size?: number }) {
  // Stylised metronome: trapezoid body + pendulum arm
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {/* Body (trapezoid) */}
      <polygon points="4,14 12,14 10,3 6,3" />
      {/* Pendulum arm angled right */}
      <line x1="8" y1="13" x2="11.5" y2="5.5" />
      {/* Weight dot */}
      <circle cx="11.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function DiceIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" />
      <circle cx="8"  cy="8"  r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="8"  r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8"  cy="16" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LibraryIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function SaveIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

// ── Piano keyboard ────────────────────────────────────────────────────────────

// Black key position offsets (fraction of white-key width from left edge of that white key)
const BLACK_KEY_OFFSETS: Record<string, number> = {
  'C#': 0.65, 'D#': 1.65, 'F#': 3.65, 'G#': 4.65, 'A#': 5.65,
};
const WHITE_NOTES = ['C','D','E','F','G','A','B'];
const BLACK_NOTES = ['C#','D#','F#','G#','A#'];

function PianoKeys({ notes }: { notes: string[] }) {
  const noteSet = new Set(notes);
  const WW = 32; // white key width
  const WH = 64; // white key height
  const BW = 20; // black key width
  const BH = 40; // black key height
  const totalW = WW * 7;

  return (
    <svg width={totalW} height={WH} viewBox={`0 0 ${totalW} ${WH}`} className="rounded overflow-hidden">
      {/* White keys */}
      {WHITE_NOTES.map((note, i) => (
        <g key={note}>
          <rect
            x={i * WW} y={0} width={WW - 1} height={WH}
            fill={noteSet.has(note) ? '#c7d2fe' : '#fff'}
            stroke="#e7e5e4" strokeWidth="1" rx="2"
          />
          {noteSet.has(note) && (
            <text x={i * WW + WW / 2} y={WH - 9} textAnchor="middle"
              fontSize="9" fontWeight="700" fill="#4f46e5" fontFamily="sans-serif">
              {note}
            </text>
          )}
        </g>
      ))}
      {/* Black keys */}
      {BLACK_NOTES.map(note => {
        const x = (BLACK_KEY_OFFSETS[note] ?? 0) * WW;
        return (
          <rect
            key={note}
            x={x} y={0} width={BW} height={BH}
            fill={noteSet.has(note) ? '#4f46e5' : '#1c1917'}
            rx="2"
          />
        );
      })}
    </svg>
  );
}

// ── Guitar diagram ────────────────────────────────────────────────────────────

function GuitarDiagram({ chordName }: { chordName: string }) {
  const shape = getGuitarShape(chordName);
  if (!shape) return null;

  const { frets, baseFret, barre } = shape;
  const STRINGS = 6;
  const SX = 24;   // string spacing
  const FY = 22;   // fret spacing
  const PX = 16;   // left padding (for mute/open markers)
  const PY = 20;   // top padding

  // Use the shape's baseFret as the diagram start; dynamically expand for wide-span chords
  const playedFrets = frets.filter(f => f > 0);
  const maxFret = playedFrets.length ? Math.max(...playedFrets) : baseFret + 3;
  const displayBase = baseFret;
  const FRETS = Math.max(5, maxFret - displayBase + 2);
  const W = PX + (STRINGS - 1) * SX + 20;
  const H = PY + FRETS * FY + 16;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Nut (thick top bar) or baseFret number */}
      {displayBase === 1 ? (
        <rect x={PX} y={PY - 4} width={(STRINGS - 1) * SX} height={5} fill="#1c1917" rx="1" />
      ) : (
        <text x={PX - 4} y={PY + FY / 2 + 4} textAnchor="end" fontSize="10" fill="#78716c" fontFamily="sans-serif">
          {displayBase}
        </text>
      )}

      {/* Fret lines */}
      {Array.from({ length: FRETS }).map((_, fi) => (
        <line key={fi}
          x1={PX} y1={PY + fi * FY}
          x2={PX + (STRINGS - 1) * SX} y2={PY + fi * FY}
          stroke="#d6d3d1" strokeWidth="1"
        />
      ))}
      {/* String lines */}
      {Array.from({ length: STRINGS }).map((_, si) => (
        <line key={si}
          x1={PX + si * SX} y1={PY}
          x2={PX + si * SX} y2={PY + (FRETS - 1) * FY}
          stroke="#a8a29e" strokeWidth="1.2"
        />
      ))}

      {/* Barre bar */}
      {barre !== undefined && (
        <rect
          x={PX - 2}
          y={PY + (barre - displayBase) * FY + 3}
          width={(STRINGS - 1) * SX + 4}
          height={FY - 8}
          fill="#4f46e5" rx={6}
          opacity={0.85}
        />
      )}

      {/* Finger dots */}
      {frets.map((fret, si) => {
        const x = PX + si * SX;
        if (fret <= 0) return null; // open or muted handled separately
        const isBarre = barre !== undefined && fret === barre;
        if (isBarre) return null; // covered by barre bar
        const row = fret - displayBase;
        if (row < 0 || row >= FRETS) return null;
        const y = PY + row * FY + FY / 2;
        return <circle key={si} cx={x} cy={y} r={7} fill="#4f46e5" />;
      })}

      {/* Open / muted markers above nut */}
      {frets.map((fret, si) => {
        const x = PX + si * SX;
        const y = PY - 12;
        if (fret === 0) return <text key={si} x={x} y={y} textAnchor="middle" fontSize="11" fill="#4f46e5" fontFamily="sans-serif">○</text>;
        if (fret === -1) return <text key={si} x={x} y={y} textAnchor="middle" fontSize="11" fill="#a8a29e" fontFamily="sans-serif">✕</text>;
        return null;
      })}
    </svg>
  );
}

// ── Chord detail panel ────────────────────────────────────────────────────────

function ChordDetail({ chordName }: { chordName: string }) {
  const notes = getChordNotes(chordName);
  const qualityLabel = getQualityLabel(chordName);
  const m = chordName.match(/^([A-G][#b]?)(.*)/);
  const root = m?.[1] ?? chordName;
  const hasGuitar = !!getGuitarShape(chordName);

  return (
    <div className="mt-2 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 space-y-3">
      {/* Header */}
      <div>
        <p className="text-base font-bold text-stone-800">{root} <span className="font-normal text-stone-500">{qualityLabel}</span></p>
        <p className="text-xs text-stone-400 mt-0.5">{notes.join(' · ')}</p>
      </div>

      {/* Guitar + Piano side by side, each column exactly 50% wide and centred */}
      <div className="flex items-start">
        {hasGuitar ? (
          <>
            <div className="w-1/2 flex flex-col items-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-300 mb-1.5">Guitar</p>
              <GuitarDiagram chordName={chordName} />
            </div>
            <div className="w-1/2 flex flex-col items-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-300 mb-1.5">Piano</p>
              <PianoKeys notes={notes} />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-300 mb-1.5">Piano</p>
            <PianoKeys notes={notes} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Import sheet ──────────────────────────────────────────────────────────────

interface ImportSection { name: string; chords: string[]; }

interface ImportResult {
  key?:          string;
  bpm?:          number;
  chords?:       string[];
  chordsSource?: 'ai' | 'browser';
  sections?:     ImportSection[];
  error?:        string;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Visual waveform strip with a dual-handle range slider. */
function WaveformStrip({
  waveform, duration, start, end, onStartChange, onEndChange,
}: {
  waveform:      number[];
  duration:      number;
  start:         number;
  end:           number;
  onStartChange: (v: number) => void;
  onEndChange:   (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const startFrac = start / duration;
  const endFrac   = end   / duration;
  const totalSec  = Math.round(end - start);
  const MIN_GAP   = 5; // seconds

  function getTrackFrac(clientX: number): number {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  return (
    <div className="space-y-3">
      {/* Waveform bars */}
      <div className="flex items-center gap-px h-10 rounded overflow-hidden">
        {waveform.map((v, i) => {
          const xFrac   = i / waveform.length;
          const inRange = xFrac >= startFrac && xFrac <= endFrac;
          return (
            <div key={i}
              className={`flex-1 rounded-sm ${inRange ? 'bg-indigo-400' : 'bg-stone-200'}`}
              style={{ height: `${Math.max(8, v * 100)}%` }}
            />
          );
        })}
      </div>

      {/* Dual-thumb range slider */}
      <div ref={trackRef} className="relative h-6 flex items-center select-none touch-none">
        {/* Track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-stone-200" />
        {/* Active fill */}
        <div
          className="absolute h-1.5 rounded-full bg-indigo-400"
          style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
        />
        {/* Start thumb */}
        <div
          className="absolute w-5 h-5 rounded-full bg-white border-2 border-indigo-500 shadow cursor-grab active:cursor-grabbing -translate-x-1/2"
          style={{ left: `${startFrac * 100}%`, zIndex: endFrac - startFrac < 0.05 ? 3 : 2 }}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            onStartChange(Math.min(getTrackFrac(e.clientX) * duration, end - MIN_GAP));
          }}
          onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)}
        />
        {/* End thumb */}
        <div
          className="absolute w-5 h-5 rounded-full bg-white border-2 border-indigo-500 shadow cursor-grab active:cursor-grabbing -translate-x-1/2"
          style={{ left: `${endFrac * 100}%`, zIndex: 2 }}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            onEndChange(Math.max(getTrackFrac(e.clientX) * duration, start + MIN_GAP));
          }}
          onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)}
        />
      </div>

      {/* Time labels: start · duration · end */}
      <div className="flex justify-between text-[10px] tabular-nums">
        <span className="text-indigo-500">{fmt(start)}</span>
        <span className="text-stone-400">
          {totalSec < 60 ? `${totalSec}s` : `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`} selected
        </span>
        <span className="text-indigo-500">{fmt(end)}</span>
      </div>
    </div>
  );
}

// ── Library drawer ────────────────────────────────────────────────────────────

function relativeDate(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  if (hr  < 24)  return `${hr}h ago`;
  if (day < 30)  return `${day}d ago`;
  return new Date(savedAt).toLocaleDateString();
}

function LibraryDrawer({
  onClose,
  onLoad,
}: {
  onClose: () => void;
  onLoad:  (entry: LibraryEntry) => void;
}) {
  const [entries, setEntries]         = useState<LibraryEntry[]>([]);
  const [editingKey, setEditingKey]   = useState<number | null>(null);
  const [editTitle, setEditTitle]     = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  useEffect(() => { setEntries(getLibrary()); }, []);

  function execCommandCopy(text: string) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }

  async function shareEntry(entry: LibraryEntry) {
    const url = `${window.location.origin}/p/${entry.serverId}`;
    const shareData = { title: `${entry.title} — Chord Chart`, url };
    if (navigator.share && navigator.canShare?.(shareData)) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        execCommandCopy(url);
      }
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    }
  }

  function handleRename(savedAt: number) {
    if (!editTitle.trim()) { setEditingKey(null); return; }
    renameEntry(savedAt, editTitle.trim());
    setEntries(getLibrary());
    setEditingKey(null);
  }

  function handleDelete(savedAt: number) {
    if (confirmDelete === savedAt) {
      deleteEntry(savedAt);
      setEntries(getLibrary());
      setConfirmDelete(null);
    } else {
      setConfirmDelete(savedAt);
      // Auto-clear after 3 s
      setTimeout(() => setConfirmDelete(c => c === savedAt ? null : c), 3000);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-white rounded-t-2xl shadow-2xl max-h-[80dvh] flex flex-col">
        {/* Toast — appears above the drawer's top edge */}
        {copiedToast && (
          <div className="absolute bottom-full left-4 right-4 mb-3 rounded-2xl bg-emerald-600/80 px-5 py-3 text-center text-sm font-semibold text-white pointer-events-none">
            Link copied to clipboard
          </div>
        )}

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-stone-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 shrink-0">
          <h2 className="text-base font-semibold text-stone-800">My Progressions</h2>
          <button onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors text-xl leading-none">
            &times;
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-4 py-3 pb-8 space-y-2">
          {entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-300">
              No saved progressions yet.<br />
              <span className="text-xs">Tap Save to store your current progression.</span>
            </div>
          ) : (
            entries.map(entry => (
              <div key={entry.savedAt}
                className="rounded-xl border border-stone-200 bg-white p-3 space-y-1.5">

                {/* Title row */}
                {editingKey === entry.savedAt ? (
                  <div className="flex gap-2 items-center">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(entry.savedAt); if (e.key === 'Escape') setEditingKey(null); }}
                      className="flex-1 rounded-lg border border-indigo-300 px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button onClick={() => handleRename(entry.savedAt)}
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
                      Save
                    </button>
                    <button onClick={() => setEditingKey(null)}
                      className="text-stone-400 hover:text-stone-600 transition-colors text-lg leading-none">
                      &times;
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingKey(entry.savedAt); setEditTitle(entry.title); }}
                    className="block w-full text-left text-sm font-semibold text-stone-800 hover:text-indigo-600 transition-colors truncate"
                    title="Tap to rename">
                    {entry.title}
                  </button>
                )}

                {/* Chord preview */}
                <p className="text-[11px] text-stone-400 truncate">
                  {entry.chordNames.slice(0, 8).join(' · ')}
                  {entry.chordNames.length > 8 && ` +${entry.chordNames.length - 8} more`}
                </p>

                {/* Meta row */}
                <div className="flex items-center gap-3 text-[10px] text-stone-300">
                  <span>{entry.bpm} BPM</span>
                  <span>{entry.timeSig}/4</span>
                  <span>{relativeDate(entry.savedAt)}</span>
                </div>

                {/* Action row */}
                <div className="flex gap-1.5 pt-0.5">
                  <button onClick={() => onLoad(entry)}
                    className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
                    Load
                  </button>
                  <button onClick={() => shareEntry(entry)}
                    aria-label="Share"
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-500 hover:bg-stone-50 transition-colors">
                    <ShareIcon size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.savedAt)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      confirmDelete === entry.savedAt
                        ? 'border-red-300 bg-red-50 text-red-500 hover:bg-red-100'
                        : 'border-stone-200 text-stone-400 hover:bg-stone-50'
                    }`}>
                    {confirmDelete === entry.savedAt ? 'Confirm' : 'Delete'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function SettingsDrawer({
  onClose,
  sound, setSound,
  metronome, setMetronome,
  timeSigBeats, setTimeSigBeats,
  playing,
  startMetronome, stopMetronome,
}: {
  onClose: () => void;
  sound: SoundType;
  setSound: (s: SoundType) => void;
  metronome: boolean;
  setMetronome: (v: boolean) => void;
  timeSigBeats: number;
  setTimeSigBeats: (v: number) => void;
  playing: boolean;
  startMetronome: () => void;
  stopMetronome: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-white rounded-t-2xl shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-stone-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <h2 className="text-base font-semibold text-stone-800">Settings</h2>
          <button onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors text-xl leading-none">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5 pb-8">

          {/* Sound */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-stone-700">Sound</span>
            <div className="space-y-0.5">
              {([
                ['acoustic-guitar', 'Acoustic Guitar'],
                ['electric-guitar', 'Electric Guitar'],
                ['piano',           'Grand Piano'],
                ['synth',           'Synth Pad'],
                ['organ',           'Organ'],
              ] as const).map(([value, label]) => (
                <button key={value} onClick={() => setSound(value)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    sound === value
                      ? 'bg-indigo-50 font-medium text-indigo-700'
                      : 'text-stone-600 hover:bg-stone-50'
                  }`}>
                  {label}
                  {sound === value && <span className="text-xs text-indigo-500">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Metronome */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">Metronome</span>
            <button
              onClick={() => {
                const next = !metronome;
                setMetronome(next);
                if (playing) { next ? startMetronome() : stopMetronome(); }
              }}
              aria-label={metronome ? 'Disable metronome' : 'Enable metronome'}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                metronome ? 'bg-indigo-600' : 'bg-stone-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                metronome ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* Time Signature */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">Time Signature</span>
            <div className="flex gap-1">
              {TIME_SIGS.map(({ label, beats }) => (
                <button key={label} onClick={() => setTimeSigBeats(beats)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    timeSigBeats === beats
                      ? 'bg-indigo-600 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

function ImportSheet({
  onClose,
  onApply,
  onPreviewChord = playChord,
}: {
  onClose: () => void;
  onApply: (r: ImportResult) => void;
  onPreviewChord?: (chord: string) => void;
}) {
  const [file, setFile]                 = useState<File | null>(null);
  const [isDragOver, setIsDragOver]     = useState(false);
  const [status, setStatus]             = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const [progress, setProgress]         = useState(0);
  const [statusMsg, setStatusMsg]       = useState('');
  const [result, setResult]             = useState<ImportResult | null>(null);
  const fileRef                         = useRef<HTMLInputElement>(null);
  const decodeGenRef                    = useRef(0);

  // Waveform + range selection state (file uploads only)
  type DecodedAudio = import('@/lib/audio-analyze').DecodedAudio;
  const [decoded, setDecoded]           = useState<DecodedAudio | null>(null);
  const [isDecoding, setIsDecoding]     = useState(false);
  const [rangeStart, setRangeStart]     = useState(0);
  const [rangeEnd, setRangeEnd]         = useState(0);

  // Range preview playback
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewSourceRef                = useRef<AudioBufferSourceNode | null>(null);
  const previewAcRef                    = useRef<AudioContext | null>(null);

  // Stop playback when the sheet unmounts (e.g. user closes it mid-preview)
  useEffect(() => {
    return () => { previewSourceRef.current?.stop(); };
  }, []);

  // Section tabs state
  const [sections, setSections]         = useState<ImportSection[]>([]);
  const [activeSection, setActiveSection] = useState(0);

  // Optional BPM hint — user can supply the correct BPM before analysis
  // to override the autocorrelation estimate when it's known to be wrong.
  // Raw string so partial typing ("1", "12") doesn't clear the field.
  const [bpmHintStr, setBpmHintStr]     = useState('');
  const bpmHintNum = (() => {
    const n = parseInt(bpmHintStr, 10);
    return !isNaN(n) && n >= 40 && n <= 220 ? n : undefined;
  })();

  const canAnalyze = status !== 'analyzing' && file !== null;

  function acceptFile(f: File) {
    if (f.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i.test(f.name)) {
      setFile(f);
      setStatus('idle');
      setResult(null);
      setSections([]);
      setDecoded(null);
      setIsDecoding(true);
      const gen = ++decodeGenRef.current;  // C: generation counter — stale decodes discard
      // Decode audio in the background so the waveform is ready before "Analyze"
      f.arrayBuffer().then(buf =>
        import('@/lib/audio-analyze').then(({ decodeAudioBuffer }) =>
          decodeAudioBuffer(buf).then(d => {
            if (decodeGenRef.current !== gen) return; // stale — a newer file took over
            setDecoded(d);
            setRangeStart(0);
            setRangeEnd(Math.round(d.duration));
            setIsDecoding(false);
          }).catch(() => { if (decodeGenRef.current === gen) setIsDecoding(false); })
        )
      );
    }
  }

  async function analyze() {
    if (!canAnalyze) return;
    setStatus('analyzing');
    setProgress(0);
    setStatusMsg('Starting…');
    setResult(null);
    setSections([]);
    setActiveSection(0);

    try {
      type AIResponse = {
        sections?: ImportSection[];
        chords?:   string[];
        key?:      string;
        bpm?:      number;
      };

      if (file) {
        // ── Decode (use cached if available, decode inline otherwise) ─────────
        let dec = decoded;
        if (!dec) {
          setStatusMsg('Decoding audio…');
          const buf = await file.arrayBuffer();
          const { decodeAudioBuffer } = await import('@/lib/audio-analyze');
          dec = await decodeAudioBuffer(buf);
          setDecoded(dec);
          setRangeStart(0);
          setRangeEnd(Math.round(dec.duration));
        }
        setProgress(12);

        // ── Client-side key + BPM + rough chord guess ─────────────────────────
        const { analyzeDecoded, encodePcmToWav } = await import('@/lib/audio-analyze');
        const audio = await analyzeDecoded(
          dec,
          {
            startSec:    rangeStart,
            endSec:      rangeEnd || dec.duration,
            bpmOverride: bpmHintNum,  // user hint takes top priority
          },
          pct => {
            setProgress(12 + Math.round(pct * 0.48));
            if (pct < 35)       setStatusMsg('Detecting key…');
            else if (pct < 68)  setStatusMsg('Detecting tempo…');
            else                setStatusMsg('Estimating chords…');
          },
        );
        setProgress(62);

        // ── Build WAV of selected range → send to Gemini ─────────────────────
        let newSections: ImportSection[] = [];
        let chordsSource: 'ai' | 'browser' = 'browser';
        let aiBpm: number | undefined;

        try {
          setStatusMsg('Detecting chord structure (AI)…');
          const startSample = Math.floor(rangeStart * dec.sampleRate);
          const endSample   = Math.min(
            Math.floor((rangeEnd || dec.duration) * dec.sampleRate),
            dec.mono.length,
          );
          const slice   = dec.mono.slice(startSample, endSample);
          const wavBytes = encodePcmToWav(slice, dec.sampleRate);

          const fd = new FormData();
          fd.append('audio', new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' }), 'selection.wav');
          const aiRes = await fetch('/api/analyze', { method: 'POST', body: fd });
          setProgress(95);

          if (aiRes.ok) {
            const ai = await aiRes.json() as AIResponse;
            // Prefer Gemini's BPM over browser autocorrelation (more accurate)
            if (typeof ai.bpm === 'number' && ai.bpm >= 40 && ai.bpm <= 220)
              aiBpm = ai.bpm;
            if (ai.sections && ai.sections.length > 0) {
              newSections  = ai.sections;
              chordsSource = 'ai';
            } else if (Array.isArray(ai.chords) && ai.chords.length > 0) {
              newSections  = [{ name: 'Main', chords: ai.chords }];
              chordsSource = 'ai';
            }
          }
        } catch { /* Gemini not configured or network error — use browser estimate */ }

        // ── Fall back to browser estimate if AI produced nothing ──────────────
        if (newSections.length === 0 && audio.chords && audio.chords.length > 0) {
          newSections = [{ name: 'Main', chords: audio.chords }];
        }

        setSections(newSections);
        setActiveSection(0);
        setProgress(100);
        setResult({
          key:          audio.key,
          bpm:          bpmHintNum ?? aiBpm ?? audio.bpm,  // hint > Gemini > autocorrelation
          chords:       newSections[0]?.chords,
          chordsSource: newSections.length > 0 ? chordsSource : undefined,
          sections:     newSections,
        });
      }

      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setResult({ error: msg });
      setStatus('error');
    }
  }

  function togglePreview() {
    if (isPreviewing) {
      previewSourceRef.current?.stop();
      previewSourceRef.current = null;
      setIsPreviewing(false);
      return;
    }
    if (!decoded) return;

    // Lazily create AudioContext on first user gesture
    if (!previewAcRef.current) previewAcRef.current = new AudioContext();
    const ac = previewAcRef.current;

    // Slice the decoded mono PCM to the selected range
    const startSample = Math.floor(rangeStart * decoded.sampleRate);
    const endSample   = Math.min(
      Math.floor(rangeEnd * decoded.sampleRate),
      decoded.mono.length,
    );
    const slice = decoded.mono.slice(startSample, endSample);

    // Copy into an AudioBuffer and play directly — no WAV encoding needed
    const buffer = ac.createBuffer(1, slice.length, decoded.sampleRate);
    buffer.copyToChannel(slice, 0);

    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.connect(ac.destination);
    source.onended = () => {
      previewSourceRef.current = null;
      setIsPreviewing(false);
    };
    source.start();
    previewSourceRef.current = source;
    setIsPreviewing(true);
  }

  function reset() {
    // Stop any active preview before resetting
    previewSourceRef.current?.stop();
    previewSourceRef.current = null;
    setIsPreviewing(false);
    setFile(null);
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setDecoded(null);
    setIsDecoding(false);
    setRangeStart(0);
    setRangeEnd(0);
    setSections([]);
    setActiveSection(0);
    setBpmHintStr('');
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-white rounded-t-2xl shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-stone-200" />
        </div>

        <div className="px-5 pb-8 pt-1 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-stone-900">Import a song</h2>
            <button onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 text-xl leading-none transition-colors">
              ×
            </button>
          </div>

          {/* File drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) acceptFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-7 transition-colors cursor-pointer ${
              isDragOver ? 'border-indigo-400 bg-indigo-50'
              : file     ? 'border-indigo-300 bg-indigo-50'
              :            'border-stone-200 hover:border-stone-300 hover:bg-stone-50'
            }`}
          >
            <span className="text-2xl select-none">🎵</span>
            {file ? (
              <p className="text-sm font-semibold text-indigo-600 px-4 text-center truncate max-w-full">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-stone-600">Drop audio here, or tap to browse</p>
                <p className="text-xs text-stone-400">MP3, WAV, FLAC, M4A, OGG…</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="audio/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f); e.target.value = ''; }} />

          {/* Waveform + range: hidden once analysis is done */}
          {status !== 'done' && (
            <>
              {/* Waveform + range selection (shown once file is decoded) */}
              {isDecoding && (
                <div className="flex items-center gap-2 px-1 text-xs text-stone-400">
                  <SpinnerIcon size={11} /> Preparing waveform…
                </div>
              )}
              {decoded && !isDecoding && (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">
                      Select range to analyze
                    </p>
                    <button
                      onClick={togglePreview}
                      className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      {isPreviewing ? <StopIcon size={10} /> : <PlayIcon size={10} />}
                      {isPreviewing ? 'Stop' : 'Preview'}
                    </button>
                  </div>
                  <WaveformStrip
                    waveform={decoded.waveform}
                    duration={decoded.duration}
                    start={rangeStart}
                    end={rangeEnd}
                    onStartChange={setRangeStart}
                    onEndChange={setRangeEnd}
                  />
                  {/* Optional BPM hint: overrides autocorrelation when the user knows the tempo */}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 shrink-0">
                      BPM hint
                    </span>
                    <input
                      type="number" min={40} max={220} placeholder="optional"
                      value={bpmHintStr}
                      onChange={e => setBpmHintStr(e.target.value)}
                      className="w-20 rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-stone-300"
                    />
                    <span className="text-[10px] text-stone-300">if the auto-detect is off</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Progress bar */}
          {status === 'analyzing' && (
            <div className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${progress}%` }} />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-stone-400">
                <SpinnerIcon size={11} /> {statusMsg}
              </p>
            </div>
          )}

          {/* Error */}
          {status === 'error' && result?.error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {result.error}
            </div>
          )}

          {/* Results */}
          {status === 'done' && result && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500">Summary</p>

              {/* Key + BPM + Range row */}
              <div className="flex gap-6">
                {result.key && (
                  <div>
                    <p className="text-[10px] text-stone-400 uppercase tracking-widest mb-0.5">Key</p>
                    <p className="text-sm font-bold text-stone-800">{result.key}</p>
                  </div>
                )}
                {result.bpm && (
                  <div>
                    <p className="text-[10px] text-stone-400 uppercase tracking-widest mb-0.5">BPM</p>
                    <p className="text-sm font-bold text-stone-800">{result.bpm}</p>
                  </div>
                )}
                {decoded && (
                  <div>
                    <p className="text-[10px] text-stone-400 uppercase tracking-widest mb-0.5">Range</p>
                    <p className="text-sm font-bold text-stone-800">{fmt(rangeStart)} – {fmt(rangeEnd)}</p>
                    <p className="text-[10px] text-stone-400">
                      {(() => { const s = Math.round(rangeEnd - rangeStart); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; })()}
                    </p>
                  </div>
                )}
              </div>

              {/* Section tabs + chord chips */}
              {sections.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-stone-400 uppercase tracking-widest">
                    Chord structure
                    {result.chordsSource === 'ai'
                      ? <span className="ml-1 text-indigo-400">✦ AI</span>
                      : <span className="ml-1 text-stone-300">(estimated)</span>}
                  </p>

                  {/* Section tabs — only shown when >1 section */}
                  {sections.length > 1 && (
                    <div className="flex gap-1 flex-wrap">
                      {sections.map((s, i) => (
                        <button key={i} onClick={() => setActiveSection(i)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            i === activeSection
                              ? 'bg-indigo-600 text-white'
                              : 'bg-white border border-emerald-200 text-stone-600 hover:bg-emerald-100'
                          }`}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Chord chips — tap to hear */}
                  <div className="flex flex-wrap gap-1.5">
                    {(sections[activeSection]?.chords ?? []).map((c, i) => (
                      <button key={i} onClick={() => onPreviewChord(c)}
                        className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 cursor-pointer hover:bg-emerald-50 active:scale-95 transition-transform">
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {status !== 'done' ? (
            <button onClick={analyze} disabled={!canAnalyze}
              className="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-200 disabled:text-indigo-400 transition-colors">
              {status === 'analyzing' ? 'Analyzing…' : 'Analyze'}
            </button>
          ) : (
            <div className="space-y-2">
              {/* Tertiary: adjust range — file uploads only, sits below Summary card */}
              {decoded && (
                <button onClick={() => { setStatus('idle'); setResult(null); setSections([]); setActiveSection(0); }}
                  className="w-full py-1.5 text-sm text-indigo-500 hover:text-indigo-700 transition-colors">
                  Adjust range &amp; re-analyze
                </button>
              )}

              {/* Primary + secondary in one flex row */}
              {(() => {
                const activeChords = sections[activeSection]?.chords ?? result?.chords;
                return activeChords && activeChords.length > 0 ? (
                  <div className="flex gap-2">
                    <button onClick={() => onApply({ key: result!.key, bpm: result!.bpm, chords: activeChords })}
                      className="flex-1 rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 transition-colors">
                      Apply to chart
                    </button>
                    <button onClick={() => onApply({ key: result!.key, bpm: result!.bpm })}
                      className="flex-1 rounded-xl border border-stone-200 py-3.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 transition-colors">
                      Key &amp; BPM only
                    </button>
                  </div>
                ) : (
                  <button onClick={() => onApply({ key: result!.key, bpm: result!.bpm })}
                    className="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white hover:bg-indigo-700 transition-colors">
                    Apply to chart
                  </button>
                );
              })()}

              {/* Tertiary: analyze another — at very bottom */}
              <button onClick={reset}
                className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                Analyze another song
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Sortable chord row ────────────────────────────────────────────────────────

function SortableChordItem({
  slot, index, isActive, isOutOfKey, isExpanded,
  sweepKey, sweepDuration, fadeKey, isFading,
  onPreview, onRemove, onToggleExpand,
}: {
  slot: ChordSlot; index: number; isActive: boolean; isOutOfKey: boolean;
  isExpanded: boolean; sweepKey: number; sweepDuration: number;
  fadeKey: number; isFading: boolean;
  onPreview: () => void; onRemove: () => void; onToggleExpand: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : undefined,
      }}
    >
      {/* Main row */}
      <div className={`relative flex items-center gap-2 rounded-xl border bg-white px-3 py-2 overflow-hidden transition-colors duration-300 ${
        isDragging   ? 'border-indigo-300'
        : isOutOfKey ? 'border-red-200'
        : isExpanded ? 'border-indigo-300'
        : isActive   ? 'border-indigo-400'
        :              'border-stone-200'
      }`}>
        {/* Sweep overlay */}
        {sweepDuration > 0 && (
          <div key={`s${sweepKey}`}
            className="absolute inset-0 origin-left bg-indigo-100 pointer-events-none"
            style={{ animation: `chordSweep ${sweepDuration}ms linear forwards` }} />
        )}
        {/* Fade overlay */}
        {isFading && (
          <div key={`f${fadeKey}`}
            className="absolute inset-0 bg-indigo-100 pointer-events-none"
            style={{ animation: `chordFade 400ms ease-out forwards` }} />
        )}

        {/* Drag handle */}
        <button {...attributes} {...listeners} aria-label="Drag to reorder"
          className="relative z-10 flex h-9 w-8 touch-none cursor-grab items-center justify-center rounded text-stone-300 active:cursor-grabbing">
          <GripIcon />
        </button>

        {/* Index */}
        <span className="relative z-10 w-5 text-right text-xs tabular-nums text-stone-300">{index + 1}</span>

        {/* Chord name — tap to expand */}
        <button onClick={onToggleExpand}
          className={`relative z-10 flex-1 text-left text-xl font-bold transition-colors duration-300 ${
            isOutOfKey ? 'text-red-400' : isActive ? 'text-indigo-600' : 'text-stone-900'
          }`}>
          {slot.chord}
        </button>

        {/* Out-of-key badge */}
        {isOutOfKey && (
          <span className="relative z-10 flex items-center gap-1 rounded-full bg-red-50 border border-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400 mr-0.5">
            <WarnIcon size={10} /> out of key
          </span>
        )}

        {/* Info button */}
        <button onClick={onToggleExpand} aria-label={`${isExpanded ? 'Hide' : 'Show'} chord info`}
          className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            isExpanded ? 'bg-indigo-100 text-indigo-500' : 'text-stone-300 hover:bg-stone-100 hover:text-stone-500'
          }`}>
          <InfoIcon />
        </button>

        {/* Play button */}
        <button onClick={onPreview} aria-label={`Play ${slot.chord}`}
          className="relative z-10 flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-indigo-50 hover:text-indigo-500 transition-colors">
          <PlayIcon />
        </button>

        {/* Remove button */}
        <button onClick={onRemove} aria-label={`Remove ${slot.chord}`}
          className="relative z-10 flex h-8 w-8 items-center justify-center rounded-lg text-stone-300 hover:bg-red-50 hover:text-red-400 transition-colors">
          ×
        </button>
      </div>

      {/* Chord detail panel */}
      {isExpanded && <ChordDetail chordName={slot.chord} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const [title, setTitle]             = useState('');
  const [titleIsAuto, setTitleIsAuto] = useState(true);
  const [chords, setChords]           = useState<ChordSlot[]>([]);
  const [bpm, setBpm]                 = useState(120);
  const [timeSigBeats, setTimeSigBeats] = useState(4);
  const [metronome, setMetronome]     = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [looping, setLooping]         = useState(false);
  const [activeCategory, setActiveCategory] = useState('Major');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [importOpen, setImportOpen]   = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sound, setSound]             = useState<SoundType>('acoustic-guitar');

  // Library + save state
  const [libraryKey, setLibraryKey]   = useState<number | null>(null); // savedAt of current entry
  const [savedId,    setSavedId]      = useState<string | null>(null);  // current server id
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copiedToast, setCopiedToast] = useState(false);
  const [isRolled,   setIsRolled]     = useState(false); // true when chords came from dice roll

  // ── Key mode ──
  // 'auto'  : key floats with chord detection; user can lock it in
  // 'manual': user has explicitly chosen a key; always locked/filtering
  type KeyMode = 'auto' | 'manual';
  const [keyMode, setKeyMode]       = useState<KeyMode>('auto');
  const [pickedKey, setPickedKey]   = useState<string | null>(null); // manual pick or auto-locked snapshot
  const [keyLocked, setKeyLocked]   = useState(false);               // auto mode only
  const [showKeyPicker, setShowKeyPicker] = useState(false);
  const [pickerRoot, setPickerRoot] = useState<string | null>(null);

  // Sweep / fade
  const [sweepState, setSweepState] = useState<{ id: string; durationMs: number; key: number } | null>(null);
  const [fadeState,  setFadeState]  = useState<{ id: string; key: number } | null>(null);
  const sweepKeyRef   = useRef(0);
  const sweepCurRef   = useRef<{ id: string; key: number } | null>(null);
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FADE_MS = 400;
  const playbackTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatIndexRef      = useRef(0);
  const metronomeGenRef   = useRef(0); // incremented on each stop; stale closures bail early
  const chordsRef      = useRef(chords);
  const bpmRef         = useRef(bpm);
  const bpmInputRef    = useRef<HTMLInputElement>(null);
  const bpmDragRef     = useRef<{ startX: number; startBpm: number; moved: boolean } | null>(null);
  const loopingRef     = useRef(looping);
  const timeSigRef     = useRef(timeSigBeats);
  const metronomeRef   = useRef(metronome);
  useEffect(() => { chordsRef.current = chords; }, [chords]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { loopingRef.current = looping; }, [looping]);
  useEffect(() => { timeSigRef.current = timeSigBeats; }, [timeSigBeats]);
  useEffect(() => { metronomeRef.current = metronome; }, [metronome]);

  // Ref that lets programmatic loads (remix, library) skip the savedId-clear effect
  const skipSavedIdClearRef = useRef(false);

  // ── Remix params — pre-fill editor when arriving from /p/[id] Remix button ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const remixChords  = params.get('chords');
    const remixTitle   = params.get('title');
    const remixBpm     = params.get('bpm');
    const remixTimeSig = params.get('timeSig');
    if (!remixChords) return;

    const chordsArr = remixChords.split(',').filter(Boolean);
    if (!chordsArr.length) return;

    skipSavedIdClearRef.current = true;
    setChords(chordsArr.map(chord => ({ id: crypto.randomUUID(), chord })));
    if (remixTitle)   { setTitle(remixTitle); setTitleIsAuto(false); }
    if (remixBpm)     { const n = parseInt(remixBpm, 10);     if (!isNaN(n))             setBpm(Math.min(220, Math.max(40, n))); }
    if (remixTimeSig) { const n = parseInt(remixTimeSig, 10); if ([2,3,4,5].includes(n)) setTimeSigBeats(n); }

    setIsRolled(false);
    // Strip remix params from URL without triggering a reload
    window.history.replaceState({}, '', '/');
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (skipSavedIdClearRef.current) { skipSavedIdClearRef.current = false; return; }
    setSavedId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chords, title, bpm, timeSigBeats]);
  useEffect(() => () => {
    clearTimeout(playbackTimerRef.current!);
    clearTimeout(metronomeTimerRef.current!);
    clearTimeout(sweepTimerRef.current!);
    clearTimeout(fadeTimerRef.current!);
  }, []);

  // Preload soundfont samples on the first user interaction with the page.
  // This gives the samples a head-start so they're ready (or close to it)
  // by the time the user taps a chord.
  // Start loading soundfont samples for the selected voice on first user interaction,
  // so they're cached and ready by the time a chord is tapped.
  // iOS AudioContext unlock is handled per-tap inside playChordWithSound.
  useEffect(() => {
    const prime = () => prewarmAudio(sound);
    document.addEventListener('touchstart', prime, { once: true, passive: true });
    document.addEventListener('mousedown',  prime, { once: true });
    return () => {
      document.removeEventListener('touchstart', prime);
      document.removeEventListener('mousedown',  prime);
    };
  }, [sound]);

  // Sound helper — routes to the selected voice
  const play = useCallback(
    (chord: string, dur?: number) => playChordWithSound(chord, sound, dur),
    [sound],
  );

  const autoTitle   = useMemo(() => generateTitle(chords), [chords]);
  const detectedKey = useMemo(() => detectKey(chords), [chords]);

  // In auto mode: show detected key (or locked snapshot); in manual: show picked key
  const displayKey = keyMode === 'manual' ? pickedKey : (keyLocked ? pickedKey : detectedKey);

  // Filtering is active in manual mode always, or in auto mode when locked
  const filteringActive = keyMode === 'manual' || keyLocked;
  const diatonicSet = useMemo(
    () => (filteringActive && displayKey) ? getDiatonicChords(displayKey) : null,
    [filteringActive, displayKey],
  );

  useEffect(() => { if (titleIsAuto) setTitle(autoTitle); }, [autoTitle, titleIsAuto]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // ── Key actions ──

  function openPicker() { setPickerRoot(null); setShowKeyPicker(true); }
  function closePicker() { setShowKeyPicker(false); setPickerRoot(null); }

  function applyKey(root: string, quality: 'major' | 'minor') {
    setPickedKey(`${root} ${quality}`);
    setShowKeyPicker(false);
    setPickerRoot(null);
    // If in manual mode, filtering activates immediately
  }

  // Switch to Manual: open picker so user can choose; filtering activates after selection
  function switchToManual() {
    setKeyMode('manual');
    setKeyLocked(false);
    openPicker();
  }

  // Switch to Auto: clears picked key, unlocks, key floats again
  function switchToAuto() {
    setKeyMode('auto');
    setKeyLocked(false);
    setPickedKey(null);
    closePicker();
  }

  // Lock: in auto mode, snapshot the current detected key and freeze filtering
  function lockKey() {
    if (!displayKey) return;
    setPickedKey(displayKey); // snapshot
    setKeyLocked(true);
    closePicker();
  }

  function unlockKey() {
    setKeyLocked(false);
    setPickedKey(null);
  }

  // ── BPM swipe-to-adjust ──

  function onBpmPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    bpmDragRef.current = { startX: e.clientX, startBpm: bpm, moved: false };
  }

  function onBpmPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = bpmDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    const next = Math.min(220, Math.max(40, Math.round(drag.startBpm + dx / 3)));
    setBpm(next);
  }

  function onBpmPointerUp() {
    if (!bpmDragRef.current) return;
    if (!bpmDragRef.current.moved) {
      bpmInputRef.current?.select();
    }
    bpmDragRef.current = null;
  }

  // ── Animation helpers ──

  function beginFade(id: string, key: number) {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setFadeState({ id, key: key + 50000 });
    fadeTimerRef.current = setTimeout(() => setFadeState(null), FADE_MS);
  }
  function startSweep(id: string, durationMs: number) {
    const prev = sweepCurRef.current;
    if (prev) beginFade(prev.id, prev.key);
    if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    sweepKeyRef.current += 1;
    const key = sweepKeyRef.current;
    sweepCurRef.current = { id, key };
    setSweepState({ id, durationMs, key });
    sweepTimerRef.current = setTimeout(() => {
      sweepCurRef.current = null;
      setSweepState(null);
      beginFade(id, key);
    }, durationMs);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setChords(items => {
        const from = items.findIndex(c => c.id === active.id);
        const to   = items.findIndex(c => c.id === over.id);
        return arrayMove(items, from, to);
      });
    }
  }

  function rollDice() {
    const { chords: newChords, bpm: newBpm, key } = randomProgression();
    skipSavedIdClearRef.current = true;
    setChords(newChords.map(chord => ({ id: crypto.randomUUID(), chord })));
    setBpm(newBpm);
    setKeyMode('manual');
    setPickedKey(key);
    setKeyLocked(false);
    setShowKeyPicker(false);
    setTitleIsAuto(true);
    setExpandedId(null);
    setIsRolled(true);
  }

  function addChord(chord: string) {
    play(chord);
    setChords(prev => [...prev, { id: crypto.randomUUID(), chord }]);
    setIsRolled(false);
  }
  function removeChord(id: string) {
    setChords(prev => prev.filter(c => c.id !== id));
    if (expandedId === id) setExpandedId(null);
    setIsRolled(false);
  }
  function previewSlot(slot: ChordSlot) {
    play(slot.chord);
    startSweep(slot.id, 2500);
  }
  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  // maxBeats: exact number of clicks to play before self-stopping.
  // Pass Infinity for loop mode or when the total is unknown (toggle-while-playing).
  function startMetronome(maxBeats = Infinity) {
    const gen = ++metronomeGenRef.current; // invalidates any previously running closure
    beatIndexRef.current = 0;
    let played = 0;
    const tick = () => {
      if (metronomeGenRef.current !== gen) return; // stale — a newer call took over
      if (played >= maxBeats) return;              // beat budget exhausted — self-stop
      playClick(beatIndexRef.current === 0);        // accent on beat 1 of each measure
      beatIndexRef.current = (beatIndexRef.current + 1) % timeSigRef.current;
      played++;
      if (played < maxBeats) {
        // Only schedule the next tick if there are beats left.
        // This prevents a "beat 1 of the next measure" from being queued
        // at the exact moment the chord step stops playback.
        metronomeTimerRef.current = setTimeout(tick, (60 / bpmRef.current) * 1000);
      }
    };
    tick();
  }
  function stopMetronome() {
    metronomeGenRef.current++;                     // kill any in-flight closure
    clearTimeout(metronomeTimerRef.current!);
    metronomeTimerRef.current = null;
    beatIndexRef.current = 0;
  }

  function startPlayback() {
    if (!chordsRef.current.length) return;
    if (metronomeRef.current) {
      const cur = chordsRef.current;
      // For a finite run, give the metronome an exact beat budget so it never
      // queues a downbeat beyond the last measure. Loop mode gets Infinity.
      const maxBeats = loopingRef.current
        ? Infinity
        : cur.length * timeSigRef.current;
      startMetronome(maxBeats);
    }
    let i = 0;
    function step() {
      const cur = chordsRef.current;
      if (i >= cur.length) {
        if (loopingRef.current) { i = 0; } // loop back to start
        else { stopMetronome(); setPlaying(false); setSweepState(null); return; }
      }
      const slot = cur[i];
      const ms = (60 / bpmRef.current) * timeSigRef.current * 1000;
      play(slot.chord, ms / 1000 + 1);
      startSweep(slot.id, ms);
      i++;
      playbackTimerRef.current = setTimeout(step, ms);
    }
    setPlaying(true); step();
  }
  function stopPlayback() {
    stopMetronome();
    clearTimeout(playbackTimerRef.current!); playbackTimerRef.current = null;
    clearTimeout(sweepTimerRef.current!);    sweepTimerRef.current = null;
    clearTimeout(fadeTimerRef.current!);     fadeTimerRef.current = null;
    sweepCurRef.current = null;
    setPlaying(false); setSweepState(null); setFadeState(null);
  }

  async function saveToLibrary(): Promise<string | null> {
    if (!title.trim() || !chords.length) return null;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/progressions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), chords, bpm, timeSig: timeSigBeats }),
      });
      if (!res.ok) throw new Error();
      const { id } = await res.json() as { id: string };
      const key = libraryKey ?? Date.now();
      const entry: LibraryEntry = {
        serverId:   id,
        title:      title.trim(),
        chordNames: chords.map(c => c.chord),
        bpm, timeSig: timeSigBeats,
        savedAt:    key,
      };
      upsertEntry(entry);
      setSavedId(id);
      setLibraryKey(key);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      return id;
    } catch {
      setSaveStatus('idle');
      alert('Something went wrong. Please try again.');
      return null;
    }
  }

  // Clipboard helper: tries the modern API first, falls back to execCommand.
  // execCommand doesn't need the clipboard-write permission and works even after
  // an async gap (e.g. after awaiting a fetch), so it's the reliable fallback here.
  function copyToClipboard(text: string) {
    try {
      navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
    } catch {
      execCommandCopy(text);
    }
  }
  function execCommandCopy(text: string) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }

  async function share() {
    if (!title.trim()) { alert('Please add a song title.'); return; }
    if (!chords.length) { alert('Please add at least one chord.'); return; }

    // Ensure saved first — reuse existing ID if already saved with no edits
    let id = savedId;
    if (!id) { id = await saveToLibrary(); }
    if (!id) return;

    const url = `${window.location.origin}/p/${id}`;
    const shareData = { title: `${title.trim()} — Chord Chart`, url };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      copyToClipboard(url);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    }
  }

  function loadFromLibrary(entry: LibraryEntry) {
    stopPlayback();
    setExpandedId(null);
    setIsRolled(false);
    skipSavedIdClearRef.current = true; // prevent effect from clearing savedId
    setTitle(entry.title);
    setTitleIsAuto(false);
    setChords(entry.chordNames.map(chord => ({ id: crypto.randomUUID(), chord })));
    setBpm(entry.bpm);
    setTimeSigBeats(entry.timeSig);
    setSavedId(entry.serverId);
    setLibraryKey(entry.savedAt);
    setSaveStatus('idle');
    setLibraryOpen(false);
  }

  function handleImportApply(result: ImportResult) {
    setIsRolled(false);
    if (result.key) {
      // Switch to manual mode so the imported key is locked in place
      setKeyMode('manual');
      setPickedKey(result.key);
      setKeyLocked(false); // manual mode always filters
      setShowKeyPicker(false);
    }
    if (result.bpm) {
      setBpm(Math.max(40, Math.min(220, result.bpm)));
    }
    if (result.chords && result.chords.length > 0) {
      setChords(result.chords.map(chord => ({ id: crypto.randomUUID(), chord })));
    }
    setImportOpen(false);
  }

  // Visible chord categories (filtered when active)
  const visibleCategories = useMemo(() => {
    if (!diatonicSet) return CHORD_CATEGORIES;
    return CHORD_CATEGORIES
      .map(cat => ({ ...cat, chords: cat.chords.filter(c => diatonicSet.has(c)) }))
      .filter(cat => cat.chords.length > 0);
  }, [diatonicSet]);

  useEffect(() => {
    if (visibleCategories.length && !visibleCategories.find(c => c.label === activeCategory)) {
      setActiveCategory(visibleCategories[0].label);
    }
  }, [visibleCategories, activeCategory]);

  // ── Key row rendering ──

  // Badge shown next to the key name
  const keyBadge = () => {
    if (keyMode === 'manual') return (
      <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-500 shrink-0">
        <LockIcon size={9} /> manual
      </span>
    );
    if (keyLocked) return (
      <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-500 shrink-0">
        <LockIcon size={9} /> locked
      </span>
    );
    return (
      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-stone-400 shrink-0">
        auto
      </span>
    );
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-lg mx-auto">

      <header className="shrink-0 flex items-center gap-2 px-4 pt-5 pb-3 border-b border-stone-100">
        <span className="text-2xl leading-none">🎸</span>
        <h1 className="text-xl font-bold tracking-tight">Chord Chart</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setLibraryOpen(l => !l)}
            className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors">
            <LibraryIcon size={12} /> Library
          </button>
          <button onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors">
            <UploadIcon size={12} /> Import
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 [scrollbar-gutter:stable]">
        <div className="space-y-2">

          {/* Song controls — Title · Key · BPM */}
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">

            {/* Title row */}
            <div className="flex items-center gap-2 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-300 shrink-0">Title</span>
              <input type="text" placeholder="Song title" value={title}
                onChange={e => { setTitle(e.target.value); setTitleIsAuto(false); }}
                onBlur={() => { if (!title.trim()) setTitleIsAuto(true); }}
                className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-stone-700 placeholder-stone-300 focus:outline-none"
              />
              {titleIsAuto && title && (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-300 shrink-0 pointer-events-none select-none">
                  auto
                </span>
              )}
            </div>

            {/* Key row */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-t border-stone-100">
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-300 shrink-0">Key</span>

              {/* Key name + badge */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {displayKey ? (
                  keyMode === 'manual' ? (
                    /* Tappable in manual mode — tap the key name to re-open picker */
                    <button onClick={openPicker}
                      className="flex items-center gap-1.5 text-left group min-w-0">
                      <span className="text-sm font-semibold text-stone-700 truncate group-hover:underline group-active:text-indigo-600 transition-colors">
                        {displayKey}
                      </span>
                      {keyBadge()}
                    </button>
                  ) : (
                    <><span className="text-sm font-semibold text-stone-700 truncate">{displayKey}</span>{keyBadge()}</>
                  )
                ) : (
                  <span className="text-sm text-stone-300">Pick a key…</span>
                )}
              </div>

              {/* Two fixed buttons: Manual/Auto  |  Lock/Unlock */}
              <div className="flex items-center gap-0.5 shrink-0">
                {keyMode === 'auto' ? (
                  <button onClick={showKeyPicker ? closePicker : switchToManual}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      showKeyPicker ? 'bg-stone-100 text-stone-500' : 'text-stone-500 hover:bg-stone-100'
                    }`}>
                    {showKeyPicker ? 'Cancel' : 'Manual'}
                  </button>
                ) : (
                  <button onClick={switchToAuto}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-500 hover:bg-indigo-50 transition-colors">
                    Auto
                  </button>
                )}

                <span className="text-stone-200 select-none mx-0.5">|</span>

                {keyMode === 'manual' ? (
                  /* In manual mode: Change opens the picker; Cancel closes it */
                  <button onClick={showKeyPicker ? closePicker : openPicker}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      showKeyPicker ? 'bg-stone-100 text-stone-500' : 'text-stone-600 hover:bg-stone-100'
                    }`}>
                    {showKeyPicker ? 'Cancel' : 'Change'}
                  </button>
                ) : keyLocked ? (
                  <button onClick={unlockKey}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-500 hover:bg-indigo-50 transition-colors">
                    Unlock
                  </button>
                ) : (
                  <button onClick={lockKey} disabled={!displayKey}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      displayKey ? 'text-stone-600 hover:bg-stone-100' : 'text-stone-200 cursor-default'
                    }`}>
                    Lock
                  </button>
                )}
              </div>
            </div>

            {/* BPM row — swipe left/right to adjust, tap to type */}
            <div
              className="flex items-center gap-2 px-4 py-2 border-t border-stone-100 cursor-ew-resize touch-none select-none"
              onPointerDown={onBpmPointerDown}
              onPointerMove={onBpmPointerMove}
              onPointerUp={onBpmPointerUp}
            >
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-300 shrink-0">BPM</span>
              <span className="text-sm text-stone-300 leading-none">‹ ›</span>
              <div className="flex-1" />
              <input
                ref={bpmInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={bpm}
                onChange={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) setBpm(Math.min(220, Math.max(40, n))); }}
                className="w-12 text-center text-sm font-semibold tabular-nums focus:outline-none bg-transparent text-stone-700 pointer-events-none focus:pointer-events-auto"
              />
            </div>

            {/* Inline key picker (Manual mode flow) */}
            {showKeyPicker && (
              <div className="border-t border-stone-100 px-4 py-3 space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {ROOTS.map(root => (
                    <button key={root}
                      onClick={() => setPickerRoot(root === pickerRoot ? null : root)}
                      className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                        pickerRoot === root ? 'bg-indigo-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}>
                      {root}
                    </button>
                  ))}
                </div>
                {pickerRoot && (
                  <div className="flex gap-2">
                    <button onClick={() => applyKey(pickerRoot, 'major')}
                      className="flex-1 rounded-xl bg-indigo-50 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors">
                      {pickerRoot} Major
                    </button>
                    <button onClick={() => applyKey(pickerRoot, 'minor')}
                      className="flex-1 rounded-xl bg-stone-100 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-200 transition-colors">
                      {pickerRoot} Minor
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Progression */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Progression</p>
          {chords.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-stone-200 py-10 text-center text-sm text-stone-300">
              <p>Tap a chord below to start</p>
              <p className="mt-2.5">
                or{' '}
                <button
                  onClick={rollDice}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500 hover:bg-indigo-100 hover:text-indigo-600 active:scale-95 transition-all"
                >
                  improvise
                </button>
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={({ active }: DragStartEvent) => setDraggingId(String(active.id))}
              onDragEnd={e => { setDraggingId(null); handleDragEnd(e); }}
              onDragCancel={() => setDraggingId(null)}
            >
              <SortableContext items={chords.map(c => c.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {chords.map((slot, i) => {
                    const isSweeping = sweepState?.id === slot.id;
                    const isFading   = fadeState?.id  === slot.id;
                    const isOutOfKey = !!(diatonicSet && !diatonicSet.has(slot.chord));
                    return (
                      <SortableChordItem key={slot.id} slot={slot} index={i}
                        isActive={isSweeping} isOutOfKey={isOutOfKey}
                        isExpanded={expandedId === slot.id}
                        sweepKey={isSweeping ? sweepState!.key : 0}
                        sweepDuration={isSweeping ? sweepState!.durationMs : 0}
                        fadeKey={isFading ? fadeState!.key : 0} isFading={isFading}
                        onPreview={() => previewSlot(slot)}
                        onRemove={() => removeChord(slot.id)}
                        onToggleExpand={() => toggleExpand(slot.id)}
                      />
                    );
                  })}
                </div>
              </SortableContext>

              {/* Floating drag overlay — prevents distortion on variable-height items */}
              <DragOverlay dropAnimation={null}>
                {draggingId ? (() => {
                  const slot = chords.find(c => c.id === draggingId);
                  return slot ? (
                    <div className="flex items-center gap-2 rounded-xl border-2 border-indigo-300 bg-white px-3 py-2 shadow-xl opacity-95">
                      <div className="flex h-6 w-4 shrink-0 cursor-grabbing flex-col items-center justify-center gap-0.5 text-stone-300">
                        <div className="h-0.5 w-3 rounded-full bg-current" />
                        <div className="h-0.5 w-3 rounded-full bg-current" />
                        <div className="h-0.5 w-3 rounded-full bg-current" />
                      </div>
                      <span className="flex-1 text-sm font-semibold text-stone-800">{slot.chord}</span>
                    </div>
                  ) : null;
                })() : null}
              </DragOverlay>
            </DndContext>
          )}

          {/* Roll again — only visible after a dice roll */}
          {isRolled && chords.length > 0 && (
            <div className="mt-2 text-center">
              <button
                onClick={rollDice}
                className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-500 hover:bg-indigo-100 hover:text-indigo-600 active:scale-95 transition-all"
              >
                improvise
              </button>
            </div>
          )}
        </div>
        <div className="h-2" />
      </main>

      <footer className="relative shrink-0 border-t border-stone-200 bg-white px-4 pt-2 pb-5">
        {/* Copied-to-clipboard toast — floats above the chord picker, no layout shift */}
        {copiedToast && (
          <div className="absolute bottom-full left-4 right-4 mb-3 z-50 rounded-2xl bg-emerald-600/80 px-5 py-3 text-center text-sm font-semibold text-white pointer-events-none">
            Link copied to clipboard
          </div>
        )}

        {/* Category pills — single scrollable row so they never wrap */}
        <div className="-mx-4 px-4 mb-1.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleCategories.map(({ label }) => (
            <button key={label} onClick={() => setActiveCategory(label)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                activeCategory === label ? 'bg-indigo-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Chord grid */}
        <div className="mb-2 flex flex-wrap gap-1">
          {(visibleCategories.find(c => c.label === activeCategory)?.chords ?? []).map(chord => (
            <button key={chord} onClick={() => addChord(chord)}
              className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-sm font-semibold text-stone-700 hover:bg-indigo-100 hover:text-indigo-700 active:scale-95 transition-transform">
              {chord}
            </button>
          ))}
        </div>

        {/* Action buttons — all always visible; disabled until chords exist */}
        <div className="flex gap-1.5">
          {/* Settings */}
          <button
            onClick={() => setSettingsOpen(s => !s)}
            disabled={chords.length === 0}
            aria-label="Settings"
            title="Settings"
            className={`flex items-center justify-center rounded-xl px-3 py-3 transition-colors border ${
              chords.length === 0
                ? 'border-stone-200 bg-white text-stone-200 cursor-not-allowed'
                : settingsOpen
                ? 'border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700'
                : 'border-stone-300 bg-white text-stone-400 hover:bg-stone-50 hover:text-stone-600'
            }`}
          >
            <GearIcon size={16} />
          </button>

          {/* Loop toggle */}
          <button
            onClick={() => setLooping(l => !l)}
            disabled={chords.length === 0}
            aria-label={looping ? 'Disable loop' : 'Enable loop'}
            title={looping ? 'Loop on' : 'Loop off'}
            className={`flex items-center justify-center rounded-xl px-3 py-3 transition-colors border ${
              chords.length === 0
                ? 'border-stone-200 bg-white text-stone-200 cursor-not-allowed'
                : looping
                ? 'border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700'
                : 'border-stone-300 bg-white text-stone-400 hover:bg-stone-50 hover:text-stone-600'
            }`}
          >
            <LoopIcon size={16} />
          </button>

          {/* Preview / Stop — primary style */}
          <button
            onClick={playing ? stopPlayback : startPlayback}
            disabled={chords.length === 0}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
              chords.length === 0
                ? 'bg-indigo-200 text-white cursor-not-allowed'
                : playing
                ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}>
            {playing ? <><StopIcon size={13} /> Stop</> : <><PlayIcon size={13} /> Preview</>}
          </button>

          {/* Save */}
          <button
            onClick={saveToLibrary}
            disabled={chords.length === 0 || saveStatus === 'saving'}
            className={`flex items-center justify-center rounded-xl border px-3 py-3 transition-colors ${
              chords.length === 0
                ? 'border-stone-200 bg-white text-stone-200 cursor-not-allowed'
                : 'border-stone-300 bg-white text-stone-500 hover:bg-stone-50 disabled:opacity-50'
            }`}>
            {saveStatus === 'saved'
              ? <span className="text-emerald-600 font-bold text-xs">✓</span>
              : saveStatus === 'saving'
              ? <SpinnerIcon size={13} />
              : <SaveIcon size={14} />}
          </button>

          {/* Share — icon only, secondary style */}
          <button
            onClick={share}
            disabled={chords.length === 0}
            aria-label="Share"
            title="Share"
            className={`flex items-center justify-center rounded-xl border px-3 py-3 transition-colors ${
              chords.length === 0
                ? 'border-stone-200 bg-white text-stone-200 cursor-not-allowed'
                : 'border-stone-300 bg-white text-stone-500 hover:bg-stone-50 hover:text-stone-700'
            }`}>
            <ShareIcon size={15} />
          </button>
        </div>

      </footer>

      {importOpen && (
        <ImportSheet
          onClose={() => setImportOpen(false)}
          onApply={handleImportApply}
          onPreviewChord={play}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          onClose={() => setSettingsOpen(false)}
          sound={sound} setSound={setSound}
          metronome={metronome} setMetronome={setMetronome}
          timeSigBeats={timeSigBeats} setTimeSigBeats={setTimeSigBeats}
          playing={playing}
          startMetronome={startMetronome}
          stopMetronome={stopMetronome}
        />
      )}

      {libraryOpen && (
        <LibraryDrawer
          onClose={() => setLibraryOpen(false)}
          onLoad={loadFromLibrary}
        />
      )}

    </div>
  );
}

'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { playChordWithSound } from '@/lib/audio';
import type { Progression } from '@/lib/types';

function PlayIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden><polygon points="2,1 11,6 2,11" /></svg>;
}
function StopIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>;
}
function RemixIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export default function ProgressionPlayer({
  progression,
  detectedKey,
}: {
  progression: Progression;
  detectedKey: string | null;
}) {
  const [playing,   setPlaying]   = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef   = useRef(0);

  const bpm     = progression.bpm     ?? 80;
  const timeSig = progression.timeSig ?? 4;
  const msDur   = (60 / bpm) * timeSig * 1000;

  const stopPlayback = useCallback(() => {
    genRef.current++;
    clearTimeout(timerRef.current!);
    timerRef.current = null;
    setPlaying(false);
    setActiveIdx(null);
  }, []);

  function startPlayback() {
    const chords = progression.chords;
    if (!chords.length) return;
    const gen = ++genRef.current;
    setPlaying(true);
    let i = 0;
    function step() {
      if (genRef.current !== gen) return;
      if (i >= chords.length) { setPlaying(false); setActiveIdx(null); return; }
      setActiveIdx(i);
      playChordWithSound(chords[i].chord, 'acoustic-guitar', msDur / 1000 + 0.5);
      i++;
      timerRef.current = setTimeout(step, msDur);
    }
    step();
  }

  function remix() {
    const params = new URLSearchParams({
      title:   progression.title,
      chords:  progression.chords.map(c => c.chord).join(','),
      bpm:     String(bpm),
      timeSig: String(timeSig),
    });
    window.location.href = `/?${params.toString()}`;
  }

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-lg">

        {/* Title + meta */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-stone-900">{progression.title}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-stone-400">
            {detectedKey && <span>Key of {detectedKey}</span>}
            <span>{bpm} BPM</span>
            <span>{timeSig}/4</span>
          </div>
        </div>

        {/* Chord grid */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {progression.chords.map((slot, i) => (
            <div
              key={slot.id}
              onClick={() => playChordWithSound(slot.chord, 'acoustic-guitar', 2)}
              className={`flex flex-col items-center justify-center rounded-2xl border py-5 shadow-sm cursor-pointer transition-colors ${
                activeIdx === i
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-stone-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/50'
              }`}
            >
              <span className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-300">
                {i + 1}
              </span>
              <span className={`text-2xl font-bold ${activeIdx === i ? 'text-indigo-600' : 'text-stone-900'}`}>
                {slot.chord}
              </span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-8">
          {/* Play / Stop — primary */}
          <button
            onClick={playing ? stopPlayback : startPlayback}
            className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold transition-colors ${
              playing
                ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {playing ? <><StopIcon /> Stop</> : <><PlayIcon /> Play</>}
          </button>

          {/* Remix — secondary */}
          <button
            onClick={remix}
            className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-5 py-4 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
          >
            <RemixIcon size={14} /> Remix
          </button>
        </div>

        {/* Create your own */}
        <div className="text-center">
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            Create your own →
          </Link>
        </div>
      </div>
    </div>
  );
}

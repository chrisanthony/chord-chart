import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { saveProgression } from '@/lib/store';
import type { Progression } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { title, chords, bpm, timeSig } = await req.json();

  if (!title || !Array.isArray(chords) || chords.length === 0) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const id = randomBytes(6).toString('base64url');
  const progression: Progression = {
    id,
    title: String(title).slice(0, 200),
    chords: chords.slice(0, 64).map((c: { id: string; chord: string }) => ({
      id: c.id,
      chord: String(c.chord).slice(0, 20),
    })),
    bpm:     typeof bpm === 'number' ? Math.round(Math.min(220, Math.max(40, bpm))) : 80,
    timeSig: [2, 3, 4, 5].includes(timeSig) ? timeSig : 4,
    createdAt: new Date().toISOString(),
  };

  await saveProgression(progression);
  return NextResponse.json({ id });
}

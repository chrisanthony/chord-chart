import { getProgression } from '@/lib/store';
import { detectKey } from '@/lib/music';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ProgressionPlayer from './ProgressionPlayer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const progression = await getProgression(id);
  if (!progression) return { title: 'Chord Chart' };
  return {
    title: progression.title,
    openGraph: {
      title: progression.title,
      description: `${progression.chords.map(c => c.chord).join(' · ')} — ${progression.bpm} BPM`,
    },
  };
}

export default async function ViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const progression = await getProgression(id);
  if (!progression) notFound();

  const key = detectKey(progression.chords);

  return (
    <ProgressionPlayer
      progression={progression}
      detectedKey={key}
    />
  );
}

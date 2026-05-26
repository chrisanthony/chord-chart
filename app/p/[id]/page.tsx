import { getProgression } from '@/lib/store';
import { detectKey } from '@/lib/music';
import { notFound } from 'next/navigation';
import ProgressionPlayer from './ProgressionPlayer';

export const dynamic = 'force-dynamic';

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

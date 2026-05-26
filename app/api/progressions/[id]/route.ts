import { NextRequest, NextResponse } from 'next/server';
import { getProgression } from '@/lib/store';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const progression = await getProgression(id);
  if (!progression) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(progression);
}

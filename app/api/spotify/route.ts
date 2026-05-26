import { NextRequest, NextResponse } from 'next/server';

// Spotify pitch-class encoding matches NOTE_NAMES (C=0 … B=11)
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

async function getToken(): Promise<string> {
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Spotify token error ${res.status}`);
  const { access_token } = await res.json() as { access_token: string };
  return access_token;
}

function extractTrackId(url: string): string | null {
  const m = url.match(/track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url  = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

    const trackId = extractTrackId(url);
    if (!trackId) return NextResponse.json({ error: 'Invalid Spotify track URL' }, { status: 400 });

    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'Spotify is not configured on this server (missing credentials)' },
        { status: 503 },
      );
    }

    const token = await getToken();

    const featRes = await fetch(
      `https://api.spotify.com/v1/audio-features/${trackId}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );

    if (featRes.status === 403 || featRes.status === 401) {
      return NextResponse.json(
        {
          error:
            'Spotify audio-features API is restricted for this app. ' +
            'Apps registered after November 2024 no longer have access to audio-features.',
        },
        { status: 403 },
      );
    }
    if (!featRes.ok) throw new Error(`Spotify audio-features error ${featRes.status}`);

    const features = await featRes.json() as {
      key: number; mode: number; tempo: number
    };

    if (features.key === -1) {
      return NextResponse.json({ error: 'Spotify could not determine the key for this track' }, { status: 422 });
    }

    const note = NOTE_NAMES[features.key];
    const mode = features.mode === 1 ? 'major' : 'minor';
    const bpm  = Math.max(40, Math.min(220, Math.round(features.tempo)));

    return NextResponse.json({ key: `${note} ${mode}`, bpm });
  } catch (err) {
    console.error('[api/spotify]', err);
    return NextResponse.json({ error: 'Spotify lookup failed' }, { status: 500 });
  }
}

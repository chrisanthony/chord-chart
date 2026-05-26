import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const exec = promisify(execFile);

// Common install locations for yt-dlp installed via pip3 --user on macOS
const YTDLP_CANDIDATES = [
  '/Users/chris/Library/Python/3.9/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/opt/homebrew/bin/yt-dlp',
  `${process.env.HOME}/.local/bin/yt-dlp`,
  'yt-dlp',
];

async function findYtDlp(): Promise<string> {
  for (const bin of YTDLP_CANDIDATES) {
    try { await exec(bin, ['--version']); return bin; } catch { continue; }
  }
  throw new Error('yt-dlp not found');
}

function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts)|youtu\.be\/)/.test(url);
}

// Extensions yt-dlp might produce
const AUDIO_EXTS = ['m4a', 'webm', 'opus', 'ogg', 'mp3', 'mp4'];

const MIME: Record<string, string> = {
  m4a: 'audio/mp4', webm: 'audio/webm',
  opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg',
  mp4: 'video/mp4', // combined stream — AudioContext decodes audio track fine
};

export async function POST(req: NextRequest) {
  let audioFile: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const url  = typeof body.url === 'string' ? body.url.trim() : '';

    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
    if (!isYouTubeUrl(url))
      return NextResponse.json({ error: 'Please paste a YouTube URL (youtube.com or youtu.be)' }, { status: 400 });

    // Find yt-dlp
    let ytdlp: string;
    try { ytdlp = await findYtDlp(); }
    catch {
      return NextResponse.json(
        { error: 'yt-dlp is not installed. Run: pip3 install yt-dlp' },
        { status: 503 },
      );
    }

    const uuid     = randomUUID();
    const template = join(tmpdir(), `cc-${uuid}.%(ext)s`);

    // Browser cookies let yt-dlp bypass YouTube's bot detection and age/region gates.
    // Try Safari first (common on macOS), fall back to Chrome, then no cookies.
    const cookieArgs: string[][] = [
      ['--cookies-from-browser', 'safari'],
      ['--cookies-from-browser', 'chrome'],
      [], // no cookies — last resort
    ];

    async function ytdlpRun(extraArgs: string[], args: string[]): Promise<void> {
      await exec(ytdlp, [...extraArgs, ...args], { timeout: 120_000 });
    }

    const baseDownloadArgs = [
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      // Use the Android player client — it bypasses YouTube's bot-detection 403s
      // that the default web client triggers, especially on freshly-released videos.
      '--extractor-args', 'youtube:player_client=android',
      // Prefer low-bitrate audio-only — plenty for key/BPM detection, keeps files small.
      // abr <= 128 kbps: a 4-min song ~ 4 MB.
      // Format 18 (360p combined mp4) is the universal fallback — always available
      // without auth; AudioContext.decodeAudioData decodes the AAC audio track fine.
      '-f', 'bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]/bestaudio[ext=webm][abr<=128]/bestaudio[ext=webm]/bestaudio[abr<=192]/bestaudio/18',
      '-o', template,
      url,
    ];

    const baseTitleArgs = [
      '--print', 'title', '--no-playlist', '--no-warnings', '--skip-download',
      '--extractor-args', 'youtube:player_client=android',
      url,
    ];

    // ── Fetch title (fast, no download) ──────────────────────────────────────
    let title: string | undefined;
    for (const cookieArg of cookieArgs) {
      try {
        const { stdout } = await exec(ytdlp, [...cookieArg, ...baseTitleArgs], { timeout: 15_000 });
        title = stdout.trim() || undefined;
        break;
      } catch { continue; }
    }

    // ── Download audio-only stream ────────────────────────────────────────────
    // Prefer m4a (AAC) then webm/opus — both decode natively in modern browsers.
    // Try each cookie strategy until one succeeds.
    let downloadErr: unknown;
    let downloaded = false;
    for (const cookieArg of cookieArgs) {
      try {
        await ytdlpRun(cookieArg, baseDownloadArgs);
        downloaded = true;
        break;
      } catch (err) {
        downloadErr = err;
        const msg = String(err);
        // Stop retrying only if the video itself is unavailable — not format/permission errors.
        // "Requested format is not available" must NOT break here (different cookies → different
        // format catalogue; the no-cookies + android-client attempt may still succeed).
        if (/Video unavailable|private video|This video is not available/i.test(msg)) break;
        // All other errors (format missing, permissions, bot-detection) → try next cookie method
      }
    }

    if (!downloaded) {
      const msg = String(downloadErr);
      if (/Video unavailable|private video|This video is not available/i.test(msg))
        return NextResponse.json({ error: 'This video is private or unavailable' }, { status: 422 });
      if (/not permitted|permission|errno 1/i.test(msg))
        return NextResponse.json({
          error: 'macOS blocked access to browser cookies. Go to System Settings → Privacy & Security → Full Disk Access and add Terminal, then try again.',
        }, { status: 403 });
      if (/sign.?in|bot|confirm|age/i.test(msg))
        return NextResponse.json({
          error: 'YouTube is blocking the download. Try granting Terminal Full Disk Access in System Settings → Privacy & Security.',
        }, { status: 403 });
      throw downloadErr;
    }

    // Find the output file (extension varies by what YouTube served)
    const ext = AUDIO_EXTS.find(e => {
      const p = join(tmpdir(), `cc-${uuid}.${e}`);
      if (existsSync(p)) { audioFile = p; return true; }
      return false;
    });

    if (!audioFile || !ext)
      return NextResponse.json({ error: 'Download succeeded but output file not found' }, { status: 500 });

    const bytes = await readFile(audioFile);

    return new NextResponse(bytes, {
      headers: {
        'Content-Type':   MIME[ext] ?? 'audio/mpeg',
        'Content-Length': bytes.length.toString(),
        // URI-encode so non-ASCII titles survive HTTP headers
        'X-Song-Title':   encodeURIComponent(title ?? ''),
      },
    });

  } catch (err) {
    console.error('[api/youtube]', err);
    return NextResponse.json({ error: 'YouTube download failed' }, { status: 500 });
  } finally {
    // Always clean up the temp file
    if (audioFile) await unlink(audioFile).catch(() => {});
  }
}

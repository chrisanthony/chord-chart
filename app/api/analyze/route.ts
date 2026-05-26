import { NextRequest, NextResponse } from 'next/server';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const PROMPT = `Listen to this audio and identify the chord structure by section.
Focus on the harmonic accompaniment — rhythm guitar, chord pads, piano harmony, and bass line.
Ignore lead melodies, vocal lines, solos, and individually picked notes.
The output should reflect the underlying chord progression, not melodic content.
Return ONLY a JSON object (no markdown, no extra text) with this shape:
{
  "sections": [
    { "name": "Verse",  "chords": ["G", "Em", "C", "D"] },
    { "name": "Chorus", "chords": ["C", "G", "Am", "F"] }
  ],
  "key": "G major",
  "bpm": 120
}
Rules:
- sections: identify 1–4 distinct parts of the song.
  Common names: Verse, Chorus, Bridge, Intro, Outro, Pre-Chorus.
  If one chord pattern repeats throughout, use a single section named "Main".
- chords per section: 2–8 chord names forming that section's repeating loop.
  Standard notation: C (major), Cm (minor), C7 (dominant 7), Cmaj7, Cm7.
- key: "NoteName major|minor", e.g. "G major" or "B minor".
- bpm: integer tempo estimate.
- Always make a best-guess — never return empty arrays.`;

interface GeminiSection { name?: unknown; chords?: unknown; }

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'AI chord detection is not configured (no GEMINI_API_KEY)' },
      { status: 503 },
    );
  }

  try {
    const formData = await req.formData();
    const file     = formData.get('audio') as File | null;
    if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

    const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — Gemini inline-data limit
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File too large for AI analysis (max 20 MB).' },
        { status: 413 },
      );
    }

    const bytes    = await file.arrayBuffer();
    const base64   = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'audio/wav';

    const payload = {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: PROMPT },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
    };

    const geminiRes = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!geminiRes.ok) {
      const txt = await geminiRes.text();
      console.error('[api/analyze] Gemini error', geminiRes.status, txt);
      throw new Error(`Gemini error ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    };
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Extract JSON from the response (Gemini sometimes wraps in ```json)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Gemini response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      sections?: GeminiSection[];
      chords?:   unknown;
      key?:      unknown;
      bpm?:      unknown;
    };

    // Validate and normalise sections
    const sections: Array<{ name: string; chords: string[] }> = [];
    if (Array.isArray(parsed.sections)) {
      for (const s of parsed.sections) {
        const name   = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Section';
        const chords = Array.isArray(s.chords)
          ? (s.chords as unknown[]).filter((c): c is string => typeof c === 'string')
          : [];
        if (chords.length > 0) sections.push({ name, chords });
      }
    }

    // Backward-compat flat chords: first section's chords (or legacy flat response)
    const flatChords: string[] = sections[0]?.chords
      ?? (Array.isArray(parsed.chords) ? (parsed.chords as string[]) : []);

    return NextResponse.json({
      sections,
      chords: flatChords,
      key:    typeof parsed.key === 'string' ? parsed.key : undefined,
      bpm:    typeof parsed.bpm === 'number' ? parsed.bpm : undefined,
    });
  } catch (err) {
    console.error('[api/analyze]', err);
    return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
  }
}

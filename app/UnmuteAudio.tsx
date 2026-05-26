'use client';

import { useEffect } from 'react';

/**
 * iOS < 16.4 fallback: forces the audio session to the media channel by
 * playing a short looping silent <audio> element on the first user gesture.
 *
 * iOS 16.4+ is handled by navigator.audioSession.type = 'playback' in audio.ts.
 *
 * Requirements for the audio-session-routing trick to work on older iOS:
 *  • The WAV must contain real sample data (not a zero-length data chunk)
 *  • volume must be > 0 (even 0.001 is completely inaudible but "counts")
 *  • The element should keep playing (loop: true) so the session stays active
 *
 * The previous implementation used feross/unmute-ios-audio which plays a
 * zero-length WAV at volume 0 — iOS does not recognise this as real media,
 * so the audio session never moved to the media channel.
 */
function buildSilentWAV(): string {
  const SR = 8000, SECS = 1, samples = SR * SECS;
  const buf = new Uint8Array(44 + samples);
  const dv  = new DataView(buf.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');  dv.setUint32(4, buf.length - 8, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); // PCM chunk size
  dv.setUint16(20, 1,  true); // PCM format
  dv.setUint16(22, 1,  true); // mono
  dv.setUint32(24, SR, true); // sample rate
  dv.setUint32(28, SR, true); // byte rate (8-bit mono = SR bytes/sec)
  dv.setUint16(32, 1,  true); // block align
  dv.setUint16(34, 8,  true); // bits per sample
  str(36, 'data'); dv.setUint32(40, samples, true);
  // 8-bit unsigned PCM: silence = 128 (midpoint of 0–255). Zero is max-negative
  // amplitude and causes an audible click at every loop boundary.
  buf.fill(128, 44);
  let bin = '';
  buf.forEach(b => (bin += String.fromCharCode(b)));
  return 'data:audio/wav;base64,' + btoa(bin);
}

export default function UnmuteAudio() {
  useEffect(() => {
    const src   = buildSilentWAV();
    const audio = Object.assign(new Audio(), { src, loop: true, volume: 0.001 });
    const play  = () => audio.play().catch(() => {});
    document.addEventListener('touchstart', play, { once: true });
    document.addEventListener('click',      play, { once: true });
    return () => {
      document.removeEventListener('touchstart', play);
      document.removeEventListener('click',      play);
      audio.pause();
    };
  }, []);
  return null;
}

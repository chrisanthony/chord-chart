'use client';

import { useEffect } from 'react';

/**
 * Fixes iOS Web Audio mute switch behaviour.
 *
 * Web Audio API is routed to iOS's "ringer" channel by default, which is
 * silenced by the physical mute/silent switch. This component plays a silent
 * <audio> element on the first user gesture, which forces iOS to move the
 * entire page audio session onto the "media" channel. Once there, the mute
 * switch no longer affects Web Audio output.
 *
 * Uses the unmute-ios-audio library (MIT, by Feross Aboukhadijeh).
 */
export default function UnmuteAudio() {
  useEffect(() => {
    import('unmute-ios-audio').then(m => {
      const unmute = m.default ?? m;
      if (typeof unmute === 'function') unmute();
    }).catch(() => {});
  }, []);

  return null;
}

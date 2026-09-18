// ═══════════════════════════════════════════════════════════════════════════
// Vesper WebUI — Notification Sound Hook (Web Audio API)
//
// Synthesises short "ding" notification sounds using the Web Audio API.
// Zero external dependencies — no audio files required.
//
// Two distinct tones:
//   "complete" — a warm single ding (task finished)
//   "attention" — a brighter three-note alert (permission / question)
//
// Always plays (foreground & background) — the user may have the page open
// but be away from the computer.
//
// Respects:
//   - localStorage "lux:sound-enabled" toggle (default: true)
//
// Usage:
//   const playSound = useNotificationSound();
//   playSound('complete');
//   playSound('attention');
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useRef } from 'react';

const STORAGE_KEY = 'lux:sound-enabled';

/** Check localStorage preference. Defaults to true. */
function isSoundEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v !== 'false';
  } catch {
    return true;
  }
}

/** Toggle sound on/off globally. Returns the new state. */
export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* noop */ }
  return next;
}

export function getSoundEnabled(): boolean {
  return isSoundEnabled();
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------

type SoundType = 'complete' | 'attention';

/**
 * Play a single "ding" — a sine tone with a hint of harmonics for warmth.
 * The brief attack + exponential decay gives the classic bell/ding character.
 */
function playDing(ctx: AudioContext, freq: number, time: number, volume = 0.22): void {
  const dur = 0.35;

  // Fundamental (sine)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  gain1.gain.setValueAtTime(volume, time);
  gain1.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc1.connect(gain1).connect(ctx.destination);
  osc1.start(time);
  osc1.stop(time + dur + 0.02);

  // Soft harmonic (2×freq, lower volume) for bell-like shimmer
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  gain2.gain.setValueAtTime(volume * 0.3, time);
  gain2.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.6);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start(time);
  osc2.stop(time + dur + 0.02);
}

/**
 * "complete" — a single warm ding at A5 (880 Hz).
 */
function playComplete(ctx: AudioContext): void {
  playDing(ctx, 880, ctx.currentTime);
}

/**
 * "attention" — a brighter three-note alert.
 * E5 → G5 → B5, triangle wave, slightly faster and more urgent.
 */
function playAttention(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const notes: Array<[freq: number, start: number, dur: number]> = [
    [659.25, now, 0.09],         // E5
    [783.99, now + 0.10, 0.09],  // G5
    [987.77, now + 0.20, 0.14],  // B5
  ];
  for (const [freq, start, dur] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.20, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.01);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns a `playSound(type)` function.
 *
 * AudioContext is created lazily on first call (browsers require a user
 * gesture before creating one, but by the time an agent finishes running
 * the user will have interacted with the page).
 */
export function useNotificationSound(): (type: SoundType) => void {
  const ctxRef = useRef<AudioContext | null>(null);

  const playSound = useCallback((type: SoundType) => {
    // Respect user preference
    if (!isSoundEnabled()) return;

    // Lazy-init AudioContext
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return; // AudioContext not available (e.g. very old browser)
      }
    }
    const ctx = ctxRef.current;

    // Resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    switch (type) {
      case 'complete':
        playComplete(ctx);
        break;
      case 'attention':
        playAttention(ctx);
        break;
    }
  }, []);

  return playSound;
}

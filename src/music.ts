/**
 * music.ts — the beat clock.
 *
 * This module only answers "where are we in the music"; what the model does
 * about it lives in animation.ts, which is the part that knows the rig. The
 * clock keeps running whenever media is playing, even while the assistant has
 * taken over the model, so returning to Dancing rejoins the track in time
 * instead of restarting the bar.
 */

export interface Beat {
  /** Monotonic beat count — 12.37 is a third of the way through beat 12. */
  beats: number;
  /** 0..1 envelope: sharp attack on the beat, exponential decay after it. */
  intensity: number;
  /** Current tempo, so choreography can scale itself to the track. */
  bpm: number;
}

export interface MusicHandles {
  isPlaying: boolean;
  setBpm(value: number): void;
  setPlaying(val: boolean): void;
  update(dt: number): void;
  readonly beat: Beat;
}

export function initMusic(): MusicHandles {
  let bpm = 120;
  let beats = 0;
  let isPlaying = false;
  const beat: Beat = { beats: 0, intensity: 0, bpm };

  return {
    get isPlaying() { return isPlaying; },
    get beat() { return beat; },

    setBpm(value: number) {
      if (value > 0 && value <= 300) bpm = value;
    },

    setPlaying(val: boolean) {
      isPlaying = val;
    },

    update(dt: number) {
      if (isPlaying) beats += dt * (bpm / 60);

      const phase = beats - Math.floor(beats);
      beat.beats = beats;
      beat.bpm = bpm;
      // Sharp attack over the first tenth of the beat, then an exponential tail.
      beat.intensity = !isPlaying ? 0
        : phase < 0.1 ? phase / 0.1
        : Math.exp(-(phase - 0.1) * 4);
    },
  };
}

/**
 * Parse a BPM entity's value. Handles a raw number, "128 bpm", and a 0-1
 * fraction, which some audio integrations report instead of a tempo.
 */
export function parseBpmEntityValue(raw: string | number | undefined): number {
  if (raw === undefined) return 120;
  if (typeof raw === 'number') return Math.max(60, Math.min(300, raw));

  const str = raw.toString().trim().toLowerCase();
  const num = parseFloat(str);
  if (!isNaN(num)) {
    if (num > 0 && num <= 1) return Math.round(60 + num * 120);
    return Math.max(60, Math.min(300, num));
  }

  const match = str.match(/(\d+)/);
  if (match) return Math.max(60, Math.min(300, parseInt(match[1], 10)));

  return 120;
}

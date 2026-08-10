/**
 * states.ts — maps HA entity states onto GLaDOS animation states.
 *
 * The keyword sets and precedence mirror the 2D reference card
 * (Axildor/GLaDOS-AI-Animation): the voice assistant wins outright, and media
 * playback only takes over when the assistant has nothing to say.
 */

import { GladosState } from './types.js';

/** Map a voice assistant entity state onto an animation state. */
export function mapVoiceState(rawState: string): GladosState {
  const state = rawState.toLowerCase().trim();

  if (state.includes('respond') || state.includes('speak') || state.includes('tts')) {
    return 'speaking';
  }
  if (state.includes('listen') || state.includes('wake')) {
    return 'active-listening';
  }
  if (state.includes('process') || state.includes('think')) {
    return 'computing';
  }
  return 'standby';
}

/** Only actual playback counts — paused media leaves GLaDOS idle. */
export function isMediaPlaying(mediaEntityState: string | undefined): boolean {
  return (mediaEntityState || '').toLowerCase().trim() === 'playing';
}

/**
 * Effective animation state for a voice + media entity pair. Music only reaches
 * the model when the assistant is idle, so a reply always interrupts the dance.
 */
export function determineState(
  voiceState: string | undefined,
  mediaState: string | undefined
): GladosState {
  const mapped = mapVoiceState(voiceState || '');
  if (mapped !== 'standby') return mapped;
  return isMediaPlaying(mediaState) ? 'dancing' : 'standby';
}

import { LovelaceCardConfig } from 'custom-card-helpers';

export interface Glados3DConfig extends LovelaceCardConfig {
  type: 'custom:glados-3d-card';
  entity: string;
  media_entity?: string;
  bpm_entity?: string;
  /** Framing multiplier — >1 moves the camera in, <1 pulls it back. */
  zoom?: number;
  model_url?: string;
  bg_color?: string;
  /** Drop the background and the card's own chrome, so the model sits directly
   *  on the dashboard. Overrides `bg_color`. */
  transparent_bg?: boolean;
  /** The state readout in the corner — the pulsing dot and its label. */
  show_status?: boolean;
  /** Camera orbit around the model, in degrees. */
  yaw?: number;
  pitch?: number;
  /** Slide the framing across the frame, in units of the model radius. */
  pan_x?: number;
  pan_y?: number;
  /** Eye bloom strength; 0 disables post-processing entirely. */
  bloom?: number;
  /** Frame rate cap. 0 renders on every animation frame, which on a 120 Hz
   *  phone is twice the work this animation needs. */
  max_fps?: number;
  /** Card width:height, used to give the canvas a height inside Lovelace. */
  aspect_ratio?: number;
  /** Choreography used while Dancing — a pinned move, or `auto` for the routine. */
  dance_style?: DanceStyle;
}

/** One choreography preset. */
export type DanceMove =
  | 'sway'      // travelling wave, the body following the head
  | 'bounce'    // vertical bounce with squash and stretch
  | 'headbang'  // sharp head flex on the downbeat
  | 'wave';     // domino ripple running down the chain

/** What `dance_style` accepts: one move held forever, or the routine that cuts
 *  between all of them on the music's phrase boundaries. */
export type DanceStyle = DanceMove | 'auto';

export type GladosState =
  | 'standby'           // idle
  | 'active-listening'  // listening
  | 'computing'         // processing
  | 'speaking'          // responding
  | 'dancing';          // media playing while the assistant is idle

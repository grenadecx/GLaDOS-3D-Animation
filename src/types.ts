import { LovelaceCardConfig } from 'custom-card-helpers';

export interface Glados3DConfig extends LovelaceCardConfig {
  type: 'glados-3d-card';
  entity: string;
  media_entity?: string;
  bpm_entity?: string;
  /** Framing multiplier — >1 moves the camera in, <1 pulls it back. */
  zoom?: number;
  model_url?: string;
  bg_color?: string;
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
  /** Portal rings during speaking/computing. Off by default. */
  portals?: boolean;
}

export type GladosState =
  | 'standby'           // idle
  | 'active-listening'  // listening
  | 'computing'         // processing
  | 'speaking'          // responding
  | 'dancing';          // media playing while the assistant is idle

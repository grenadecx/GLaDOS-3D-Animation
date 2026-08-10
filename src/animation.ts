/**
 * animation.ts — state-driven procedural animation for the GLaDOS rig.
 *
 * The model ships with baked armature clips, but they are full-body dramatic
 * swings that leave the card's framing entirely, so the card poses the bones
 * itself. Offsets are expressed in world space and converted into each bone's
 * parent space, which keeps the numbers readable regardless of how the original
 * rig oriented any given bone.
 *
 * The eye colours are lifted verbatim from the 2D reference card
 * (Axildor/GLaDOS-AI-Animation): amber idle, blue listening, orange processing,
 * red responding, green dancing — each a radial gradient with a white-hot core,
 * repainted into the lens texture as states blend.
 */

import * as THREE from 'three';
import { GladosState } from './types.js';
import { Beat } from './music.js';
import { GladosRig, EYE_TEXTURE_SIZE, EYE_UV_RADIUS } from './model.js';

export interface AnimationHandles {
  update(dt: number, state: GladosState, beat: Beat): void;
  apply(rig: GladosRig): void;
}

/** Radial gradient stops for the lens, `[offset, rgb]`, from the reference card. */
type Stop = [number, number];
type Gradient = Stop[];

const GRADIENTS: Record<GladosState, Gradient> = {
  'standby':          [[0, 0xffffff], [0.20, 0xffcc00], [0.55, 0xd95500], [0.80, 0x7a1100], [1, 0x110000]],
  'active-listening': [[0, 0xffffff], [0.25, 0xaaffff], [0.60, 0x00ccff], [0.85, 0x0066aa], [1, 0x001a33]],
  'computing':        [[0, 0xffffff], [0.25, 0xffddaa], [0.60, 0xff6600], [0.85, 0xaa3300], [1, 0x220a00]],
  'speaking':         [[0, 0xffffff], [0.25, 0xffaaaa], [0.60, 0xff2200], [0.85, 0xaa0000], [1, 0x220000]],
  'dancing':          [[0, 0xffffff], [0.20, 0xaaffaa], [0.55, 0x1db954], [0.80, 0x0a5926], [1, 0x001a00]],
};

/** Halo colour the eye spills onto its own housing — the reference's LED colour. */
const HALO: Record<GladosState, number> = {
  'standby': 0xffb800,
  'active-listening': 0x00ccff,
  'computing': 0xff6600,
  'speaking': 0xff2200,
  'dancing': 0x1db954,
};

/**
 * Per-state eye intensities are deliberately uneven. Bloom keys off luminance,
 * and these hues are nowhere near equal on that axis — pure red carries about a
 * fifth the luminance of the cyan at the same nominal brightness. Feeding them
 * all the same number makes red and orange read as a dim pinprick next to blue,
 * so the low-luminance hues are pushed up to land in the same visual ballpark.
 */
interface Pose {
  /** World-space rotation offsets, radians. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  spinePitch: number;
  spineYaw: number;
  eyeIntensity: number;
}

const POSES: Record<GladosState, Pose> = {
  'standby': {
    headPitch: 0, headYaw: 0, headRoll: 0,
    neckPitch: 0, spinePitch: 0, spineYaw: 0,
    eyeIntensity: 3.6,   // amber
  },
  'active-listening': {
    headPitch: 0.14, headYaw: -0.10, headRoll: 0.12,
    neckPitch: -0.06, spinePitch: 0.05, spineYaw: -0.04,
    eyeIntensity: 4.0,   // cyan — the brightest hue, needs no help
  },
  'computing': {
    headPitch: -0.16, headYaw: 0.06, headRoll: -0.05,
    neckPitch: 0.08, spinePitch: -0.06, spineYaw: 0.03,
    eyeIntensity: 5.0,   // orange
  },
  'speaking': {
    headPitch: 0.05, headYaw: 0.02, headRoll: 0,
    neckPitch: -0.03, spinePitch: 0.02, spineYaw: 0,
    eyeIntensity: 6.0,   // red — lowest luminance of the five
  },
  'dancing': {
    headPitch: 0.02, headYaw: 0, headRoll: 0,
    neckPitch: 0.02, spinePitch: 0.03, spineYaw: 0,
    eyeIntensity: 4.4,   // green
  },
};

const TRANSITION_SPEED = 2.5;
/** Repaint the lens at most this many times across a transition. */
const GRADIENT_STEPS = 12;
/** How fast the dance layer fades in and out when Dancing starts or is interrupted. */
const DANCE_FADE_SPEED = 4;

/**
 * The dance is a travelling wave rather than a single wobble, and it runs from
 * the head outward: the head leads, and each segment back toward the ceiling
 * mount repeats the motion slightly later, so the body follows the head instead
 * of whipping it around.
 *
 * The head therefore turns barely at all on its own. It sits at the end of a long
 * chain and already inherits every ancestor's rotation, so giving it a large
 * offset of its own on top is what made it look like it was flicking about
 * independently. Nearly all the visible travel comes from the body carrying it.
 */
const DANCE_LAG = 0.38;      // beats the body trails the head by
/** Side-to-side swing, radians — the body's own, and the head's own. */
const DANCE_SWAY_BODY = 0.042;
const DANCE_SWAY_HEAD = 0.014;
/** Lateral lean, as a fraction of the swing. In phase, so the body banks into the
 *  swing like a pendulum rather than counter-rotating against it. */
const DANCE_LEAN = 0.5;
/** Forward/back nod, and the head's vertical bounce. */
const DANCE_BOB_BODY = 0.008;
const DANCE_BOB_HEAD = 0.020;
const DANCE_BOUNCE = 0.030;
/** Tempo the amplitudes above are tuned for. Amplitude scales with tempo — a
 *  faster track is a more energetic one — clamped at both ends so a slow track
 *  still moves and a very fast one stays inside the frame. */
const DANCE_REFERENCE_BPM = 120;
const DANCE_TEMPO_MIN = 0.8;
const DANCE_TEMPO_MAX = 1.45;

interface DanceOut { pitch: number; yaw: number; roll: number; bob: number }

/** `k` is 0 at the ceiling mount, 1 at the head. */
function dance(k: number, beat: Beat, weight: number, out: DanceOut): void {
  // Lag grows back toward the mount, so the head is the part that leads.
  const local = beat.beats - (1 - k) * DANCE_LAG;
  const tempo = Math.min(DANCE_TEMPO_MAX,
    Math.max(DANCE_TEMPO_MIN, (beat.bpm || DANCE_REFERENCE_BPM) / DANCE_REFERENCE_BPM));
  // Swell across an 8-beat phrase so the loop doesn't read as a metronome.
  const phrase = 0.75 + 0.25 * Math.cos((beat.beats / 8) * Math.PI * 2);

  // A there-and-back sway every 2 beats.
  const swing = Math.sin(local * Math.PI);
  const amp = (DANCE_SWAY_BODY + (DANCE_SWAY_HEAD - DANCE_SWAY_BODY) * k) * weight * tempo * phrase;
  out.yaw = swing * amp;
  out.roll = swing * amp * DANCE_LEAN;

  // A smooth cosine once per beat. The beat envelope was driving this before, and
  // its sharp attack made the bob read as a twitch rather than a groove.
  out.bob = Math.cos(local * Math.PI * 2);
  out.pitch = out.bob * (DANCE_BOB_BODY + (DANCE_BOB_HEAD - DANCE_BOB_BODY) * k) * weight * tempo;
}

export function initAnimation(): AnimationHandles {
  let from: GladosState = 'standby';
  let to: GladosState = 'standby';
  let blend = 1;
  let time = 0;
  let glow = POSES.standby.eyeIntensity;
  let danceWeight = 0;
  let beat: Beat = { beats: 0, intensity: 0, bpm: 120 };
  const danceOut: DanceOut = { pitch: 0, yaw: 0, roll: 0, bob: 0 };

  const live: Pose = { ...POSES.standby };
  const haloColor = new THREE.Color(HALO.standby);
  const fromColor = new THREE.Color();
  const toColor = new THREE.Color();
  const stopA = new THREE.Color();
  const stopB = new THREE.Color();
  let paintedKey = '';

  // Scratch objects, reused every frame to keep the loop allocation-free.
  const parentQ = new THREE.Quaternion();
  const deltaQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const eyePos = new THREE.Vector3();
  const eyeNormal = new THREE.Vector3();

  function poseBone(bone: THREE.Object3D | null, rest: Map<THREE.Object3D, THREE.Quaternion>,
                    pitch: number, yaw: number, roll: number): void {
    const restQ = bone && rest.get(bone);
    if (!bone || !restQ) return;

    // Ql = Qparent⁻¹ · Qdelta · Qparent · Qrest applies the offset in world space.
    if (bone.parent) bone.parent.getWorldQuaternion(parentQ);
    else parentQ.identity();

    euler.set(pitch, yaw, roll);
    deltaQ.setFromEuler(euler);

    bone.quaternion.copy(parentQ).invert().multiply(deltaQ).multiply(parentQ).multiply(restQ);
  }

  /** Repaint the lens gradient, interpolated `t` of the way from `a` to `b`. */
  function paintEye(canvas: HTMLCanvasElement, a: Gradient, b: Gradient, t: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mid = EYE_TEXTURE_SIZE / 2;
    const gradient = ctx.createRadialGradient(mid, mid, 0, mid, mid, EYE_UV_RADIUS * EYE_TEXTURE_SIZE);
    for (let i = 0; i < a.length; i++) {
      const offset = a[i][0] + (b[i][0] - a[i][0]) * t;
      stopA.setHex(a[i][1]);
      stopB.setHex(b[i][1]);
      gradient.addColorStop(offset, '#' + stopA.lerp(stopB, t).getHexString(THREE.SRGBColorSpace));
    }
    // Fills past the gradient radius too, which the mesh's UVs never reach.
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, EYE_TEXTURE_SIZE, EYE_TEXTURE_SIZE);
  }

  return {
    update(dt: number, state: GladosState, nextBeat: Beat) {
      beat = nextBeat;
      const danceTarget = state === 'dancing' ? 1 : 0;
      danceWeight += (danceTarget - danceWeight) * Math.min(1, dt * DANCE_FADE_SPEED);

      if (state !== to) {
        from = to;
        to = state;
        blend = 0;
      }
      blend = Math.min(1, blend + dt * TRANSITION_SPEED);
      time += dt;

      const a = POSES[from] ?? POSES.standby;
      const b = POSES[to] ?? POSES.standby;
      // Smoothstep so transitions ease in and out rather than snapping to a stop.
      const t = blend * blend * (3 - 2 * blend);
      const mix = (k: keyof Pose) => a[k] + (b[k] - a[k]) * t;

      live.headPitch = mix('headPitch');
      live.headYaw = mix('headYaw');
      live.headRoll = mix('headRoll');
      live.neckPitch = mix('neckPitch');
      live.spinePitch = mix('spinePitch');
      live.spineYaw = mix('spineYaw');
      live.eyeIntensity = mix('eyeIntensity');

      fromColor.setHex(HALO[from]);
      toColor.setHex(HALO[to]);
      haloColor.copy(fromColor).lerp(toColor, t);

      // Idle breathing, always present so the model never looks frozen.
      const breathe = Math.sin(time * 0.9) * 0.018;
      const sway = Math.sin(time * 0.55) * 0.022;
      live.spinePitch += breathe;
      live.spineYaw += sway;
      live.headPitch -= breathe * 0.6;

      // Per-state flourishes on top of the blended pose.
      switch (to) {
        case 'active-listening':
          live.headYaw += Math.sin(time * 1.6) * 0.03;
          glow = live.eyeIntensity + Math.sin(time * 2.2) * 0.35;
          break;
        case 'computing':
          live.headYaw += Math.sin(time * 11) * 0.02;
          live.headRoll += Math.sin(time * 7) * 0.015;
          glow = live.eyeIntensity + Math.sin(time * 16) * 0.7 + Math.sin(time * 27) * 0.3;
          break;
        case 'speaking':
          live.headPitch += Math.sin(time * 5.5) * 0.035;
          live.headRoll += Math.sin(time * 3.1) * 0.02;
          glow = live.eyeIntensity + Math.sin(time * 9) * 0.55;
          break;
        case 'dancing':
          // Everything here is on the beat clock rather than wall time — see
          // the dance layer in apply(). Pulsing the eye with the beat envelope
          // keeps the glow locked to the same tempo as the body.
          glow = live.eyeIntensity + beat.intensity * 0.9 - 0.3;
          break;
        default:
          glow = live.eyeIntensity + Math.sin(time * 1.1) * 0.2;
      }
      glow = Math.max(0.4, glow);
    },

    apply(rig: GladosRig) {
      // Root-first, so each bone reads a parent world matrix that is already posed.
      // The dance layer rides on top of the blended pose, faded by danceWeight.
      const chain: (THREE.Object3D | null)[] = [...rig.spine, rig.neck, rig.head];
      const last = Math.max(chain.length - 1, 1);
      let headBob = 0;

      for (let i = 0; i < chain.length; i++) {
        const bone = chain[i];
        if (!bone) continue;
        const isHead = bone === rig.head;
        const isNeck = bone === rig.neck;

        let pitch = isHead ? live.headPitch : isNeck ? live.neckPitch : live.spinePitch;
        let yaw = isHead ? live.headYaw : isNeck ? 0 : live.spineYaw;
        let roll = isHead ? live.headRoll : 0;

        if (danceWeight > 0.001) {
          dance(i / last, beat, danceWeight, danceOut);
          pitch += danceOut.pitch;
          yaw += danceOut.yaw;
          roll += danceOut.roll;
          if (isHead) headBob = danceOut.bob;
        }
        poseBone(bone, rig.rest, pitch, yaw, roll);
      }

      // Vertical bounce, on the same smooth cosine as the nod so the two agree.
      if (rig.head) {
        rig.head.position.copy(rig.headRestPosition);
        rig.head.position.y += headBob * DANCE_BOUNCE * danceWeight;
      }

      // Repaint the lens only when the blend has actually moved a visible step.
      if (rig.eyeCanvas && rig.eyeTexture) {
        const step = Math.round(blend * GRADIENT_STEPS);
        const key = `${from}>${to}:${step}`;
        if (key !== paintedKey) {
          paintedKey = key;
          const t = blend * blend * (3 - 2 * blend);
          paintEye(rig.eyeCanvas, GRADIENTS[from], GRADIENTS[to], t);
          rig.eyeTexture.needsUpdate = true;
        }
      }

      if (rig.eyeMaterial) {
        rig.eyeMaterial.emissiveIntensity = glow;
      }

      if (rig.eyeMesh) {
        rig.eyeMesh.updateWorldMatrix(true, false);
        rig.eyeMesh.getWorldPosition(eyePos);
        // The eye disc's face normal is its local +Y after the exporter's Z-up
        // conversion; push the light just clear of the lens along it.
        eyeNormal.set(0, 1, 0).transformDirection(rig.eyeMesh.matrixWorld).normalize();
        rig.eyeLight.position.copy(eyePos).addScaledVector(eyeNormal, 0.12);
        rig.eyeLight.color.copy(haloColor);
        rig.eyeLight.intensity = glow * 0.22;
      }
    },
  };
}

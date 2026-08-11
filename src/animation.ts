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
import { GladosState, DanceStyle, DanceMove } from './types.js';
import { Beat } from './music.js';
import { GladosRig, EYE_TEXTURE_SIZE, EYE_UV_RADIUS } from './model.js';

export interface AnimationHandles {
  update(dt: number, state: GladosState, beat: Beat): void;
  apply(rig: GladosRig): void;
  /** Pin a choreography move, or `auto` for the routine. Unknown or absent falls
   *  back to the default. */
  setStyle(style: DanceStyle | undefined): void;
  /** The move the routine has landed on, and how far through a cut it is — 1
   *  when it is not mid-cut. Instrumentation only; the card never reads it. */
  readonly danceMove: DanceMove;
  readonly danceBlend: number;
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
 * The dance layer is a set of choreography moves. By default a routine cuts
 * between all of them on the music's own phrase boundaries — see `initRoutine`
 * below — and `dance_style` can pin a single one instead.
 *
 * Each move is the same shape — offsets as a function of where a bone sits on the
 * chain and where the beat clock is — so they all feed the same apply loop, cost
 * the same to run, and can be cross-faded into one another.
 *
 * Two things are common to all of them:
 *
 * `lag` is how many beats the ceiling mount trails the head by, spread along the
 * chain. The head leads and the body follows it rather than whipping it around,
 * and the larger the lag the more the motion visibly travels down the body rather
 * than the whole chain moving as one.
 *
 * The head therefore turns barely at all on its own. It sits at the end of a long
 * chain and already inherits every ancestor's rotation, so giving it a large
 * offset of its own on top is what made it look like it was flicking about
 * independently. Nearly all the visible travel comes from the body carrying it.
 */

/** Tempo the amplitudes below are tuned for. Amplitude scales with tempo — a
 *  faster track is a more energetic one — clamped at both ends so a slow track
 *  still moves and a very fast one stays inside the frame. */
const DANCE_REFERENCE_BPM = 120;
const DANCE_TEMPO_MIN = 0.8;
const DANCE_TEMPO_MAX = 1.45;

interface DanceOut {
  pitch: number;
  yaw: number;
  roll: number;
  /** Vertical offset applied to the head, in model units. */
  bob: number;
  /** Head stretch along its own axis, as a fraction; negative squashes. */
  squash: number;
}

/**
 * Writes one bone's unweighted offsets. `k` is 0 at the ceiling mount and 1 at
 * the head, `local` is the beat clock already lagged for that bone, and `tempo`
 * and `phrase` are the shared energy multipliers.
 */
type DanceStep = (k: number, local: number, tempo: number, phrase: number, out: DanceOut) => void;

interface Choreography {
  lag: number;
  /** How hard the move reads, 0 (relaxed) to 1 (frantic). The routine biases its
   *  picks toward the tempo with this — it is a preference, never a gate. */
  energy: number;
  step: DanceStep;
}

const smoothstep = (x: number): number => x * x * (3 - 2 * x);
/** Ramp a value along the chain, from the mount's amount to the head's. */
const along = (k: number, mount: number, head: number): number => mount + (head - mount) * k;

/** Side-to-side swing, radians — the body's own, and the head's own. */
const SWAY_SWING_BODY = 0.042;
const SWAY_SWING_HEAD = 0.014;
/** Lateral lean, as a fraction of the swing. */
const SWAY_LEAN = 0.5;
/** Forward/back nod, and the head's vertical bounce. */
const SWAY_NOD_BODY = 0.008;
const SWAY_NOD_HEAD = 0.020;
const SWAY_BOUNCE = 0.030;

/** The original choreography: a travelling wave, the body following the head. */
const sway: DanceStep = (k, local, tempo, phrase, out) => {
  // A there-and-back sway every 2 beats.
  const swing = Math.sin(local * Math.PI);
  const amp = along(k, SWAY_SWING_BODY, SWAY_SWING_HEAD) * tempo * phrase;
  out.yaw = swing * amp;
  // In phase with the swing, so the body banks into it like a pendulum rather
  // than counter-rotating against it.
  out.roll = swing * amp * SWAY_LEAN;

  // A smooth cosine once per beat. The beat envelope was driving this before, and
  // its sharp attack made the bob read as a twitch rather than a groove.
  const nod = Math.cos(local * Math.PI * 2);
  out.pitch = nod * along(k, SWAY_NOD_BODY, SWAY_NOD_HEAD) * tempo;
  out.bob = nod * SWAY_BOUNCE;
};

/** Peak lift, and the stretch at the top of the arc. */
const BOUNCE_LIFT = 0.052;
const BOUNCE_SQUASH = 0.045;
/** How far the chain concertinas into the landing, and its lateral rock. */
const BOUNCE_FLEX = 0.030;
const BOUNCE_ROCK = 0.014;

/** Vertical bounce with squash and stretch. */
const bounce: DanceStep = (k, local, tempo, phrase, out) => {
  // |sin| is a bounce: a smooth arc with a hard cusp where she lands, once a beat.
  const lift = Math.abs(Math.sin(local * Math.PI));
  out.bob = lift * BOUNCE_LIFT * tempo * phrase;
  // Stretched through the arc, squashed at the landing.
  out.squash = (lift - 0.5) * 2 * BOUNCE_SQUASH * tempo;
  // The chain compresses into the landing, so the flex runs against the lift.
  out.pitch = (0.5 - lift) * along(k, BOUNCE_FLEX, BOUNCE_FLEX * 0.4) * tempo;

  // A slow rock every 4 beats, so consecutive bounces aren't carbon copies.
  const rock = Math.sin(local * Math.PI * 0.5);
  out.roll = rock * BOUNCE_ROCK * k;
  out.yaw = rock * BOUNCE_ROCK * 0.5 * k;
};

/** Beats between bangs, and the fraction of that cycle spent plunging. */
const HEADBANG_PERIOD = 2;
const HEADBANG_ATTACK = 0.28;
/**
 * How sharply the bang concentrates toward the head. The other styles ramp
 * linearly along the chain, which here folded the whole body in half and read as
 * a bow rather than a bang. Raising `k` to a power instead leaves the spine
 * almost still — at this exponent the head supplies about seven tenths of the
 * travel and the neck most of the rest — so the gesture stays where a headbang
 * belongs.
 */
const HEADBANG_FALLOFF = 4;
/** Flex at the head, plus the dip and lean that ride along with it. */
const HEADBANG_FLEX = 0.36;
const HEADBANG_DIP = 0.025;
const HEADBANG_LEAN = 0.045;

/** A sharp head-and-neck flex on the downbeat, recovering over the rest of the bar. */
const headbang: DanceStep = (k, local, tempo, phrase, out) => {
  const cycle = local / HEADBANG_PERIOD;
  const ph = cycle - Math.floor(cycle);
  // Fast down, slow back up. The asymmetry is the entire gesture — a symmetric
  // curve here reads as a nod, not a bang.
  const drop = ph < HEADBANG_ATTACK
    ? smoothstep(ph / HEADBANG_ATTACK)
    : 1 - smoothstep((ph - HEADBANG_ATTACK) / (1 - HEADBANG_ATTACK));
  const reach = Math.pow(k, HEADBANG_FALLOFF);

  out.pitch = drop * reach * HEADBANG_FLEX * tempo * phrase;
  out.bob = -drop * HEADBANG_DIP;

  // Alternate which way she leans into each bang, so it isn't a metronome.
  const side = Math.floor(cycle) % 2 ? -1 : 1;
  out.roll = drop * reach * HEADBANG_LEAN * side;
  out.yaw = drop * reach * HEADBANG_LEAN * 0.4 * side;
};

/** Width of the travelling pulse, in beats — narrow enough to read as a domino. */
const WAVE_WIDTH = 0.17;
const WAVE_ROLL = 0.075;
const WAVE_YAW = 0.038;
const WAVE_NOD = 0.020;
const WAVE_BOUNCE = 0.022;

/** A domino ripple running down the chain. */
const wave: DanceStep = (k, local, tempo, phrase, out) => {
  // A narrow gaussian pulse on each beat. Paired with this style's long lag,
  // several are in flight at once and every segment fires after the one ahead of
  // it — what you see travelling is the pulse, not the segments swinging.
  const offset = local - Math.round(local);
  const pulse = Math.exp(-(offset * offset) / (2 * WAVE_WIDTH * WAVE_WIDTH));
  // Flip direction on alternate beats. The sign changes on the half-beat, where
  // the pulse has decayed to about a hundredth of its peak.
  const dir = Math.cos(Math.round(local) * Math.PI);

  out.roll = pulse * dir * WAVE_ROLL * tempo * phrase;
  out.yaw = pulse * dir * WAVE_YAW * tempo * phrase;
  out.pitch = pulse * WAVE_NOD * tempo;
  out.bob = pulse * WAVE_BOUNCE;
};

const CHOREOGRAPHY: Record<DanceMove, Choreography> = {
  'sway':     { lag: 0.38, energy: 0.25, step: sway },
  'bounce':   { lag: 0.14, energy: 0.70, step: bounce },
  // Short, so the neck fires a hair behind the head rather than trailing it.
  'headbang': { lag: 0.15, energy: 0.95, step: headbang },
  // Long enough that the pulse is visibly partway down the body at any moment.
  'wave':     { lag: 1.10, energy: 0.45, step: wave },
};

const MOVES = Object.keys(CHOREOGRAPHY) as DanceMove[];

export const DEFAULT_DANCE_STYLE: DanceStyle = 'auto';
/** What the routine opens on, and what an unrecognised pin falls back to. */
const DEFAULT_MOVE: DanceMove = 'sway';

/** Evaluate one move for one bone, before the dance fade is applied. */
function evaluate(choreography: Choreography, k: number, beat: Beat, out: DanceOut): void {
  // Lag grows back toward the mount, so the head is the part that leads.
  const local = beat.beats - (1 - k) * choreography.lag;
  const tempo = Math.min(DANCE_TEMPO_MAX,
    Math.max(DANCE_TEMPO_MIN, (beat.bpm || DANCE_REFERENCE_BPM) / DANCE_REFERENCE_BPM));
  // Swell across an 8-beat phrase so the loop doesn't read as a metronome.
  const phrase = 0.75 + 0.25 * Math.cos((beat.beats / ROUTINE_PHRASE) * Math.PI * 2);

  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  out.bob = 0;
  out.squash = 0;
  choreography.step(k, local, tempo, phrase, out);
}

/**
 * The routine — what makes her look like she is dancing to the track rather than
 * running one loop at it.
 *
 * Everything here is measured in beats off the same clock the moves themselves
 * read, never in seconds. That is the whole trick: changes land on the phrase
 * boundaries the listener is already feeling, they slow down with the track, and
 * they stop dead when the music is paused instead of shuffling on in silence.
 *
 * A move is held for one to three phrases, then the routine cuts to a different
 * one — never the same twice running — cross-fading over a beat so the outgoing
 * move settles rather than snapping. Picks are weighted toward moves whose energy
 * suits the tempo, so a slow track leans on `sway` and `wave` and a fast one on
 * `bounce` and `headbang`, without ever ruling anything out.
 */

/** Beats in a phrase. Switches only ever land on one. */
const ROUTINE_PHRASE = 8;
/** Phrases a move is held for, before the routine cuts to another. */
const ROUTINE_HOLD_MIN = 1;
const ROUTINE_HOLD_MAX = 3;
/** Beats spent cross-fading out of the previous move. */
const ROUTINE_BLEND = 1;
/** Tempo window the energy preference is spread across, in BPM. */
const ROUTINE_SLOW_BPM = 80;
const ROUTINE_FAST_BPM = 150;
/** Spread of that preference. Wide enough that every move stays reachable at any
 *  tempo — this tilts the odds, it does not gate anything out. */
const ROUTINE_ENERGY_SPREAD = 0.4;

interface Routine {
  /** Called once per frame, before the bones are posed. */
  advance(beat: Beat): void;
  /** Pin a single move, or hand control back to the routine with `auto`. */
  pin(style: DanceStyle): void;
  /** The move now in front, the one it is cutting away from, and how far
   *  through that cross-fade it is — 1 once the new move owns the body outright. */
  readonly move: DanceMove;
  readonly from: DanceMove;
  readonly blend: number;
}

function initRoutine(): Routine {
  let move: DanceMove = DEFAULT_MOVE;
  let from: DanceMove = DEFAULT_MOVE;
  let blend = 1;
  let auto = true;
  let started = false;
  /** Beat the current cross-fade began on, and the beat the next cut is due. */
  let cutAt = 0;
  let nextCut = 0;
  let beats = 0;

  /** Weighted pick across every move but the one already playing. */
  function choose(bpm: number): DanceMove {
    const drive = Math.min(1, Math.max(0,
      (bpm - ROUTINE_SLOW_BPM) / (ROUTINE_FAST_BPM - ROUTINE_SLOW_BPM)));

    let total = 0;
    const weights = MOVES.map((candidate) => {
      if (candidate === move) return 0;
      const gap = CHOREOGRAPHY[candidate].energy - drive;
      const weight = Math.exp(-(gap * gap) / (2 * ROUTINE_ENERGY_SPREAD * ROUTINE_ENERGY_SPREAD));
      total += weight;
      return weight;
    });

    let roll = Math.random() * total;
    for (let i = 0; i < MOVES.length; i++) {
      roll -= weights[i];
      if (roll <= 0 && weights[i] > 0) return MOVES[i];
    }
    return MOVES[MOVES.length - 1];
  }

  function cut(to: DanceMove, at: number): void {
    from = move;
    move = to;
    cutAt = at;
  }

  return {
    get move() { return move; },
    get from() { return from; },
    get blend() { return blend; },

    pin(style: DanceStyle) {
      auto = style === 'auto';
      if (style === 'auto') return;
      // Cut to the pinned move rather than snapping, so changing it from the
      // dashboard editor while she is mid-dance stays smooth.
      if (style !== move) cut(style, beats);
    },

    advance(beat: Beat) {
      beats = beat.beats;

      // Anchor the grid to the clock, so a card that loads mid-track still lands
      // its cuts on the music's phrases rather than on its own start time.
      if (!started) {
        started = true;
        nextCut = Math.ceil(beats / ROUTINE_PHRASE) * ROUTINE_PHRASE;
      }

      // A `while`: nothing should ever skip a whole phrase, but the clock is not
      // this module's to guarantee and a stale grid would cut on every frame.
      while (auto && beats >= nextCut) {
        cut(choose(beat.bpm), nextCut);
        const hold = ROUTINE_HOLD_MIN
          + Math.floor(Math.random() * (ROUTINE_HOLD_MAX - ROUTINE_HOLD_MIN + 1));
        nextCut += ROUTINE_PHRASE * hold;
      }

      const elapsed = beats - cutAt;
      blend = elapsed >= ROUTINE_BLEND ? 1 : smoothstep(Math.max(0, elapsed) / ROUTINE_BLEND);
    },
  };
}

// Scratch pose for the outgoing move during a cut, so the loop stays allocation-free.
const outgoing: DanceOut = { pitch: 0, yaw: 0, roll: 0, bob: 0, squash: 0 };

/** `k` is 0 at the ceiling mount, 1 at the head. */
function dance(routine: Routine, k: number, beat: Beat, weight: number, out: DanceOut): void {
  evaluate(CHOREOGRAPHY[routine.move], k, beat, out);

  // Mid-cut, both moves are live and the body is somewhere between them. Each is
  // evaluated as itself — its own lag included — and the results are mixed.
  const blend = routine.blend;
  if (blend < 1) {
    evaluate(CHOREOGRAPHY[routine.from], k, beat, outgoing);
    out.pitch = outgoing.pitch + (out.pitch - outgoing.pitch) * blend;
    out.yaw = outgoing.yaw + (out.yaw - outgoing.yaw) * blend;
    out.roll = outgoing.roll + (out.roll - outgoing.roll) * blend;
    out.bob = outgoing.bob + (out.bob - outgoing.bob) * blend;
    out.squash = outgoing.squash + (out.squash - outgoing.squash) * blend;
  }

  out.pitch *= weight;
  out.yaw *= weight;
  out.roll *= weight;
  out.bob *= weight;
  out.squash *= weight;
}

export function initAnimation(): AnimationHandles {
  let from: GladosState = 'standby';
  let to: GladosState = 'standby';
  let blend = 1;
  let time = 0;
  let glow = POSES.standby.eyeIntensity;
  let danceWeight = 0;
  const routine = initRoutine();
  let beat: Beat = { beats: 0, intensity: 0, bpm: 120 };
  const danceOut: DanceOut = { pitch: 0, yaw: 0, roll: 0, bob: 0, squash: 0 };

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
    get danceMove() { return routine.move; },
    get danceBlend() { return routine.blend; },

    setStyle(style: DanceStyle | undefined) {
      const known = style === 'auto' || (style !== undefined && style in CHOREOGRAPHY);
      routine.pin(known ? style : DEFAULT_DANCE_STYLE);
    },

    update(dt: number, state: GladosState, nextBeat: Beat) {
      beat = nextBeat;
      // Advanced whatever the state, on the same reasoning as the beat clock:
      // the routine is a property of the music, so returning to Dancing picks up
      // the move the track has arrived at rather than restarting the set.
      routine.advance(beat);
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
      let headSquash = 0;

      for (let i = 0; i < chain.length; i++) {
        const bone = chain[i];
        if (!bone) continue;
        const isHead = bone === rig.head;
        const isNeck = bone === rig.neck;

        let pitch = isHead ? live.headPitch : isNeck ? live.neckPitch : live.spinePitch;
        let yaw = isHead ? live.headYaw : isNeck ? 0 : live.spineYaw;
        let roll = isHead ? live.headRoll : 0;

        if (danceWeight > 0.001) {
          dance(routine, i / last, beat, danceWeight, danceOut);
          pitch += danceOut.pitch;
          yaw += danceOut.yaw;
          roll += danceOut.roll;
          if (isHead) {
            headBob = danceOut.bob;
            headSquash = danceOut.squash;
          }
        }
        poseBone(bone, rig.rest, pitch, yaw, roll);
      }

      // Vertical travel and squash, both driven by the same curve as the nod so
      // they agree. Written from the bind pose every frame rather than accumulated.
      if (rig.head) {
        rig.head.position.copy(rig.headRestPosition);
        rig.head.position.y += headBob;
        rig.head.scale.copy(rig.headRestScale);
        if (headSquash !== 0) {
          rig.head.scale.y *= 1 + headSquash;
          // Conserve rough volume, so a stretch narrows rather than just growing.
          rig.head.scale.x *= 1 - headSquash * 0.5;
          rig.head.scale.z *= 1 - headSquash * 0.5;
        }
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

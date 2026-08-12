/**
 * scene.ts — Three.js renderer, camera, lighting and post-processing.
 *
 * The GLaDOS model ships without any exported base colours (see model.ts), so
 * almost every surface falls back to the glTF default of metalness 1 / roughness 1.
 * A metal has no diffuse response, which is why the model renders pitch black
 * unless the scene provides an environment map — hence the PMREM/RoomEnvironment
 * below. It is not decorative; without it there is nothing to see.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Glados3DConfig } from './types.js';

export interface SceneHandles {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render(): void;
  resize(): void;
  /** Re-read `bg_color` / `transparent_bg` from a config the card has replaced. */
  setBackground(config: Glados3DConfig): void;
  dispose(): void;
}

const DEFAULT_BG = '#0d0f14';

/** Bloom only picks up values above this, in linear HDR. The white chassis sits
 *  just under 1.0 under the lighting below, so only the eye emissive blooms. */
const BLOOM_THRESHOLD = 1.7;
const BLOOM_RADIUS = 0.4;

/**
 * MSAA samples for the pass that rasterises geometry.
 *
 * The renderer's `antialias` flag only covers the default framebuffer, and once
 * bloom is enabled the scene is never drawn there — it goes into the composer's
 * own render target, which three.js creates unsampled. So `antialias: true` is
 * silently inert whenever post-processing is on, and this model's white-on-black
 * silhouettes and thin cables are exactly the content that shows it. Handing the
 * composer a multisampled target restores it. Drop to 2, or 0, if a low-end
 * device needs the fill rate back.
 */
const MSAA_SAMPLES = 4;

export function initScene(canvas: HTMLCanvasElement, config: Glados3DConfig): SceneHandles {
  const scene = new THREE.Scene();
  setBackground(scene, config);

  const camera = new THREE.PerspectiveCamera(35, aspectOf(canvas), 0.1, 500);
  camera.position.set(0, 0, 10);

  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  // A context's alpha is fixed the moment it is created, and a canvas hands back
  // the same context whatever the second caller asks for — so requesting it
  // unconditionally is what lets `transparent_bg` be toggled on a live card
  // rather than only at the next dashboard reload. It costs nothing while the
  // scene has an opaque background: three then clears at alpha 1 regardless.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  // Every pass that clears — RenderPass, and UnrealBloomPass for its own targets
  // — clears to the renderer's colour, so this zero alpha is what carries the
  // transparency through the composer.
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
  key.position.set(4, 6, 6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb4ff, 0.6);
  fill.position.set(-6, 1, 4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 1.0);
  rim.position.set(-2, 3, -7);
  scene.add(rim);

  const bloomStrength = config.bloom ?? 0.9;
  let composer: EffectComposer | null = null;

  if (bloomStrength > 0) {
    // Built at CSS size so setPixelRatio scales it to the drawing buffer; resize()
    // establishes the real dimensions before anything is drawn.
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(size.x, 1), Math.max(size.y, 1), {
      type: THREE.HalfFloatType,
      samples: MSAA_SAMPLES,
    });

    // Both of the composer's buffers must keep the sample count. EffectComposer
    // clones this target into renderTarget2 and then assigns it as the *read*
    // buffer, which is the one RenderPass actually draws the scene into — so
    // desampling the clone as an "optimisation" silently disables MSAA.
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pixelRatio);

    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
    preserveAlpha(bloom);

    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const handles: SceneHandles = {
    scene,
    camera,
    render() {
      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
    resize() {
      const { width, height } = sizeOf(canvas);
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer?.setSize(width, height);
    },
    setBackground(next) {
      setBackground(scene, next);
    },
    dispose() {
      composer?.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };

  handles.resize();
  return handles;
}

/** A null background is what makes the canvas transparent; three then clears to
 *  the renderer's colour, which is set to zero alpha above. */
function setBackground(scene: THREE.Scene, config: Glados3DConfig): void {
  scene.background = config.transparent_bg
    ? null
    : new THREE.Color(config.bg_color || DEFAULT_BG);
}

/**
 * Stop the bloom pass from filling in a transparent background.
 *
 * Its separable blur shader writes `vec4(colour, 1.0)`, so every blurred mip is
 * fully opaque regardless of what the scene left behind. Blended additively that
 * alpha lands in the background too, and the canvas comes out solid black — the
 * eye still glows, but nothing behind the card shows through.
 *
 * Additive blending is a preset, and three only reads the separate alpha factors
 * under CustomBlending, so the RGB half is restated verbatim and only alpha
 * changes: keep the destination's, discard the pass's. The halo outside the
 * silhouette therefore carries colour at zero alpha, which the compositor adds
 * to the page — the glow spills onto the dashboard instead of onto black. With
 * an opaque background the destination alpha is already 1, so this is inert.
 */
function preserveAlpha(bloom: UnrealBloomPass): void {
  const material = bloom.blendMaterial;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
}

function sizeOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

function aspectOf(canvas: HTMLCanvasElement): number {
  const { width, height } = sizeOf(canvas);
  return width && height ? width / height : 1;
}

const _target = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Point the camera at a bounding sphere so it fills `fill` of the vertical view.
 * `yaw`/`pitch` are in radians, measured from the +Z axis.
 *
 * `panX`/`panY` slide the framing across the sensor, in units of `radius`, after
 * the camera is oriented — panning up pushes the subject down the frame. Doing it
 * in camera space rather than world space keeps the composition stable at any yaw.
 */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  center: THREE.Vector3,
  radius: number,
  fill: number,
  yaw: number,
  pitch: number,
  panX = 0,
  panY = 0
): void {
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) / Math.max(fill, 0.01);
  camera.position.set(
    center.x + dist * Math.cos(pitch) * Math.sin(yaw),
    center.y + dist * Math.sin(pitch),
    center.z + dist * Math.cos(pitch) * Math.cos(yaw)
  );
  camera.lookAt(center);
  camera.updateMatrixWorld();

  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);
  _target.copy(center)
    .addScaledVector(_right, panX * radius)
    .addScaledVector(_up, panY * radius);
  camera.position
    .addScaledVector(_right, panX * radius)
    .addScaledVector(_up, panY * radius);
  camera.lookAt(_target);

  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
}

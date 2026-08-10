/**
 * model.ts — loads the GLaDOS glTF, cleans up the source blend, and exposes the rig.
 *
 * Two things about this model need compensating for, both artefacts of the
 * original .blend rather than bugs in the export:
 *
 * 1. The blend keeps its material-preview props (colour clips, lamp planes,
 *    PotatOS, a 42-unit test cylinder) parked at the world origin, right on top
 *    of GLaDOS. They have to be dropped or they engulf the model. KEEP lists the
 *    root nodes that actually make up the character.
 *
 * 2. The materials were procedural, so nothing but the emissive ones survived the
 *    glTF export — every other material arrives with no baseColor and therefore
 *    the spec default of metalness 1 / roughness 1. PALETTE re-authors them by
 *    name to match the original render.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface GladosRig {
  /** Head assembly carrying the eye and faceplate. */
  head: THREE.Object3D | null;
  /** Neck segment between head and spine. */
  neck: THREE.Object3D | null;
  /** Spine segments, ordered root-first. */
  spine: THREE.Object3D[];
  eyeMesh: THREE.Mesh | null;
  eyeMaterial: THREE.MeshStandardMaterial | null;
  /** Canvas behind the lens gradient; animation.ts repaints it per state. */
  eyeCanvas: HTMLCanvasElement | null;
  eyeTexture: THREE.CanvasTexture | null;
  eyeLight: THREE.PointLight;
  /** Bind pose of every bone above, so animation can apply offsets from rest. */
  rest: Map<THREE.Object3D, THREE.Quaternion>;
  /** Head's bind-pose translation, so positional offsets never accumulate. */
  headRestPosition: THREE.Vector3;
}

export interface ModelHandles {
  rig: GladosRig;
  /** Bounding sphere of the head, for camera framing. */
  frame: { center: THREE.Vector3; radius: number };
  dispose(): void;
}

/**
 * Cables that sit outside the armature. In the blend they were driven by curve
 * and hook modifiers, which glTF cannot express, so they export as frozen
 * geometry parked next to the rig — leaving a cable hanging motionless beside
 * her face while everything else moves. Each is re-parented to the nearest bone
 * after load so it travels with the body.
 */
const LOOSE_WIRES = ['Wires_Head_in', 'Wires_Out', 'Wires_In', 'BezierCurve024'];

/** Root-level nodes that make up the visible character. Everything else is
 *  Blender scratch work parked at the origin — see the file header. */
const KEEP = new Set([
  'Torus',          // ceiling dome
  'Armature',       // the character itself
  ...LOOSE_WIRES,
]);

interface MaterialSpec { color: number; metalness: number; roughness: number }

const PALETTE: Record<string, MaterialSpec> = {
  'Plates':        { color: 0xf1eee8, metalness: 0.10, roughness: 0.58 },
  'Plates 2':      { color: 0xe8e5df, metalness: 0.15, roughness: 0.58 },
  'Faceplate':     { color: 0xf4f2ee, metalness: 0.05, roughness: 0.48 },
  'Material.001':  { color: 0xdedbd5, metalness: 0.20, roughness: 0.55 },
  'Internal':      { color: 0x17181b, metalness: 0.75, roughness: 0.42 },
  'Logo':          { color: 0x0d0d0f, metalness: 0.40, roughness: 0.50 },
  'Brushed Metal': { color: 0x9fa0a4, metalness: 1.00, roughness: 0.32 },
  'Shadow':        { color: 0x050506, metalness: 0.00, roughness: 1.00 },
};

export const EYE_TEXTURE_SIZE = 128;
/** The lens rim sits at this radius from (0.5, 0.5) in the mesh's own UVs. */
export const EYE_UV_RADIUS = 0.252;

/** Rig node names in the source model. */
const BONE = {
  head: 'Bone014',
  neck: 'Bone001',
  spine: ['Bone017', 'Bone018', 'Bone016'],
  eyeMesh: 'Circle002',
};

export function loadModel(scene: THREE.Scene, modelUrl: string): Promise<ModelHandles> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene;

        // Only prune when this really is the blendswap model — otherwise a
        // different GLB would have every one of its nodes stripped.
        if (root.children.some((c) => KEEP.has(c.name))) {
          for (const child of [...root.children]) {
            if (!KEEP.has(child.name)) root.remove(child);
          }
        }

        applyPalette(root);
        root.updateMatrixWorld(true);

        const byName = new Map<string, THREE.Object3D>();
        root.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });

        const rig = buildRig(byName, scene);
        // Frame on the bare head, before the loose cables get attached to it —
        // otherwise their geometry inflates the head's bounds and pulls the
        // camera back.
        const frame = frameOfHead(rig.head ?? root);
        reattachLooseWires(root, rig);

        scene.add(root);
        resolve({
          rig,
          frame,
          dispose() {
            scene.remove(root);
            scene.remove(rig.eyeLight);
            rig.eyeTexture?.dispose();
            root.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.geometry.dispose();
              for (const m of materialsOf(mesh)) m.dispose();
            });
          },
        });
      },
      undefined,
      (error) => reject(error)
    );
  });
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
}

function applyPalette(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of materialsOf(mesh)) {
      const spec = PALETTE[(material.name || '').trim()];
      if (!spec) continue;
      const std = material as THREE.MeshStandardMaterial;
      std.color.setHex(spec.color);
      std.metalness = spec.metalness;
      std.roughness = spec.roughness;
    }
  });
}

function buildRig(byName: Map<string, THREE.Object3D>, scene: THREE.Scene): GladosRig {
  const head = byName.get(BONE.head) ?? null;
  const neck = byName.get(BONE.neck) ?? null;
  const spine = BONE.spine.map((n) => byName.get(n)).filter(Boolean) as THREE.Object3D[];
  const eyeMesh = (byName.get(BONE.eyeMesh) as THREE.Mesh) ?? null;

  // The eye material is shared with offcuts elsewhere in the blend; clone so the
  // animation owns it outright.
  let eyeMaterial: THREE.MeshStandardMaterial | null = null;
  let eyeCanvas: HTMLCanvasElement | null = null;
  let eyeTexture: THREE.CanvasTexture | null = null;
  if (eyeMesh && eyeMesh.material && !Array.isArray(eyeMesh.material)) {
    eyeMaterial = (eyeMesh.material as THREE.MeshStandardMaterial).clone();
    eyeMesh.material = eyeMaterial;

    // The lens is a triangle fan with a centre vertex and radial UVs, so a
    // radial gradient painted into a canvas maps straight onto it. That's what
    // gives the eye a white-hot core fading to a dark rim instead of reading as
    // a flat disc; animation.ts repaints it as the state changes.
    eyeCanvas = document.createElement('canvas');
    eyeCanvas.width = eyeCanvas.height = EYE_TEXTURE_SIZE;
    eyeTexture = new THREE.CanvasTexture(eyeCanvas);
    eyeTexture.colorSpace = THREE.SRGBColorSpace;
    eyeMaterial.emissiveMap = eyeTexture;
    eyeMaterial.emissive.setHex(0xffffff);
  }

  // Tight falloff on purpose: this is spill from the lens onto its own housing,
  // not a room light. A wider radius washes the white faceplate out entirely.
  const eyeLight = new THREE.PointLight(0xffa53c, 0, 0.6, 2);
  scene.add(eyeLight);

  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const bone of [head, neck, ...spine]) {
    if (bone) rest.set(bone, bone.quaternion.clone());
  }

  const headRestPosition = head ? head.position.clone() : new THREE.Vector3();

  return { head, neck, spine, eyeMesh, eyeMaterial, eyeCanvas, eyeTexture, eyeLight, rest, headRestPosition };
}

/** Re-parent each loose cable onto whichever bone it sits closest to. `attach`
 *  preserves the world transform, so nothing shifts — the cable simply starts
 *  inheriting that bone's motion. */
function reattachLooseWires(root: THREE.Object3D, rig: GladosRig): void {
  const bones = [...rig.spine, rig.neck, rig.head].filter(Boolean) as THREE.Object3D[];
  if (!bones.length) return;

  const box = new THREE.Box3();
  const wireCenter = new THREE.Vector3();
  const bonePos = new THREE.Vector3();

  for (const name of LOOSE_WIRES) {
    const wire = root.children.find((c) => c.name === name);
    if (!wire) continue;

    box.setFromObject(wire).getCenter(wireCenter);
    let nearest = bones[0];
    let nearestDistance = Infinity;
    for (const bone of bones) {
      bone.getWorldPosition(bonePos);
      const distance = bonePos.distanceTo(wireCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = bone;
      }
    }
    nearest.attach(wire);
  }
}

function frameOfHead(target: THREE.Object3D): { center: THREE.Vector3; radius: number } {
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  return { center: box.getCenter(new THREE.Vector3()), radius: size.length() / 2 };
}

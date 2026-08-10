/**
 * portal.ts — Portal ring effects for GLaDOS using Three.js geometry + custom shaders.
 * Creates blue and orange portal rings (torus geometry with fresnel-like shader)
 * with subtle particle shimmer. Visibility linked to entity states.
 */

import * as THREE from 'three';

export interface PortalHandles {
  group: THREE.Group;
  updateVisibility(visible: boolean): void;
  updateState(state: string, beatIntensity: number): void;
}

const PORTAL_BLUE = new THREE.Color(0x00aaff);
const PORTAL_ORANGE = new THREE.Color(0xff6600);

// Custom shader material for portal ring glow (fresnel-like)
function createPortalMaterial(color: THREE.Color, isBlue: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uIntensity: { value: 1.0 },
      uIsBlue: { value: isBlue ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uIsBlue;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;

      void main() {
        // Fresnel effect — glow stronger at edges
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - abs(dot(viewDir, vNormal));
        fresnel = pow(fresnel, 2.0);

        // Swirl pattern
        float angle = atan(vPosition.y, vPosition.x);
        float swirl = sin(angle * 8.0 + uTime * 2.0) * 0.5 + 0.5;
        swirl = pow(swirl, 3.0);

        // Core glow
        vec3 col = mix(uColor, vec3(1.0), swirl * 0.3);
        float alpha = fresnel * uIntensity * (0.6 + swirl * 0.4);

        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createPortals(): PortalHandles {
  const group = new THREE.Group();
  group.visible = false; // hidden by default, shown during speaking/dance states

  // --- Blue portal ring ---
  const torusGeoBlue = new THREE.TorusGeometry(0.6, 0.03, 16, 64);
  const matBlue = createPortalMaterial(PORTAL_BLUE, true);
  const ringBlue = new THREE.Mesh(torusGeoBlue, matBlue);
  ringBlue.position.set(-0.8, 0, 0.5);
  ringBlue.rotation.z = Math.PI * 0.1;
  group.add(ringBlue);

  // --- Orange portal ring ---
  const torusGeoOrange = new THREE.TorusGeometry(0.6, 0.03, 16, 64);
  const matOrange = createPortalMaterial(PORTAL_ORANGE, false);
  const ringOrange = new THREE.Mesh(torusGeoOrange, matOrange);
  ringOrange.position.set(0.8, 0, 0.5);
  ringOrange.rotation.z = -Math.PI * 0.1;
  group.add(ringOrange);

  // --- Particle shimmer for portals ---
  const particleCount = 60;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    // Distribute particles around both portal rings
    const isBlueParticle = i < particleCount / 2;
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.5 + Math.random() * 0.2;
    const cx = isBlueParticle ? -0.8 : 0.8;

    positions[i * 3] = cx + Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius * 0.3;
    positions[i * 3 + 2] = 0.5 + Math.random() * 0.1;

    const col = isBlueParticle ? PORTAL_BLUE : PORTAL_ORANGE;
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  group.add(particles);

  return {
    group,
    updateVisibility(visible: boolean) {
      group.visible = visible;
    },
    updateState(state: string, beatIntensity: number) {
      // Animate portal materials based on state and beat
      const time = performance.now() * 0.001;

      (ringBlue.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      (ringOrange.material as THREE.ShaderMaterial).uniforms.uTime.value = time;

      // Beat-reactive intensity
      const baseIntensity = state === 'speaking' ? 1.5 : 0.8;
      const beatBoost = beatIntensity * 0.5;
      (ringBlue.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
        baseIntensity + beatBoost;
      (ringOrange.material as THREE.ShaderMaterial).uniforms.uIntensity.value =
        baseIntensity + beatBoost;

      // Subtle ring rotation
      ringBlue.rotation.z = Math.PI * 0.1 + Math.sin(time * 0.5) * 0.05;
      ringOrange.rotation.z = -Math.PI * 0.1 - Math.sin(time * 0.5) * 0.05;

      // Animate particle positions
      const posArr = particles.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        posArr[i * 3 + 1] += Math.sin(time * 2 + i) * 0.001; // float upward
      }
      particles.geometry.attributes.position.needsUpdate = true;
    },
  };
}

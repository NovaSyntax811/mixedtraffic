// Scene, renderer, bloom, and static urban environment.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2238); // dusky sky
  scene.fog = new THREE.Fog(0x1a2238, 60, 180);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  document.getElementById('app').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 1.6, 0);

  // --- Bloom so the LED band glows ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 0.85);
  composer.addPass(bloom);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Lighting (adjustable per scenario via setTimeOfDay) ---
  const hemi = new THREE.HemisphereLight(0x7d90c8, 0x3a3024, 2.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb070, 2.6);
  sun.position.set(-40, 18, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  scene.add(sun);

  buildEnvironment(scene);

  // Time-of-day presets. Most are bright/legible (the dusk-only look was too
  // dark to read the scene); night is reserved for the audio-only study.
  const TIMES = {
    day:       { bg: 0x9fc3e8, hemiSky: 0xbcd4f0, hemiGround: 0x6f6a58, hemiI: 3.4, sunColor: 0xfff4e0, sunI: 3.2, sunPos: [-30, 55, 25], fog: [120, 320], exposure: 1.05, bloom: 0.45 },
    afternoon: { bg: 0x8fb3d8, hemiSky: 0xaecae8, hemiGround: 0x6a6450, hemiI: 3.0, sunColor: 0xffe6b8, sunI: 3.0, sunPos: [-45, 38, 25], fog: [110, 300], exposure: 1.1, bloom: 0.5 },
    overcast:  { bg: 0x9aa2ad, hemiSky: 0xb4bcc6, hemiGround: 0x6e6c68, hemiI: 3.1, sunColor: 0xdfe4ea, sunI: 1.4, sunPos: [-20, 60, 20], fog: [90, 240], exposure: 1.08, bloom: 0.5 },
    dusk:      { bg: 0x35415f, hemiSky: 0x7d90c8, hemiGround: 0x3a3024, hemiI: 2.4, sunColor: 0xffb070, sunI: 2.6, sunPos: [-40, 18, 25], fog: [70, 200], exposure: 1.22, bloom: 0.7 },
    night:     { bg: 0x141a2e, hemiSky: 0x3a4a78, hemiGround: 0x1c1810, hemiI: 1.2, sunColor: 0x6678b0, sunI: 0.7, sunPos: [-30, 30, 20], fog: [50, 170], exposure: 1.35, bloom: 0.85 },
  };

  function setTimeOfDay(name) {
    const t = TIMES[name] || TIMES.afternoon;
    scene.background = new THREE.Color(t.bg);
    scene.fog = new THREE.Fog(t.bg, t.fog[0], t.fog[1]);
    hemi.color.setHex(t.hemiSky);
    hemi.groundColor.setHex(typeof t.hemiGround === 'number' ? t.hemiGround : 0x3a3024);
    hemi.intensity = t.hemiI;
    sun.color.setHex(t.sunColor);
    sun.intensity = t.sunI;
    sun.position.set(...t.sunPos);
    renderer.toneMappingExposure = t.exposure;
    bloom.strength = t.bloom;
  }
  setTimeOfDay('afternoon'); // brighter default

  return { scene, camera, renderer, composer, bloom, setTimeOfDay };
}

// Layout convention:
//   Main street runs along Z (AV drives from -Z toward +Z).
//   Side street runs along X. Intersection centered at origin.
//   Zebra crossing on the main street at z = 6 (north of intersection).
export const LAYOUT = {
  roadWidth: 8,
  sidewalk: 3,
  zebraZ: 6,
};

function buildEnvironment(scene) {
  const { roadWidth, sidewalk, zebraZ } = LAYOUT;

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.95 });
  const pavement = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.9 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x27331f, roughness: 1 });

  // Ground base
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads (two crossing strips)
  const mainRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 220), asphalt);
  mainRoad.rotation.x = -Math.PI / 2;
  mainRoad.receiveShadow = true;
  scene.add(mainRoad);

  const sideRoad = new THREE.Mesh(new THREE.PlaneGeometry(220, roadWidth), asphalt);
  sideRoad.rotation.x = -Math.PI / 2;
  sideRoad.position.y = 0.001;
  sideRoad.receiveShadow = true;
  scene.add(sideRoad);

  // Sidewalks flanking the main road
  for (const sx of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(sidewalk, 0.12, 220), pavement);
    sw.position.set(sx * (roadWidth / 2 + sidewalk / 2), 0.06, 0);
    sw.receiveShadow = true;
    scene.add(sw);
    // and along the side road
    for (const sz of [-1, 1]) {
      const sw2 = new THREE.Mesh(new THREE.BoxGeometry(220, 0.12, sidewalk), pavement);
      sw2.position.set(0, 0.06, sz * (roadWidth / 2 + sidewalk / 2));
      sw2.receiveShadow = true;
      scene.add(sw2);
    }
  }

  // Zebra crossing (white stripes across the main road at zebraZ)
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.7 });
  for (let i = 0; i < 7; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.45), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-3 + i, 0.012, zebraZ);
    stripe.scale.x = 0.9;
    scene.add(stripe);
  }

  // Center lane dashes on main road
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xaaa68a, roughness: 0.8 });
  for (let z = -100; z <= 100; z += 6) {
    if (Math.abs(z) < roadWidth / 2 + 2) continue; // skip intersection
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.4), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.011, z);
    scene.add(dash);
  }

  // Low-poly buildings around the intersection corners
  const palette = [0x3a4458, 0x4d4257, 0x55504a, 0x39505a, 0x46394d];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const w = 6 + rand() * 6, d = 6 + rand() * 6, h = 6 + rand() * 16;
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: palette[Math.floor(rand() * palette.length)], roughness: 0.85 })
        );
        const off = roadWidth / 2 + sidewalk + 3;
        b.position.set(cx * (off + w / 2 + rand() * 14), h / 2, cz * (off + d / 2 + i * 11 + rand() * 4));
        b.castShadow = b.receiveShadow = true;
        scene.add(b);
        // a few lit windows for dusk mood
        addWindows(scene, b, w, h, d, rand);
      }
    }
  }

  // Street lamps near the crossing
  for (const [x, z] of [[-roadWidth / 2 - 1, zebraZ + 2], [roadWidth / 2 + 1, zebraZ - 2]]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 4.5),
      new THREE.MeshStandardMaterial({ color: 0x222630 })
    );
    pole.position.set(x, 2.25, z);
    scene.add(pole);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 1.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16), lampMat);
    head.position.set(x, 4.5, z);
    scene.add(head);
    const light = new THREE.PointLight(0xffc070, 14, 18, 2);
    light.position.set(x, 4.4, z);
    scene.add(light);
  }
}

function addWindows(scene, building, w, h, d, rand) {
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffe3a8, emissive: 0xffc870, emissiveIntensity: 1.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x10131c, roughness: 0.4 });
  const rows = Math.floor(h / 3), cols = Math.floor(w / 2.2);
  const geo = new THREE.PlaneGeometry(0.9, 1.1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = new THREE.Mesh(geo, rand() < 0.35 ? winMat : darkMat);
      m.position.set(
        building.position.x - w / 2 + 1.1 + c * 2.2,
        1.6 + r * 3,
        building.position.z + (building.position.z > 0 ? -d / 2 - 0.01 : d / 2 + 0.01)
      );
      if (building.position.z > 0) m.rotation.y = Math.PI;
      scene.add(m);
    }
  }
}

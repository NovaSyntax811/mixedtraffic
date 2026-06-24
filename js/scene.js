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

  const env = buildEnvironment(scene);

  // Time-of-day presets. `lights` toggles apartment/street lights: off in
  // daylight, on at dusk/night. Most presets are bright/legible.
  const TIMES = {
    day:       { bg: 0x9fc3e8, hemiSky: 0xbcd4f0, hemiGround: 0x6f6a58, hemiI: 3.4, sunColor: 0xfff4e0, sunI: 3.2, sunPos: [-30, 55, 25], fog: [120, 320], exposure: 1.05, bloom: 0.45, lights: 0 },
    afternoon: { bg: 0x8fb3d8, hemiSky: 0xaecae8, hemiGround: 0x6a6450, hemiI: 3.0, sunColor: 0xffe6b8, sunI: 3.0, sunPos: [-45, 38, 25], fog: [110, 300], exposure: 1.1, bloom: 0.5, lights: 0 },
    overcast:  { bg: 0x9aa2ad, hemiSky: 0xb4bcc6, hemiGround: 0x6e6c68, hemiI: 3.1, sunColor: 0xdfe4ea, sunI: 1.4, sunPos: [-20, 60, 20], fog: [90, 240], exposure: 1.08, bloom: 0.5, lights: 0 },
    dusk:      { bg: 0x35415f, hemiSky: 0x7d90c8, hemiGround: 0x3a3024, hemiI: 2.4, sunColor: 0xffb070, sunI: 2.6, sunPos: [-40, 18, 25], fog: [70, 200], exposure: 1.22, bloom: 0.7, lights: 0.7 },
    night:     { bg: 0x141a2e, hemiSky: 0x3a4a78, hemiGround: 0x1c1810, hemiI: 1.2, sunColor: 0x6678b0, sunI: 0.7, sunPos: [-30, 30, 20], fog: [50, 170], exposure: 1.35, bloom: 0.85, lights: 1 },
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
    env.setNightLights(t.lights);
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

  // Collections toggled by time of day (off in daylight)
  const litWindows = []; // emissive window materials
  const lampLights = []; // street-lamp point lights
  const lampMats = [];   // street-lamp head materials

  // Distinct surfaces: main road darker, side road clearly lighter, pavement
  // lighter still, grass greener — so the three road types read apart.
  const asphaltMain = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.96 });
  const asphaltSide = new THREE.MeshStandardMaterial({ color: 0x44474f, roughness: 0.96 });
  const pavement = new THREE.MeshStandardMaterial({ color: 0x6c717a, roughness: 0.92 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x35522b, roughness: 1 });
  // Markings are mid-grey, not bright white, so they don't trip the bloom
  // threshold under bright sun (bloom is reserved for the eHMI LED band).
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x9c988b, roughness: 0.8 });

  // Ground base
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // Flush sidewalks (thin slabs, not raised curbs — the walking area is not a
  // separated step). Drawn first so the roads sit on top at the intersection.
  for (const sx of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(sidewalk, 220), pavement);
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(sx * (roadWidth / 2 + sidewalk / 2), 0.002, 0);
    sw.receiveShadow = true;
    scene.add(sw);
    for (const sz of [-1, 1]) {
      const sw2 = new THREE.Mesh(new THREE.PlaneGeometry(220, sidewalk), pavement);
      sw2.rotation.x = -Math.PI / 2;
      sw2.position.set(0, 0.002, sz * (roadWidth / 2 + sidewalk / 2));
      sw2.receiveShadow = true;
      scene.add(sw2);
    }
  }

  // Roads (two crossing strips), main slightly below side so the side road
  // reads as crossing over at the junction.
  const mainRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 220), asphaltMain);
  mainRoad.rotation.x = -Math.PI / 2;
  mainRoad.position.y = 0.004;
  mainRoad.receiveShadow = true;
  scene.add(mainRoad);

  const sideRoad = new THREE.Mesh(new THREE.PlaneGeometry(220, roadWidth), asphaltSide);
  sideRoad.rotation.x = -Math.PI / 2;
  sideRoad.position.y = 0.006;
  sideRoad.receiveShadow = true;
  scene.add(sideRoad);

  // Continuous white edge lines along both roads (helps tell roads apart)
  const addLine = (w, l, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    scene.add(m);
  };
  for (const sx of [-1, 1]) addLine(0.16, 220, sx * (roadWidth / 2 - 0.2), 0);  // main road edges
  for (const sz of [-1, 1]) addLine(220, 0.16, 0, sz * (roadWidth / 2 - 0.2));  // side road edges

  // No painted crossing here on purpose: the pedestrian has no legal right of
  // way, so when the AV stops it is yielding by choice (prosocial), not because
  // a zebra obliges it. (zebraZ is kept only as the internal crossing point.)

  // Center lane dashes on the main road
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x9a9580, roughness: 0.85 });
  for (let z = -100; z <= 100; z += 6) {
    if (Math.abs(z) < roadWidth / 2 + 2) continue; // skip intersection
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.4), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.013, z);
    scene.add(dash);
  }

  // Low-poly buildings around the intersection corners
  const palette = [0x55617d, 0x6a5d74, 0x726a5e, 0x4f6a76, 0x5e4f66];
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
        addWindows(scene, b, w, h, d, rand, litWindows);
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
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x4a4636, emissive: 0xffc070, emissiveIntensity: 1.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16), lampMat);
    head.position.set(x, 4.5, z);
    scene.add(head);
    lampMats.push(lampMat);
    const light = new THREE.PointLight(0xffc070, 14, 18, 2);
    light.position.set(x, 4.4, z);
    scene.add(light);
    lampLights.push(light);
  }

  // Right-of-way signage: the side road yields, the main road has priority.
  // Kept minimal: a give-way sign on each side-road approach plus one priority
  // sign on the main road, so the merge interaction reads clearly.
  placeSign(scene, 'yield', -4.7, -4.7, -Math.PI / 2);  // west side road, faces the merging car
  placeSign(scene, 'yield', 4.7, 4.7, Math.PI / 2);     // east side road, faces westbound traffic
  placeSign(scene, 'priority', 4.7, -4.7, Math.PI);     // main road, faces the AV's approach from the south

  // Toggle artificial lights: factor 0 = off (daylight), 1 = full (night)
  function setNightLights(factor) {
    for (const m of litWindows) m.emissiveIntensity = 1.1 * factor;
    for (const m of lampMats) m.emissiveIntensity = 1.6 * factor;
    for (const l of lampLights) l.intensity = 14 * factor;
  }

  return { setNightLights };
}

function addWindows(scene, building, w, h, d, rand, litWindows) {
  // Dark glass base for all windows; "lit" ones add a warm emissive we can
  // switch off in daylight (so apartments are dark when it's bright outside).
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x10131c, roughness: 0.4 });
  const rows = Math.floor(h / 3), cols = Math.floor(w / 2.2);
  const geo = new THREE.PlaneGeometry(0.9, 1.1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand() < 0.35;
      const mat = lit
        ? new THREE.MeshStandardMaterial({ color: 0x161a24, emissive: 0xffc870, emissiveIntensity: 1.1, roughness: 0.4 })
        : darkMat;
      if (lit) litWindows.push(mat);
      const m = new THREE.Mesh(geo, mat);
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

// ---------------------------------------------------------------------------
// Traffic signs (3D). 'yield' = give way (downward red/white triangle),
// 'priority' = priority road (yellow/white diamond). Built facing +Z; aim with
// the group's Y rotation when placing.
// ---------------------------------------------------------------------------
function yieldTriangleGeo(size) {
  const h = size * Math.sqrt(3) / 2;
  const s = new THREE.Shape();
  s.moveTo(-size / 2, h / 2);   // top-left
  s.lineTo(size / 2, h / 2);    // top-right
  s.lineTo(0, -h / 2);          // bottom point (give-way points down)
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function buildSign(kind) {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.55, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), poleMat);
  pole.position.y = 1.25;
  pole.castShadow = true;
  g.add(pole);
  const faceY = 2.35;
  const dbl = THREE.DoubleSide;

  if (kind === 'yield') {
    const red = new THREE.Mesh(yieldTriangleGeo(0.9), new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5, side: dbl }));
    red.position.set(0, faceY, 0);
    red.castShadow = true;
    g.add(red);
    const white = new THREE.Mesh(yieldTriangleGeo(0.58), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, side: dbl }));
    white.position.set(0, faceY, 0.02);
    g.add(white);
  } else if (kind === 'priority') {
    const white = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, side: dbl }));
    white.position.set(0, faceY, 0);
    white.rotation.z = Math.PI / 4;
    white.castShadow = true;
    g.add(white);
    const yellow = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), new THREE.MeshStandardMaterial({ color: 0xf2c40a, roughness: 0.5, side: dbl }));
    yellow.position.set(0, faceY, 0.02);
    yellow.rotation.z = Math.PI / 4;
    g.add(yellow);
  }
  return g;
}

function placeSign(scene, kind, x, z, yaw) {
  const s = buildSign(kind);
  s.position.set(x, 0, z);
  s.rotation.y = yaw;
  scene.add(s);
}

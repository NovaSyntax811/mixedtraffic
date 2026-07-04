// Entry point: wires scene, actors, audio, scenarios, cameras, input, UI, logging.
import * as THREE from 'three';
import { createScene, LAYOUT } from './scene.js?v=48';
import { AV } from './vehicle.js?v=36';
import { Pedestrian, NpcPedestrian, Cyclist, MergingCar, HumanCar, TrafficManager } from './actors.js?v=55';
import { EHMISound } from './audio.js?v=17';
import { BehaviorLogger, showConfidenceCheck } from './logger.js?v=15';
import { ScenarioRunner } from './scenarios.js?v=57';

const { scene, camera, renderer, composer, setTimeOfDay } = createScene();

// Each scenario gets its own time of day so the scene stays legible and
// distinct. Night is reserved for the audio-only study (screen is blacked
// out anyway); the eHMI glow reads best at dusk for the mixed-traffic scene.
const SCENARIO_LIGHTING = {
  1: 'day',          // Baseline — clear daylight, easy to read
  2: 'afternoon',    // Pedestrian crossing
  3: 'overcast',     // Edge case — flat, slightly tense
  4: 'day',          // Merge
  5: 'dusk',         // Mixed traffic — emergency lights pop
  6: 'afternoon',    // Aggressive drivers
  9: 'afternoon',    // Ambiguous signal
  walk: 'afternoon', // Free-roam finale — neutral daylight
};

// Briefing shown before each run. DELIBERATELY UNBIASED for the study: each
// briefing only introduces who is present, never what will happen, which theme
// a scenario probes, or how the signals should be read. Scenarios 2, 3 and 6
// share an identical briefing on purpose — any difference between them would
// itself be a cue that "something is different this time".
const SCENARIO_RECAP = {
  1: { title: 'Scenario 1', lines: [['🚗 A car', 'is driving along the main road'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  2: { title: 'Scenario 2', lines: [['🚐 An automated car', 'is driving along the main road. It communicates with a light band, a windshield display and sound'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  3: { title: 'Scenario 3', lines: [['🚐 An automated car', 'is driving along the main road. It communicates with a light band, a windshield display and sound'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  4: { title: 'Scenario 4', lines: [['🚐 An automated car', 'is driving along the main road. It communicates with a light band, a windshield display and sound'], ['🚗 Another car', 'is waiting at the side street'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  5: { title: 'Scenario 5', lines: [['🚌 Traffic', 'buses, trucks and bikes share the street'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  6: { title: 'Scenario 6', lines: [['🚐 An automated car', 'is driving along the main road. It communicates with a light band, a windshield display and sound'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  9: { title: 'Scenario 9', lines: [['🚐 An automated car', 'is driving along the main road. It communicates with a light band, a windshield display and sound'], ['🚶 Other people', 'are waiting near the street'], ['🚶 You', 'want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross']] },
  // Free-roam finale: instructions only, no hint that situations are staged
  // along the way or which themes they carry.
  walk: { title: 'Free walk', lines: [['🚶 You', 'take a walk through town: W to walk where you look, mouse to turn'], ['🟦 Glowing fields', 'mark where your walk continues; step into one and see what happens'], ['🤝 Crossing is your call', 'cross the street whenever you choose, on whichever side you like']] },
};
// Show the centered "who's who" briefing for a scenario; the run starts when
// the user confirms (recapStart). Falls back to running directly if there is
// no briefing for that scenario.
let pendingScenario = null;
function showBriefing(scenario) {
  const r = SCENARIO_RECAP[scenario];
  if (!r) { beginRun(scenario); return; }
  pendingScenario = scenario;
  $('recapTitle').textContent = r.title;
  $('recapBody').innerHTML = r.lines
    .map(([who, what]) => `<div class="recap-line"><span class="who">${who}</span>: ${what}</div>`)
    .join('');
  $('recap').classList.remove('hidden');
}
const av = new AV(scene);
const pedestrian = new Pedestrian(scene);
const cyclist = new Cyclist(scene);
const mergingCar = new MergingCar(scene);
const humanCar = new HumanCar(scene);
const traffic = new TrafficManager(scene);
// Background pedestrians for the ambiguous-signal scenario
const npcs = [new NpcPedestrian(scene, 0x4a7a8a), new NpcPedestrian(scene, 0x8a6a4a)];
const sound = new EHMISound();
const logger = new BehaviorLogger();

const hudMsg = document.getElementById('hudMsg');
const phaseLabel = document.getElementById('phaseLabel');

const runner = new ScenarioRunner({
  av, humanCar, pedestrian, cyclist, mergingCar, traffic, npcs, sound, logger,
  onPhase: (p) => { phaseLabel.textContent = p; },
  onMessage: (m) => { hudMsg.textContent = m; },
  onComplete: async () => {
    const run = logger.finishRun(); // snapshot now — a new run may start while the dialog is open
    setBlackout(false);             // restore vision for the dialog (audio-only study)
    sound.stopDistractor();
    sound.audioOnlyBoost = false;
    // The confidence check can be switched off in the admin menu (e.g. when a
    // focus-group session runs long and the probes happen verbally instead).
    if ($('toggleConfidence').checked) {
      const answers = await showConfidenceCheck(!!run?.crossed);
      logger.completeRun(run, answers);
    } else {
      logger.completeRun(run, null);
    }
    hudMsg.textContent = 'Thank you. You can walk around, the next situation will start in a moment.';
  },
});

// ---------- Input ----------
const keys = new Set();
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (MOVE_KEYS.includes(e.code)) e.preventDefault(); // no page scroll / button re-trigger
  keys.add(e.code);
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') resetFpvLook();
  if (e.code === 'KeyO') toggleAdmin();
  if (e.code === 'Escape') { setRecordMode(false); toggleAdmin(false); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// Movement tailored to the active perspective. W/↑ is always "straight
// forward on screen", S/↓ backward, A/D sideways:
//  - First-person & cinematic: the FPV view faces across the street and is
//    stable, so the mapping is fixed (W = across, no drift while walking).
//  - Observer: the camera sits at a fixed offset, so movement is derived
//    from the camera axes (W = up the screen).
function moveDir() {
  const input = new THREE.Vector2(); // x = right on screen, y = forward
  if (keys.has('KeyW') || keys.has('ArrowUp')) input.y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) input.y -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) input.x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) input.x += 1;
  if (input.lengthSq() === 0) return input;
  input.normalize();

  if (camMode === 'observer') {
    // Camera-relative (camera yaw is constant in this mode)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();
    const world = new THREE.Vector3()
      .addScaledVector(fwd, input.y)
      .addScaledVector(right, input.x);
    return new THREE.Vector2(world.x, world.z).normalize();
  }

  // FPV (and cinematic): movement follows the current head direction —
  // W walks where you look, A/D strafe relative to it.
  const yaw = camMode === 'cinematic' ? FPV_YAW : fpvYaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = -Math.cos(yaw), rz = Math.sin(yaw); // screen-right on the ground
  return new THREE.Vector2(fx * input.y + rx * input.x, fz * input.y + rz * input.x).normalize();
}

// ---------- Cameras ----------
const camModes = ['pedestrian', 'cyclist', 'observer', 'cinematic'];
let camMode = 'pedestrian';
let cinT = 0;

function setCamera(mode) {
  camMode = mode;
  document.querySelectorAll('#camerabar [data-cam]').forEach((b) =>
    b.classList.toggle('active', b.dataset.cam === mode));
  pedestrian.speed = mode === 'cyclist' ? 4.0 : 1.5; // cyclist embodiment is faster
}
function cycleCamera() {
  setCamera(camModes[(camModes.indexOf(camMode) + 1) % camModes.length]);
}
document.querySelectorAll('#camerabar [data-cam]').forEach((b) =>
  b.addEventListener('click', () => setCamera(b.dataset.cam)));

// The vehicle the interaction centers on: the human car in the baseline
// scenario (it is only visible then), otherwise the AV.
function focusVehicle() { return humanCar.group.visible ? humanCar : av; }

// ---------- First-person mouse look ----------
// Drag the mouse to turn the head in first person; R re-centers the view.
const FPV_YAW = Math.PI / 2; // default: facing across the street
let fpvYaw = FPV_YAW;
let fpvPitch = 0;
let lookDragging = false;
let lastMouse = { x: 0, y: 0 };

renderer.domElement.addEventListener('mousedown', (e) => {
  if (camMode !== 'pedestrian' && camMode !== 'cyclist') return;
  lookDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
  renderer.domElement.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!lookDragging) return;
  fpvYaw -= (e.clientX - lastMouse.x) * 0.005;
  fpvPitch = THREE.MathUtils.clamp(fpvPitch - (e.clientY - lastMouse.y) * 0.004, -0.9, 0.9);
  lastMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', () => {
  lookDragging = false;
  renderer.domElement.style.cursor = '';
});
function resetFpvLook() { fpvYaw = FPV_YAW; fpvPitch = 0; }

function updateCamera(dt) {
  const p = pedestrian.group.position;
  const isFPV = camMode === 'pedestrian' || camMode === 'cyclist';
  // Hide the player model in first person so no body parts block the view
  pedestrian.group.visible = !isFPV;
  if (isFPV) {
    // First-person view: gaze controlled by mouse drag (yaw + pitch),
    // stable otherwise — it never swings away on its own. R re-centers.
    const eye = camMode === 'cyclist' ? 1.9 : 1.6;
    camera.position.lerp(new THREE.Vector3(p.x, eye, p.z), Math.min(1, dt * 12));
    const cp = Math.cos(fpvPitch);
    const target = new THREE.Vector3(
      p.x + Math.sin(fpvYaw) * cp * 5,
      eye + Math.sin(fpvPitch) * 5,
      p.z + Math.cos(fpvYaw) * cp * 5);
    const m = new THREE.Matrix4().lookAt(camera.position, target, new THREE.Vector3(0, 1, 0));
    camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, dt * (lookDragging ? 14 : 6)));
  } else if (camMode === 'observer') {
    // Player-centered: follow the pedestrian from a raised offset
    camera.position.lerp(new THREE.Vector3(p.x + 10, 9, p.z + 10), Math.min(1, dt * 3));
    camera.lookAt(p.x, 1.0, p.z);
  } else if (camMode === 'cinematic') {
    // Smooth orbiting dolly, biased toward the player
    cinT += dt * 0.12;
    const focus = new THREE.Vector3()
      .addScaledVector(focusVehicle().group.position, 0.3)
      .addScaledVector(p, 0.7)
      .setY(1.0);
    const r = 13;
    const want = new THREE.Vector3(
      focus.x + Math.sin(cinT) * r,
      4.5 + Math.sin(cinT * 0.7) * 1.5,
      focus.z + Math.cos(cinT) * r
    );
    camera.position.lerp(want, Math.min(1, dt * 1.5));
    camera.lookAt(focus);
  }
}

// ---------- UI bindings ----------
const $ = (id) => document.getElementById(id);

// ---------- Scenario menu + study modes ----------
// Participant-facing labels are number-only: the descriptive titles gave the
// twist away ("The car missed a cyclist"). The researcher mapping lives in
// DOCUMENTATION.md, not in the UI the group can see.
const SCENARIO_LABELS = {
  1: 'Scenario 1', 2: 'Scenario 2', 3: 'Scenario 3',
  4: 'Scenario 4', 5: 'Scenario 5', 6: 'Scenario 6', 9: 'Scenario 9',
  walk: 'Free walk',
};
let selectedScenario = 1;
let protocol = null; // { step, total } while the trust protocol is running

function setBlackout(on) { $('blackout').classList.toggle('hidden', !on); }

// Core run starter: configures the study modes that belong to the scenario.
function beginRun(scenario, { quietEdge = false, protocolStep = null } = {}) {
  sound.init(); // requires a user gesture — menu/start clicks provide one
  sound.setVolume(parseFloat($('volume').value));
  runner.approachSpeed = parseFloat($('avSpeed').value);

  setTimeOfDay(SCENARIO_LIGHTING[scenario] || 'afternoon'); // per-scenario lighting

  // The continuous walk keeps traffic light (only each station's scripted
  // actors), starts the player in first person facing up the street, and clears
  // any leftover ambiguous-scenario NPCs. Other scenarios honour the toggle.
  traffic.setEnabled(scenario === 'walk' ? false : $('toggleTraffic').checked);
  if (scenario === 'walk') {
    setCamera('pedestrian');
    fpvYaw = 0;        // face north (+Z), so W walks up the street
    fpvPitch = 0;
  }

  $('recap').classList.add('hidden'); // briefing (if any) already confirmed

  logger.nextMeta = {
    soundVolume: sound.volume,
    ...(scenario === 9 ? { mode: 'ambiguous_signal' } : {}),
    ...(protocolStep !== null ? { protocolStep } : {}),
  };
  runner.start(scenario);
  runner.quietEdge = quietEdge; // set after start() (which resets the flag)
}

function startSelected() {
  protocol = null;
  showBriefing(selectedScenario); // centered "who's who" → Start scenario (walk included)
}

// Trust protocol: identical-looking runs; the last one silently swaps in the
// unaddressed-cyclist edge case. Messages must not give it away.
function nextProtocolRun() {
  const edge = protocol.step === protocol.total - 1;
  beginRun(edge ? 3 : 2, { quietEdge: true, protocolStep: protocol.step + 1 });
  hudMsg.textContent = `Run ${protocol.step + 1} of ${protocol.total}. Cross when you feel safe (W/↑).`;
}

// First-run intro: 3 paged steps, then open the scenario menu so the
// participant starts by deliberately picking scenario 1.
let introStep = 1;
const INTRO_STEPS = 3;
function renderIntroStep() {
  document.querySelectorAll('.intro-step').forEach((el) => {
    el.hidden = parseInt(el.dataset.step, 10) !== introStep;
  });
  document.querySelectorAll('.intro-dots i').forEach((d) => {
    d.classList.toggle('on', parseInt(d.dataset.dot, 10) === introStep);
  });
  $('introBack').hidden = introStep === 1;
  $('introNext').hidden = introStep === INTRO_STEPS;
  $('introStart').hidden = introStep !== INTRO_STEPS;
}
$('recapStart').addEventListener('click', () => {
  $('recap').classList.add('hidden');
  if (pendingScenario !== null) beginRun(pendingScenario);
});
$('recapCancel').addEventListener('click', () => {
  $('recap').classList.add('hidden');
  $('scenarioMenu').classList.remove('hidden');
});
$('introNext').addEventListener('click', () => { if (introStep < INTRO_STEPS) { introStep++; renderIntroStep(); } });
$('introBack').addEventListener('click', () => { if (introStep > 1) { introStep--; renderIntroStep(); } });
$('introStart').addEventListener('click', () => {
  $('introDialog').classList.add('hidden');
  $('scenarioMenu').classList.remove('hidden');
});

// Public scenario menu (☰). Its cards are as debiased as everything else:
// neutral titles, one shared description for the study scenarios, nothing
// that reveals what will happen.
$('menuBtn').addEventListener('click', () => $('scenarioMenu').classList.remove('hidden'));
$('menuClose').addEventListener('click', () => $('scenarioMenu').classList.add('hidden'));
document.querySelectorAll('#scenarioMenu .scenario-card').forEach((card) => {
  card.addEventListener('click', () => {
    const v = card.dataset.scenario;
    selectedScenario = /^\d+$/.test(v) ? parseInt(v, 10) : v;
    $('scenarioLabel').textContent = SCENARIO_LABELS[selectedScenario];
    $('scenarioMenu').classList.add('hidden');
    startSelected();
  });
});

// The admin menu keeps its own start buttons for moderated sessions.
document.querySelectorAll('#adminMenu [data-scn]').forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.dataset.scn;
    selectedScenario = /^\d+$/.test(v) ? parseInt(v, 10) : v; // 'walk' stays a string id
    $('scenarioLabel').textContent = SCENARIO_LABELS[selectedScenario];
    toggleAdmin(false);
    startSelected();
  });
});

// Moderator control: end the current scenario immediately (back to idle, the
// participant can roam) without starting a new one.
$('stopBtn').addEventListener('click', () => {
  setBlackout(false);
  sound.stopDistractor();
  runner.reset();
  toggleAdmin(false);
});

// ---------- Admin menu (researcher controls + recording) ----------
function toggleAdmin(force) {
  const m = $('adminMenu');
  const show = force ?? m.classList.contains('hidden');
  m.classList.toggle('hidden', !show);
}
$('adminBtn').addEventListener('click', () => toggleAdmin());
$('adminClose').addEventListener('click', () => toggleAdmin(false));
// Restart re-runs the current scenario from the beginning (no briefing).
// Picking a scenario from the menu is the only way to start a new one.
$('restartBtn').addEventListener('click', () => {
  setBlackout(false);
  sound.stopDistractor();
  beginRun(selectedScenario);
});

$('avSpeed').addEventListener('input', (e) => {
  runner.approachSpeed = parseFloat(e.target.value);
  $('avSpeedVal').textContent = `${e.target.value} m/s`;
});
$('volume').addEventListener('input', (e) => sound.setVolume(parseFloat(e.target.value)));
$('bandBrightness').addEventListener('input', (e) => { av.brightness = parseFloat(e.target.value); });
$('toggleTraffic').addEventListener('change', (e) => traffic.setEnabled(e.target.checked));
$('toggleCyclist').addEventListener('change', (e) => e.target.checked ? cyclist.start() : cyclist.hide());
$('toggleCar').addEventListener('change', (e) => e.target.checked ? mergingCar.spawnWaiting() : mergingCar.hide());
$('downloadLog').addEventListener('click', () => logger.download());

// Record mode: hide all UI for clean screen recordings (Esc exits)
function setRecordMode(on) { document.body.classList.toggle('recording', on); }
$('recordBtn').addEventListener('click', () => { toggleAdmin(false); setRecordMode(true); });

// ---------- Accident system ----------
// Any actual collision (vehicle/cyclist/pedestrian) triggers a crash: sound,
// log entry, frozen scenario, and a pop-up dialog.
let accidentShown = false;

function triggerAccident(a, b) {
  if (accidentShown) return;
  accidentShown = true;
  sound.playCrash();
  logger.event('accident', { between: [a, b] });
  runner.haltForAccident();
  document.getElementById('accidentText').textContent =
    `There was an accident: the ${a} collided with the ${b}.`;
  document.getElementById('accidentDialog').classList.remove('hidden');
}

$('accidentOk').addEventListener('click', () => {
  document.getElementById('accidentDialog').classList.add('hidden');
  logger.abortRun('accident');
  const wasProtocol = !!protocol;
  protocol = null;
  setBlackout(false);
  sound.stopDistractor();
  runner.reset();
  if (wasProtocol) hudMsg.textContent = 'The repeated crossings ended in an accident. Download the log.';
  // clear ambient traffic so a crashed pair doesn't re-trigger immediately
  const trafficWasOn = traffic.enabled;
  traffic.setEnabled(false);
  traffic.setEnabled(trafficWasOn);
  accidentShown = false;
});

// Pedestrian vs. every vehicle, using oriented bounding boxes: a moving
// vehicle hitting the pedestrian is an accident (pedestrian falls); a parked
// one just blocks the way (pedestrian is pushed out instead of clipping).
function checkPedestrianCollisions() {
  if (pedestrian.fallen) return;
  const p = pedestrian.group.position;
  const pr = 0.35;
  const boxes = [];
  if (av.group.visible) boxes.push({ name: 'AV', pos: av.group.position, rotY: av.group.rotation.y, hw: 1.05, hl: 2.25, speed: Math.abs(av.speed) });
  if (humanCar.group.visible) boxes.push({ name: 'car', pos: humanCar.group.position, rotY: humanCar.group.rotation.y, hw: 0.95, hl: 2.05, speed: Math.abs(humanCar.speed) });
  // Speed counts only when the merging car actually advances this frame: a
  // merging car that has braked for someone must block them, not "hit" them.
  if (mergingCar.group.visible) boxes.push({ name: 'car', pos: mergingCar.group.position, rotY: mergingCar.group.rotation.y, hw: 0.95, hl: 2.05, speed: mergingCar.state === 'merging' && mergingCar.moving ? 3 : 0 });
  for (const c of traffic.cars) boxes.push({ name: c.kind ?? 'car', pos: c.mesh.position, rotY: c.mesh.rotation.y, hw: c.hw ?? 0.95, hl: c.hl ?? 2.05, speed: Math.abs(c.speed) });

  for (const v of boxes) {
    const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
    const cos = Math.cos(v.rotY), sin = Math.sin(v.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const penX = v.hw + pr - Math.abs(lx);
    const penZ = v.hl + pr - Math.abs(lz);
    if (penX <= 0 || penZ <= 0) continue; // no overlap
    if (v.speed > 0.8) {
      pedestrian.fall();
      triggerAccident(v.name, 'pedestrian');
    } else if (penX < penZ) { // push out sideways
      const s = Math.sign(lx) || 1;
      p.x += s * penX * cos;
      p.z -= s * penX * sin;
    } else {                  // push out lengthwise
      const s = Math.sign(lz) || 1;
      p.x += s * penZ * sin;
      p.z += s * penZ * cos;
    }
  }
}

// Vehicle-vs-vehicle accidents (traffic cars, AV, human car, merging car):
// if anything behaves unusually and two vehicles actually collide, it is an
// accident. Each car body is approximated by a front and a rear circle.
function checkVehicleCollisions() {
  const bodies = [];
  if (av.group.visible) bodies.push({ name: 'AV', g: av.group, hl: 2.05, speed: Math.abs(av.speed), stop: () => { av.targetSpeed = 0; av.speed = 0; } });
  if (humanCar.group.visible) bodies.push({ name: 'car', g: humanCar.group, hl: 2.05, speed: Math.abs(humanCar.speed), stop: () => { humanCar.targetSpeed = 0; humanCar.speed = 0; } });
  if (mergingCar.group.visible) bodies.push({ name: 'merging car', g: mergingCar.group, hl: 2.05, speed: mergingCar.state === 'merging' && mergingCar.moving ? 3 : 0, stop: () => { mergingCar.state = 'waiting'; } });
  // Scripted aggressive cars (honking tailgater / oncoming) perform a
  // choreographed near-miss overtake into the oncoming lane — that is the
  // point of the scenario. They must not register as a car–car accident
  // (they would otherwise clip oncoming traffic by ~0.3m). They can still hit
  // the pedestrian (checkPedestrianCollisions handles that danger).
  for (const c of traffic.cars) bodies.push({ name: c.kind ?? 'car', g: c.mesh, hl: c.hl ?? 2.05, speed: Math.abs(c.speed), aggressive: !!(c.overtakeAV || c.honkWhenBlocked || c.siren), stop: () => { c.speed = 0; c.cruise = 0; } });

  // Contact needs real body overlap: queued traffic stands well apart
  // (circle gap ≥1.7), a T-bone hit reaches gap ~1.25 — threshold sits between.
  const CONTACT = 1.4;
  // Circle centers spread along the vehicle axis (long vehicles get more),
  // spaced ≤ ~1.3m so there is no gap a crossing car could slip through.
  const circles = (b) => {
    const span = Math.max(0, b.hl - 0.8);
    const count = Math.max(3, Math.round(span / 0.65) + 1);
    const fwd = new THREE.Vector3(Math.sin(b.g.rotation.y), 0, Math.cos(b.g.rotation.y));
    const out = [];
    for (let k = 0; k < count; k++) {
      const off = -span + (2 * span) * (k / (count - 1));
      out.push(b.g.position.clone().addScaledVector(fwd, off));
    }
    return out;
  };

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.speed < 0.8 && b.speed < 0.8) continue; // both standing — no crash
      if (a.aggressive || b.aggressive) continue;   // choreographed near-miss, not a crash
      const ca = circles(a), cb = circles(b);
      let hit = false;
      for (const p of ca) for (const q of cb) if (p.distanceTo(q) < CONTACT) hit = true;
      if (!hit) continue;
      a.stop();
      b.stop();
      triggerAccident(a.name, b.name);
      return;
    }
  }
}

// ---------- Main loop ----------
// Aggressive / emergency traffic events
traffic.onHonk = (car) => {
  sound.playHorn();
  logger.event('honk', { kind: car.kind });
};
traffic.onOvertake = (car) => {
  logger.event('aggressive_overtake_started', { kind: car.kind });
  // No HUD warning: the horn and the swerving car are the only cues, so the
  // participant's own attention (not a caption) decides whether they notice.
};

// Collision / hard-brake events from the cyclist (scenario 3 edge case)
cyclist.onEvent = (name, data) => {
  if (name === 'collision') {
    if (data.with === 'pedestrian') pedestrian.fall();
    triggerAccident('cyclist', data.with);
  } else if (name === 'cyclist_hard_brake') {
    logger.event('cyclist_hard_brake', data);
  }
};

// Debug/scripting handle (used for automated testing; harmless in production)
window.__sim = { runner, av, humanCar, pedestrian, cyclist, mergingCar, traffic, sound, logger, setCamera, camera, moveDir, keys, checkPedestrianCollisions, checkVehicleCollisions, updateCamera, renderer, resetFpvLook,
  getFpvLook: () => ({ yaw: fpvYaw, pitch: fpvPitch }),
  npcs, beginRun, startSelected, getProtocol: () => protocol,
  setSelected: (v) => { selectedScenario = v; },
  isLookingAtVehicle: () => lastLookingAtVehicle };

const clock = new THREE.Clock();
const ROAD_HALF = LAYOUT.roadWidth / 2;
let sirenWasActive = false;
let lastLookingAtVehicle = false;

// ---------- Free-roam trigger fields ----------
// Logic adapted from Julius's branch: between encounters a pulsing field marks
// where to go next; stepping into it starts the next situation. One field on
// EACH pavement, so after crossing at a station the player can carry on up
// whichever side they ended on (side changes stay supported).
function buildTriggerZone(x) {
  const g = new THREE.Group();
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x00d8ff, transparent: true, opacity: 0.3, depthWrite: false });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  g.add(fill);
  const borderPts = [
    new THREE.Vector3(-1.3, 0, -1.5), new THREE.Vector3(1.3, 0, -1.5),
    new THREE.Vector3(1.3, 0, 1.5), new THREE.Vector3(-1.3, 0, 1.5),
    new THREE.Vector3(-1.3, 0, -1.5),
  ];
  const borderMat = new THREE.LineBasicMaterial({ color: 0x00d8ff });
  const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(borderPts), borderMat);
  border.position.y = 0.02;
  g.add(border);
  const zonePt = new THREE.PointLight(0x00d8ff, 0, 7, 2);
  zonePt.position.set(0, 1.5, 0);
  g.add(zonePt);
  g.position.set(x, 0, 0);
  g.visible = false;
  scene.add(g);
  return { g, fillMat, borderMat, zonePt };
}
const ZONE_X = LAYOUT.roadWidth / 2 + 1.5; // pavement centre on either side
const triggerZones = [buildTriggerZone(-ZONE_X), buildTriggerZone(ZONE_X)];
let zoneElapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  pedestrian.update(dt, moveDir());
  av.update(dt);
  humanCar.update(dt);
  for (const n of npcs) n.update(dt);

  // Obstacle lists so nothing clips through anything: the cyclist avoids (or
  // crashes into) everyone, traffic cars brake for everyone.
  const baseObstacles = [
    { pos: pedestrian.group.position, r: 0.8, name: 'pedestrian' },
  ];
  for (const n of npcs) if (n.group.visible) baseObstacles.push({ pos: n.group.position, r: 0.8, name: 'pedestrian' });
  if (av.group.visible) baseObstacles.push({ pos: av.group.position, r: 1.9, name: 'AV' });
  if (humanCar.group.visible) baseObstacles.push({ pos: humanCar.group.position, r: 1.9, name: 'car' });
  if (mergingCar.group.visible) baseObstacles.push({ pos: mergingCar.group.position, r: 1.8, name: 'car' });
  const trafficObstacles = [...baseObstacles];
  if (cyclist.active) trafficObstacles.push({ pos: cyclist.group.position, r: 0.9, name: 'cyclist' });

  const p = pedestrian.group.position;
  const inRoad = Math.abs(p.x) < ROAD_HALF;
  const inZone = (v) => Math.abs(v.x) < 7 && Math.abs(v.z) < 7;
  const zoneOccupiedExternal = (av.group.visible && inZone(av.group.position))
    || (humanCar.group.visible && inZone(humanCar.group.position))
    || (cyclist.active && inZone(cyclist.group.position))
    || (mergingCar.group.visible && inZone(mergingCar.group.position));

  // Zebra stop rule applies to the player AND any NPC pedestrian on the road
  const pedInRoadAny = inRoad
    || npcs.some((n) => n.group.visible && Math.abs(n.group.position.x) < ROAD_HALF);

  cyclist.update(dt, [...baseObstacles, ...traffic.cars.map((c) => ({ pos: c.mesh.position, r: c.r ?? 1.8, name: 'car' }))]);
  traffic.update(dt, { obstacles: trafficObstacles, pedInRoad: pedInRoadAny, zoneOccupiedExternal, avPos: av.group.position, avVisible: av.group.visible });

  // Siren audio follows whether an emergency vehicle is on scene
  const sirenActive = traffic.cars.some((c) => c.siren);
  if (sirenActive && !sirenWasActive) sound.startSiren();
  if (!sirenActive && sirenWasActive) sound.stopSiren();
  sirenWasActive = sirenActive;
  // Merging car must not run over a standing/walking pedestrian — feed it the
  // pedestrian + NPCs as obstacles so it waits instead of crashing through.
  const pedObstacles = [{ pos: pedestrian.group.position, r: 0.8, name: 'pedestrian' }];
  for (const n of npcs) if (n.group.visible) pedObstacles.push({ pos: n.group.position, r: 0.8, name: 'pedestrian' });
  mergingCar.update(dt, pedObstacles);
  runner.update(dt);

  // Free-roam trigger fields: pulse while the walk waits for the player, and
  // start the next encounter when they step into either kerbside field.
  {
    const awaitZ = runner.walkAwaitZ ?? null;
    const zonesActive = awaitZ !== null && runner.running;
    for (const zn of triggerZones) zn.g.visible = zonesActive;
    if (zonesActive) {
      zoneElapsed += dt;
      const beat = Math.pow(0.5 + 0.5 * Math.sin(zoneElapsed * Math.PI * 2.5), 3);
      const bright = 1.0 + 3.5 * beat;
      for (const zn of triggerZones) {
        zn.g.position.z = awaitZ;
        zn.fillMat.opacity = 0.08 + 0.38 * beat;
        zn.borderMat.color.setRGB(0, 0.85 * bright, bright);
        zn.zonePt.intensity = 7 * beat;
      }
      if (Math.abs(Math.abs(p.x) - ZONE_X) < 1.4 && Math.abs(p.z - awaitZ) < 1.6) {
        runner.walkEnterZone();
      }
    } else {
      zoneElapsed = 0;
      for (const zn of triggerZones) zn.zonePt.intensity = 0;
    }
  }

  checkPedestrianCollisions();
  checkVehicleCollisions();
  updateCamera(dt);

  // Behavioral logging tick (vehicle distance = AV, or human car in baseline).
  // Gaze proxy: in first person, is the head turned toward the vehicle (±30°)?
  const avDist = focusVehicle().group.position.distanceTo(p);
  const isFPVNow = camMode === 'pedestrian' || camMode === 'cyclist';
  let lookingAtVehicle = false;
  if (isFPVNow) {
    const toV = new THREE.Vector3().subVectors(focusVehicle().group.position, camera.position);
    toV.y = 0;
    if (toV.lengthSq() > 0.01) {
      toV.normalize();
      const gaze = camera.getWorldDirection(new THREE.Vector3());
      gaze.y = 0;
      gaze.normalize();
      lookingAtVehicle = toV.dot(gaze) > 0.866; // cos 30°
    }
  }
  lastLookingAtVehicle = lookingAtVehicle;
  logger.tick(inRoad, pedestrian.moving, avDist, lookingAtVehicle, dt * 1000);

  // Sound update with camera-relative panning
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  sound.update(av.group.position, camera.position, camRight, av.speed, av.targetSpeed < av.speed - 0.3);

  composer.render();
}
animate();

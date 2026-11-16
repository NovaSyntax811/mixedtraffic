// WebXR layer for standalone headsets (built for Meta Quest 3, Quest Browser).
//
// What it adds on top of the desktop simulation:
//   - a camera RIG so the headset pose rides on the virtual pedestrian;
//     physical head movement moves the pedestrian 1:1, the left thumbstick
//     walks (head-relative), the right thumbstick snap-turns (30 degrees)
//   - an in-world HUD line for the instruction text
//   - an in-world FORM PANEL operated with a controller ray and the trigger,
//     so Likert / choice / semantic-differential questionnaires can be answered
//     without leaving VR (DOM overlays are invisible in an immersive session)
//   - session bookkeeping: quality switch, frame-rate sampling, start/end hooks
//
// Free text and number entry are deliberately NOT done in VR: forms containing
// such items make the flow leave VR first (see logger.js showForm).
//
// ?vrdebug=1 shows the panels on the desktop and drives them with the mouse,
// which is how this file is tested without a headset.
import * as THREE from 'three';

const PW = 1024, PH = 768;           // form panel canvas (px)
const HW = 1024, HH = 224;           // HUD canvas (px)
const SNAP = Math.PI / 6;            // snap-turn step
const DEADZONE = 0.18;

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrapLines(c, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (c.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

function makePanel(wPx, hPx, wM, hM) {
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wM, hM),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, fog: false })
  );
  mesh.renderOrder = 999; // always on top: a question must never hide behind a car
  mesh.visible = false;
  return { canvas, ctx, tex, mesh };
}

export function setupVR({ scene, camera, renderer, setVRMode, debugDesktop = false }) {
  const rig = new THREE.Group();
  rig.name = 'vrRig';
  scene.add(rig);
  rig.add(camera); // identity rig outside VR, so desktop behaviour is unchanged

  renderer.xr.enabled = true;
  renderer.xr.setFoveation(0.6);

  const st = {
    rigYaw: 0,          // world yaw of the tracking space
    eyeHeight: null,    // optional forced eye height (seated participants)
    rigY: 0,
    lastHead: null,     // head position in tracking space, previous frame
    snapArmed: true,
    stick: new THREE.Vector2(),
    fakeHead: null,     // test hook: { pos: Vector3, yaw }
    startCbs: [], endCbs: [],
    fps: { acc: 0, frames: 0, samples: [] },
  };

  const immersive = () => renderer.xr.isPresenting === true;
  const uiActive = () => immersive() || debugDesktop;

  // ---- head pose -----------------------------------------------------------
  // Tracking-space pose of the head = the user camera's LOCAL pose (three
  // writes the XR pose there, relative to the rig, on every render).
  const _dir = new THREE.Vector3();
  function headLocal() {
    if (st.fakeHead) return st.fakeHead;
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    return { pos: camera.position, yaw: Math.atan2(_dir.x, _dir.z) };
  }
  // World yaw convention used across the app: forward = (sin yaw, cos yaw).
  const headWorldYaw = () => headLocal().yaw + st.rigYaw;
  function headWorldPitch() {
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    return Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
  }
  const _wp = new THREE.Vector3(), _wd = new THREE.Vector3();
  const headWorldPos = () => camera.getWorldPosition(_wp);
  function headWorldFwdFlat() {
    camera.getWorldDirection(_wd);
    _wd.y = 0;
    return _wd.lengthSq() > 1e-6 ? _wd.normalize() : _wd.set(0, 0, 1);
  }

  // Rotate a tracking-space offset into world space (rotation about Y).
  function toWorld(x, z, yaw = st.rigYaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: x * c + z * s, z: -x * s + z * c };
  }

  // Physical head movement since the last frame, in world space. The caller
  // adds it to the pedestrian, so real steps and leaning move the avatar 1:1.
  function consumeHeadDelta() {
    const h = headLocal().pos;
    if (!st.lastHead) { st.lastHead = h.clone(); return { x: 0, z: 0 }; }
    const d = toWorld(h.x - st.lastHead.x, h.z - st.lastHead.z);
    st.lastHead.copy(h);
    // A tracking glitch or recentre shows up as a jump: never teleport the avatar.
    return (Math.hypot(d.x, d.z) > 0.5) ? { x: 0, z: 0 } : d;
  }

  // Put the tracking space where it has to be so that the HEAD sits exactly on
  // the pedestrian position (snap turns therefore pivot around the head too).
  function placeRig(p) {
    const h = headLocal().pos;
    const o = toWorld(h.x, h.z);
    if (st.eyeHeight !== null) st.rigY = st.eyeHeight - h.y;
    rig.rotation.set(0, st.rigYaw, 0);
    rig.position.set(p.x - o.x, st.eyeHeight !== null ? st.rigY : 0, p.z - o.z);
  }

  // Turn the world so the participant, as they currently stand, faces `yaw`.
  // The head reference is reset too, so the re-alignment never reads as a step.
  function faceYaw(yaw) { st.rigYaw = yaw - headLocal().yaw; st.lastHead = null; }
  function setEyeHeight(h) { st.eyeHeight = (h === null || !Number.isFinite(h)) ? null : h; }

  // ---- controllers ---------------------------------------------------------
  const gripCbs = [];
  const raycaster = new THREE.Raycaster();
  const _m = new THREE.Matrix4();
  const controllers = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.7 })
    );
    ray.scale.z = 3;
    ray.visible = false;
    c.add(ray);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.11), new THREE.MeshBasicMaterial({ color: 0x3a4660 }));
    body.position.z = 0.04;
    c.add(body);
    c.userData = { ray, hit: null };
    c.addEventListener('selectstart', () => { if (c.userData.hit) c.userData.hit.action(); });
    c.addEventListener('squeezestart', () => { if (!form) for (const fn of gripCbs) fn(); });
    rig.add(c);
    return c;
  });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0x8fe3ff, depthTest: false, toneMapped: false }));
  dot.renderOrder = 1000;
  dot.visible = false;
  scene.add(dot);

  function readSticks() {
    const s = renderer.xr.getSession();
    let mx = 0, my = 0, tx = 0;
    if (s) {
      for (const src of s.inputSources) {
        const a = src.gamepad?.axes;
        if (!a) continue;
        const x = a.length >= 4 ? a[2] : (a[0] ?? 0);
        const y = a.length >= 4 ? a[3] : (a[1] ?? 0);
        if (src.handedness === 'left') { mx = x; my = y; }
        else if (src.handedness === 'right') tx = x;
      }
    }
    const mag = Math.hypot(mx, my);
    if (mag < DEADZONE) st.stick.set(0, 0);
    else st.stick.set(mx, my).multiplyScalar(Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag);
    if (Math.abs(tx) > 0.65 && st.snapArmed) { st.rigYaw -= Math.sign(tx) * SNAP; st.snapArmed = false; }
    else if (Math.abs(tx) < 0.3) st.snapArmed = true;
  }

  // World-space walking vector from the left stick, relative to where the
  // head points. Length < 1 = slower walk. Frozen while a form is open.
  function moveVector() {
    const out = new THREE.Vector2();
    if (form && form.blocking !== false) return out;
    const yaw = headWorldYaw();
    const fwd = -st.stick.y, right = st.stick.x;
    out.set(
      Math.sin(yaw) * fwd - Math.cos(yaw) * right,
      Math.cos(yaw) * fwd + Math.sin(yaw) * right);
    return out;
  }

  // ---- HUD line ------------------------------------------------------------
  const hud = makePanel(HW, HH, 1.5, 1.5 * HH / HW);
  scene.add(hud.mesh);
  let hudText = '', hudAge = 99;
  function drawHud() {
    const c = hud.ctx;
    c.clearRect(0, 0, HW, HH);
    roundRect(c, 4, 4, HW - 8, HH - 8, 30);
    c.fillStyle = 'rgba(14,18,30,0.86)';
    c.fill();
    c.fillStyle = '#e8ecf5';
    c.font = '34px system-ui, -apple-system, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const lines = wrapLines(c, hudText, HW - 90).slice(0, 4);
    lines.forEach((l, i) => c.fillText(l, HW / 2, HH / 2 + (i - (lines.length - 1) / 2) * 44));
    hud.tex.needsUpdate = true;
  }
  function setHudText(t) {
    if (t === hudText) return;
    hudText = t || '';
    hudAge = 0;
    drawHud();
  }

  // ---- form panel ----------------------------------------------------------
  const panel = makePanel(PW, PH, 1.4, 1.4 * PH / PW);
  scene.add(panel.mesh);
  let form = null;       // { mode, title, questions, index, answers, resolve, text, button }
  let hits = [];         // [{ x, y, w, h, action, key }]
  let hoverKey = null;

  function button(c, r, label, { selected = false, font = '34px', key } = {}) {
    const hot = hoverKey === key;
    roundRect(c, r.x, r.y, r.w, r.h, 14);
    c.fillStyle = selected ? '#2d4a7a' : hot ? '#2a3859' : '#1b2438';
    c.fill();
    c.lineWidth = selected || hot ? 4 : 2;
    c.strokeStyle = selected ? '#6fa8ff' : hot ? '#8fb8ff' : 'rgba(120,160,220,0.5)';
    c.stroke();
    c.fillStyle = '#e8ecf5';
    c.font = `${font} system-ui, -apple-system, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2, r.w - 20);
  }

  function drawPanel() {
    const c = panel.ctx, f = form;
    hits = [];
    c.clearRect(0, 0, PW, PH);
    if (!f) { panel.tex.needsUpdate = true; return; }
    roundRect(c, 3, 3, PW - 6, PH - 6, 34);
    c.fillStyle = 'rgba(16,22,38,0.97)';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(120,160,220,0.6)';
    c.stroke();

    c.textBaseline = 'top';
    c.fillStyle = '#9fb4d8';
    c.font = '600 28px system-ui, -apple-system, sans-serif';
    c.textAlign = 'left';
    c.fillText(f.title, 48, 34);

    const addHit = (r, key, action) => hits.push({ ...r, key, action });

    if (f.mode === 'message' || f.mode === 'done') {
      c.fillStyle = '#e8ecf5';
      c.font = '40px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      const lines = wrapLines(c, f.mode === 'done' ? 'All questions answered.' : f.text, PW - 140).slice(0, 8);
      lines.forEach((l, i) => c.fillText(l, PW / 2, 150 + i * 54));
      const r = { x: PW / 2 - 200, y: PH - 210, w: 400, h: 96 };
      button(c, r, f.mode === 'done' ? 'Submit' : f.button, { key: 'ok', font: '600 38px' });
      addHit(r, 'ok', () => finish());
      if (f.mode === 'done') {
        const b = { x: 48, y: PH - 92, w: 190, h: 60 };
        button(c, b, '‹ Back', { key: 'back', font: '28px' });
        addHit(b, 'back', () => { f.mode = 'question'; f.index = f.questions.length - 1; drawPanel(); });
      }
      panel.tex.needsUpdate = true;
      return;
    }

    const q = f.questions[f.index];
    c.textAlign = 'right';
    c.fillText(`${f.index + 1} / ${f.questions.length}`, PW - 48, 34);

    let y = 92;
    if (q.note) {
      c.textAlign = 'left';
      c.fillStyle = '#8a96ad';
      c.font = 'italic 26px system-ui, -apple-system, sans-serif';
      for (const l of wrapLines(c, q.note, PW - 96).slice(0, 2)) { c.fillText(l, 48, y); y += 34; }
      y += 8;
    }
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = '600 40px system-ui, -apple-system, sans-serif';
    for (const l of wrapLines(c, q.label, PW - 96).slice(0, 5)) { c.fillText(l, 48, y); y += 52; }
    y += 26;

    const footer = 104;
    const current = f.answers[q.id];
    if (q.type === 'likert' || q.type === 'sd5') {
      const n = q.type === 'likert' ? 7 : 5;
      const gap = 18;
      const w = Math.min(118, (PW - 96 - (n - 1) * gap) / n);
      const x0 = (PW - (n * w + (n - 1) * gap)) / 2;
      const by = Math.max(y, Math.min(PH - footer - 190, y + 30));
      for (let i = 0; i < n; i++) {
        const r = { x: x0 + i * (w + gap), y: by, w, h: 112 };
        const v = i + 1;
        button(c, r, String(v), { selected: current === v, key: 'o' + v, font: '600 44px' });
        addHit(r, 'o' + v, () => choose(q, v));
      }
      if (q.anchors) {
        c.fillStyle = '#9fb4d8';
        c.font = '26px system-ui, -apple-system, sans-serif';
        c.textBaseline = 'top';
        c.textAlign = 'left';
        c.fillText(q.anchors[0], x0, by + 126, PW / 2 - x0 - 10);
        c.textAlign = 'right';
        c.fillText(q.anchors[1], PW - x0, by + 126, PW / 2 - x0 - 10);
      }
    } else {
      const opts = q.options || [];
      const n = Math.max(1, opts.length), gap = 12;
      const h = Math.min(78, (PH - footer - y - (n - 1) * gap) / n);
      opts.forEach(([value, label], i) => {
        const r = { x: 48, y: y + i * (h + gap), w: PW - 96, h };
        button(c, r, label, { selected: current === value, key: 'o' + i, font: `${Math.min(34, Math.round(h * 0.46))}px` });
        addHit(r, 'o' + i, () => choose(q, value));
      });
    }

    if (f.index > 0) {
      const b = { x: 48, y: PH - 92, w: 190, h: 60 };
      button(c, b, '‹ Back', { key: 'back', font: '28px' });
      addHit(b, 'back', () => { f.index -= 1; drawPanel(); });
    }
    panel.tex.needsUpdate = true;
  }

  function choose(q, value) {
    const f = form;
    if (!f || f.lock) return;
    f.answers[q.id] = value;
    f.lock = true;
    drawPanel(); // show the selection for a moment before moving on
    setTimeout(() => {
      if (form !== f) return;
      f.lock = false;
      hoverKey = null;
      if (f.index < f.questions.length - 1) { f.index += 1; drawPanel(); }
      else if (f.autoSubmit) finish(); // single-choice menus need no Submit step
      else { f.mode = 'done'; drawPanel(); }
    }, 240);
  }

  function finish() {
    const f = form;
    if (!f) return;
    form = null;
    panel.mesh.visible = false;
    dot.visible = false;
    for (const c of controllers) { c.userData.ray.visible = false; c.userData.hit = null; }
    hits = [];
    hoverKey = null;
    f.resolve(f.mode === 'message' ? true : f.answers);
  }

  function openPanel(f) {
    form = f;
    hoverKey = null;
    // In front of the head as it is right now, then fixed in the world.
    const hp = headWorldPos(), fw = headWorldFwdFlat();
    panel.mesh.position.set(hp.x + fw.x * 1.5, hp.y - 0.12, hp.z + fw.z * 1.5);
    panel.mesh.lookAt(hp.x, hp.y - 0.12, hp.z);
    panel.mesh.visible = true;
    for (const c of controllers) c.userData.ray.visible = true;
    drawPanel();
  }

  // Button-only forms (likert / sd5 / choice). `items` is the ordered list as
  // showForm built it; a note applies to the questions that follow it.
  function present(items, title = 'Quick questions', { autoSubmit = false } = {}) {
    return new Promise((resolve) => {
      const questions = [];
      let note = null;
      for (const it of items) {
        if (it.type === 'note') { note = it.label; continue; }
        questions.push({ ...it, note });
      }
      if (!questions.length) { resolve({}); return; }
      openPanel({ mode: 'question', title, questions, index: 0, answers: {}, resolve, autoSubmit });
    });
  }
  // blocking:false keeps walking possible while the panel hangs in the world
  // (used for "start the study when you feel ready" at the end of training).
  function presentMessage(text, buttonLabel = 'Continue', title = '', { blocking = true } = {}) {
    return new Promise((resolve) => openPanel({ mode: 'message', title, text, button: buttonLabel, resolve, blocking }));
  }
  // Tell the participant the VR part is over, then end the session, so the
  // next (text) form can be answered in the ordinary browser window.
  async function leaveForDom() {
    if (immersive()) {
      await presentMessage('This was the part in VR. Press Continue; the last questions follow in the browser window in front of you.', 'Continue');
      await exit();
    }
  }

  function pointAt(origin, direction) {
    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(direction);
    const hit = raycaster.intersectObject(panel.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const px = hit.uv.x * PW, py = (1 - hit.uv.y) * PH;
    const target = hits.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) || null;
    return { point: hit.point, distance: hit.distance, target };
  }

  function updatePointers() {
    if (!form) return;
    let newHover = null, dotAt = null;
    for (const c of controllers) {
      c.userData.hit = null;
      if (!immersive() || !c.visible) continue;
      _m.identity().extractRotation(c.matrixWorld);
      const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      const d = new THREE.Vector3(0, 0, -1).applyMatrix4(_m);
      const res = pointAt(o, d);
      c.userData.ray.scale.z = res ? res.distance : 3;
      if (res) {
        dotAt = res.point;
        if (res.target) { c.userData.hit = res.target; newHover = res.target.key; }
      }
    }
    if (debugDesktop && mouseRay) {
      const res = pointAt(mouseRay.origin, mouseRay.direction);
      mouseHit = res?.target || null;
      if (res) { dotAt = res.point; if (res.target) newHover = res.target.key; }
    }
    dot.visible = !!dotAt;
    if (dotAt) dot.position.copy(dotAt);
    if (newHover !== hoverKey) { hoverKey = newHover; drawPanel(); }
  }

  // Desktop test driver: the mouse stands in for the controller ray.
  let mouseRay = null, mouseHit = null;
  if (debugDesktop) {
    const ndc = new THREE.Vector2();
    const mr = new THREE.Raycaster();
    renderer.domElement.addEventListener('mousemove', (e) => {
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      mr.setFromCamera(ndc, camera);
      mouseRay = { origin: mr.ray.origin.clone(), direction: mr.ray.direction.clone() };
    });
    renderer.domElement.addEventListener('click', () => { if (form && mouseHit) mouseHit.action(); });
  }

  // ---- per-frame -----------------------------------------------------------
  function update(dt, hudString, rawDt = dt) {
    if (immersive()) {
      readSticks();
      st.fps.acc += rawDt; st.fps.frames += 1;
      if (st.fps.acc >= 2) { st.fps.samples.push(Math.round(st.fps.frames / st.fps.acc)); st.fps.acc = 0; st.fps.frames = 0; }
    }
    if (!uiActive()) return;
    if (hudString !== undefined) setHudText(hudString);
    hudAge += dt;
    // HUD: below the line of sight, drifting after the head; hidden while a
    // form is open and a few seconds after the text last changed.
    const showHud = !form && hudText && hudAge < 9;
    hud.mesh.visible = !!showHud;
    if (showHud) {
      const hp = headWorldPos(), fw = headWorldFwdFlat();
      const tx = hp.x + fw.x * 1.7, ty = hp.y - 0.62, tz = hp.z + fw.z * 1.7;
      const k = hudAge < 0.1 ? 1 : Math.min(1, dt * 3.5);
      hud.mesh.position.set(
        hud.mesh.position.x + (tx - hud.mesh.position.x) * k,
        hud.mesh.position.y + (ty - hud.mesh.position.y) * k,
        hud.mesh.position.z + (tz - hud.mesh.position.z) * k);
      hud.mesh.lookAt(hp);
      hud.mesh.material.opacity = Math.min(1, (9 - hudAge) / 1.2);
    }
    updatePointers();
  }

  // ---- session -------------------------------------------------------------
  async function supported() {
    try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { return false; }
  }
  async function enter() {
    if (immersive()) return;
    if (!navigator.xr) {
      throw new Error(window.isSecureContext
        ? 'This browser has no WebXR.'
        : 'WebXR needs a secure page (https, or localhost via USB port forwarding).');
    }
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    await renderer.xr.setSession(session);
  }
  async function exit() {
    const s = renderer.xr.getSession();
    if (s) await s.end();
  }
  renderer.xr.addEventListener('sessionstart', () => {
    // The camera still holds its desktop WORLD pose; neutralise it so the very
    // first frame does not throw the rig far away.
    camera.position.set(0, 1.6, 0);
    camera.quaternion.identity();
    st.lastHead = null;
    st.fps = { acc: 0, frames: 0, samples: [] };
    setVRMode?.(true);
    for (const fn of persistentStart) fn();
    for (const fn of st.startCbs.splice(0)) fn();
  });
  renderer.xr.addEventListener('sessionend', () => {
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    hud.mesh.visible = false;
    setVRMode?.(false);
    // A form that was open in VR cannot be finished there any more.
    if (form && !debugDesktop) {
      const f = form;
      form = null;
      panel.mesh.visible = false;
      dot.visible = false;
      f.resolve(f.mode === 'message' ? true : { ...f.answers, vrInterrupted: true });
    }
    const perf = fpsSummary();
    for (const fn of persistentEnd) fn(perf);
  });
  const persistentStart = [], persistentEnd = [];
  function onSessionStart(fn, { once = false } = {}) { (once ? st.startCbs : persistentStart).push(fn); }
  function onSessionEnd(fn) { persistentEnd.push(fn); }
  function fpsSummary() {
    const s = st.fps.samples;
    if (!s.length) return null;
    return { meanFps: Math.round(s.reduce((a, b) => a + b, 0) / s.length), minFps: Math.min(...s), samples: s.length };
  }

  return {
    rig,
    isImmersive: immersive,
    supported, enter, exit,
    update, moveVector, consumeHeadDelta, placeRig, faceYaw, setEyeHeight,
    headWorldYaw, headWorldPitch,
    onSessionStart, onSessionEnd, fpsSummary,
    onGrip: (fn) => gripCbs.push(fn),
    formOpen: () => !!form,
    // form presenter contract used by logger.js showForm
    presenter: { isPresenting: uiActive, present, presentMessage, leaveForDom },
    presentMessage,
    _test: { st, toWorld, hitsNow: () => hits, formNow: () => form, panel, hud, drawPanel },
  };
}

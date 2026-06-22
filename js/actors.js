// User-controlled pedestrian + secondary actors (cyclist, merging car, ambient traffic).
import * as THREE from 'three';
import { LAYOUT } from './scene.js?v=27';

// Shared obstacle check: is anything in `obstacles` blocking the path ahead?
// Returns the blocking obstacle, or null. `forward` must be normalized (XZ plane).
export function blockingObstacle(pos, forward, obstacles, aheadDist = 7, latBase = 1.2) {
  for (const obs of obstacles) {
    const to = new THREE.Vector3().subVectors(obs.pos, pos);
    to.y = 0;
    const ahead = to.dot(forward);
    // long vehicles (bus/truck) extend obs.r beyond their center — brake earlier
    if (ahead < 0.2 || ahead > aheadDist + (obs.r ?? 0.5)) continue;
    const lateral = to.clone().addScaledVector(forward, -ahead).length();
    if (lateral < latBase + (obs.r ?? 0.5)) return obs;
  }
  return null;
}

export class Pedestrian {
  constructor(scene) {
    this.group = new THREE.Group();
    this.speed = 1.5;       // m/s walking
    this.heading = 0;
    this._walkPhase = 0;
    this.moving = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a77a, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xc6543a, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2e3a55, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 10), shirt);
    torso.position.y = 1.15;
    torso.castShadow = true;
    this.group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    this.group.add(head);

    this.legs = [];
    for (const x of [-0.09, 0.09]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 4, 8), pants);
      leg.position.set(x, 0.48, 0);
      leg.castShadow = true;
      this.group.add(leg);
      this.legs.push(leg);
    }
    this.arms = [];
    for (const x of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), shirt);
      arm.position.set(x, 1.15, 0);
      arm.castShadow = true;
      this.group.add(arm);
      this.arms.push(arm);
    }

    scene.add(this.group);
    this.reset();
  }

  reset() {
    // Curbside at the zebra crossing, west side, facing the street
    const { roadWidth, sidewalk, zebraZ } = LAYOUT;
    this.group.position.set(-(roadWidth / 2 + sidewalk / 2), 0, zebraZ);
    this.heading = Math.PI / 2; // facing +X (across the street)
    this.group.rotation.set(0, this.heading, 0);
    this.moving = false;
    this.fallen = false;
    this._fallT = 0;
  }

  // Knocked over in an accident; stays down until reset
  fall() {
    if (this.fallen) return;
    this.fallen = true;
    this._fallT = 0;
  }

  // move dir: THREE.Vector2 (x = world X, y = world Z), normalized or zero
  update(dt, dir) {
    if (this.fallen) {
      this.moving = false;
      if (this._fallT < 1) {
        this._fallT = Math.min(1, this._fallT + dt / 0.4);
        const e = this._fallT * this._fallT * (3 - 2 * this._fallT);
        this.group.rotation.z = e * 1.35;
      }
      return;
    }
    this.moving = dir.lengthSq() > 0.001;
    if (this.moving) {
      this.group.position.x += dir.x * this.speed * dt;
      this.group.position.z += dir.y * this.speed * dt;
      // Free roam — only keep the player on the ground plane
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -100, 100);
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -100, 100);
      this.heading = Math.atan2(dir.x, dir.y);
      // smooth turn
      const cur = this.group.rotation.y;
      let delta = this.heading - cur;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      this.group.rotation.y = cur + delta * Math.min(1, dt * 10);

      this._walkPhase += dt * 7;
      const sw = Math.sin(this._walkPhase) * 0.45;
      this.legs[0].rotation.x = sw;
      this.legs[1].rotation.x = -sw;
      this.arms[0].rotation.x = -sw * 0.7;
      this.arms[1].rotation.x = sw * 0.7;
    } else {
      for (const l of this.legs) l.rotation.x *= 1 - Math.min(1, dt * 8);
      for (const a of this.arms) a.rotation.x *= 1 - Math.min(1, dt * 8);
    }
  }

  get eyeHeight() { return 1.6; }
}

// ---------------------------------------------------------------------------
// Scripted background pedestrians (not player-controlled). Used for the
// ambiguous-signal scenario: several people wait at the crossing and one of
// them — not the participant — is the actual addressee of the yield signal.
// ---------------------------------------------------------------------------
export class NpcPedestrian {
  constructor(scene, shirtColor = 0x4a7a8a) {
    this.group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a77a, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x39404f, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 10), shirt);
    torso.position.y = 1.15;
    torso.castShadow = true;
    this.group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
    head.position.y = 1.62;
    this.group.add(head);
    this.legs = [];
    for (const x of [-0.09, 0.09]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 4, 8), pants);
      leg.position.set(x, 0.48, 0);
      this.group.add(leg);
      this.legs.push(leg);
    }
    this.arms = [];
    for (const x of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), shirt);
      arm.position.set(x, 1.15, 0);
      this.group.add(arm);
      this.arms.push(arm);
    }

    this.state = 'idle'; // idle | crossing
    this.speed = 1.4;
    this._walkPhase = 0;
    this.group.visible = false;
    scene.add(this.group);
  }

  place(x, z, heading = Math.PI / 2) {
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
    this.state = 'idle';
  }

  hide() {
    this.group.visible = false;
    this.state = 'idle';
  }

  // Walks straight across the street (along X) to targetX, then stops
  startCross(targetX) {
    if (!this.group.visible) return;
    this.state = 'crossing';
    this.targetX = targetX;
  }

  update(dt) {
    if (!this.group.visible || this.state !== 'crossing') return;
    const dx = this.targetX - this.group.position.x;
    const dir = Math.sign(dx);
    this.group.position.x += dir * this.speed * dt;
    this.group.rotation.y = Math.atan2(dir, 0);
    this._walkPhase += dt * 6.5;
    const sw = Math.sin(this._walkPhase) * 0.45;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    this.arms[0].rotation.x = -sw * 0.7;
    this.arms[1].rotation.x = sw * 0.7;
    if (Math.abs(dx) < 0.15) {
      this.state = 'idle';
      for (const l of this.legs) l.rotation.x = 0;
      for (const a of this.arms) a.rotation.x = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Cyclist: proper low-poly bike (frame tubes, spoked wheels, pedaling rider).
// Rides in from the side street, turns north onto the main road across the
// zebra. Brakes for obstacles; if an overlap still happens, it crashes
// (falls over) instead of clipping through geometry.
// ---------------------------------------------------------------------------
export class Cyclist {
  constructor(scene) {
    this.group = new THREE.Group();
    this.active = false;
    this.state = 'idle'; // riding | crashed
    this.speed = 0;
    this.maxSpeed = 5;
    this.onEvent = null; // (name, data) => {}
    this._pedalPhase = 0;
    this._buildModel();
    this.group.visible = false;
    scene.add(this.group);
  }

  _buildModel() {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e8f4e, roughness: 0.45, metalness: 0.5 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0ab, roughness: 0.35, metalness: 0.7 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xc7903a, roughness: 0.8 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x33405e, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd6a77a, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xe0e4ec, roughness: 0.5 });

    // cylinder between two points
    const tube = (a, b, r, mat) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    const v = (x, y, z) => new THREE.Vector3(x, y, z);

    // Wheels: rings facing sideways + rotating spokes (local +Z = forward)
    const wheelGeo = new THREE.TorusGeometry(0.34, 0.04, 8, 18);
    wheelGeo.rotateY(Math.PI / 2);
    this.wheelGroups = [];
    for (const z of [0.52, -0.52]) {
      const wg = new THREE.Group();
      wg.position.set(0, 0.34, z);
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      tire.castShadow = true;
      wg.add(tire);
      for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.62, 0.015), metalMat);
        spoke.rotation.x = a;
        wg.add(spoke);
      }
      this.group.add(wg);
      this.wheelGroups.push(wg);
    }

    // Frame geometry points
    const R = v(0, 0.34, -0.52);  // rear hub
    const F = v(0, 0.34, 0.52);   // front hub
    const B = v(0, 0.42, -0.05);  // bottom bracket
    const S = v(0, 0.92, -0.30);  // seat top
    const H = v(0, 0.96, 0.34);   // head tube top
    tube(R, S, 0.022, frameMat);  // seat stay
    tube(R, B, 0.022, frameMat);  // chain stay
    tube(B, S, 0.025, frameMat);  // seat tube
    tube(B, H, 0.028, frameMat);  // down tube
    tube(S, H, 0.025, frameMat);  // top tube
    tube(H, F, 0.022, metalMat);  // fork

    // Handlebar + saddle
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 8), metalMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.0, 0.34);
    this.group.add(bar);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.26), tireMat);
    saddle.position.set(0, 0.96, -0.30);
    this.group.add(saddle);

    // Rider: leaning torso, head + helmet, arms to the bar, pedaling legs
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), shirtMat);
    torso.position.set(0, 1.26, -0.08);
    torso.rotation.x = 0.45;
    torso.castShadow = true;
    this.group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skinMat);
    head.position.set(0, 1.56, 0.10);
    this.group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    helmet.position.set(0, 1.58, 0.10);
    helmet.rotation.x = -0.25;
    this.group.add(helmet);

    for (const x of [-0.18, 0.18]) {
      tube(v(x, 1.42, -0.02), v(x * 0.9, 1.0, 0.30), 0.04, shirtMat); // arms
    }

    // Legs pivot at the hips and pedal with speed
    this.legs = [];
    for (const [x, phase] of [[-0.12, 0], [0.12, Math.PI]]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.96, -0.26);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), pantsMat);
      thigh.position.set(0, -0.18, 0.07);
      thigh.rotation.x = 0.5;
      thigh.castShadow = true;
      hip.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.28, 4, 8), pantsMat);
      shin.position.set(0, -0.45, 0.16);
      shin.rotation.x = 0.15;
      hip.add(shin);
      hip.userData.phase = phase;
      this.group.add(hip);
      this.legs.push(hip);
    }
  }

  // Path: in from the east side street (heading -X), quarter turn at the
  // intersection, then north (+Z) over the zebra crossing.
  start() {
    this.active = true;
    this.group.visible = true;
    this.state = 'riding';
    this.maxSpeed = 5;
    this.speed = this.maxSpeed;
    this.path = 'inbound';
    this._turnT = 0;
    this.group.position.set(26, 0, -1.9);
    this.group.rotation.set(0, -Math.PI / 2, 0);
    this._wasBlocked = false;
    this.reckless = false;
  }

  // Scenario-3 path: appears behind the AV in its lane, overtakes it on the
  // left and rides straight over the zebra. Reckless: it does NOT brake for
  // the pedestrian — if the pedestrian is crossing, it crashes into them.
  startOvertake(av) {
    this.active = true;
    this.group.visible = true;
    this.state = 'riding';
    this.maxSpeed = 6;
    this.speed = this.maxSpeed;
    this.path = 'overtake';
    this._av = av;
    this.reckless = true;
    this.group.position.set(-1.9, 0, av.group.position.z - 14);
    this.group.rotation.set(0, 0, 0); // heading +Z, same lane as the AV
    this._wasBlocked = false;
  }

  hide() {
    this.active = false;
    this.group.visible = false;
    this.state = 'idle';
    this.reckless = false;
    this.group.rotation.set(0, 0, 0);
  }

  crash(withName) {
    if (this.state === 'crashed') return;
    this.state = 'crashed';
    this.speed = 0;
    this._fallT = 0;
    this.onEvent?.('collision', { with: withName });
  }

  forward() {
    const ry = this.group.rotation.y;
    return new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  }

  update(dt, obstacles = []) {
    if (!this.active) return;

    // Fall-over animation after a crash; stays down until reset
    if (this.state === 'crashed') {
      if (this._fallT < 1) {
        this._fallT = Math.min(1, this._fallT + dt / 0.45);
        const e = this._fallT * this._fallT * (3 - 2 * this._fallT);
        this.group.rotation.z = e * 1.35;
      }
      return;
    }

    const fwd = this.forward();
    const pos = this.group.position;

    // Brake for obstacles ahead; crash on actual overlap. The reckless
    // overtaking cyclist ignores the pedestrian and the AV when braking
    // (it swings around the AV) — but overlaps still crash.
    const avoidList = this.reckless
      ? obstacles.filter((o) => o.name !== 'pedestrian' && o.name !== 'AV')
      : obstacles;
    const blocker = blockingObstacle(pos, fwd, avoidList, 5.5, 0.7);
    for (const obs of obstacles) {
      const d = obs.pos.clone().setY(0).distanceTo(pos.clone().setY(0));
      if (d < 0.5 + (obs.r ?? 0.5) * 0.6) { this.crash(obs.name ?? 'obstacle'); return; }
    }
    if (blocker && !this._wasBlocked) this.onEvent?.('cyclist_hard_brake', { for: blocker.name });
    this._wasBlocked = !!blocker;
    const target = blocker ? 0 : this.maxSpeed;
    const rate = target < this.speed ? 8 : 2.5; // brake much harder than accelerate
    this.speed += THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);

    if (this.path === 'overtake') {
      // Swing out to the left of the AV while passing, then back into the lane
      const relZ = pos.z - this._av.group.position.z; // <0 = behind the AV
      const targetX = relZ > -9 && relZ < 5 ? -0.1 : -1.9;
      const dx = (targetX - pos.x) * Math.min(1, dt * 2.5);
      pos.x += dx;
      this.group.rotation.y = THREE.MathUtils.clamp((targetX - pos.x) * 0.35, -0.45, 0.45);
    } else {
      // Quarter turn from -X to +Z at the intersection (side-street path)
      if (this.path === 'inbound' && pos.x <= 3.2) { this.path = 'turning'; this._turnT = 0; }
      if (this.path === 'turning') {
        this._turnT += (this.speed * dt) / 5; // ~5m arc length
        if (this._turnT >= 1) { this._turnT = 1; this.path = 'north'; }
        this.group.rotation.y = -Math.PI / 2 + this._turnT * (Math.PI / 2);
      }
    }

    pos.addScaledVector(this.forward(), this.speed * dt);

    // Wheel spin + pedaling
    for (const wg of this.wheelGroups) wg.rotation.x += (this.speed / 0.34) * dt;
    this._pedalPhase += this.speed * dt * 2.2;
    for (const hip of this.legs) {
      hip.rotation.x = Math.sin(this._pedalPhase + hip.userData.phase) * 0.4;
    }

    if (pos.z > 60 || pos.x < -60) this.hide();
  }
}

// ---------------------------------------------------------------------------
// Shared low-poly car body (merging car + ambient traffic)
// ---------------------------------------------------------------------------
export function buildCarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.65, 4.0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 })
  );
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.55, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.2, metalness: 0.5 })
  );
  cabin.position.set(0, 1.2, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c });
  for (const [x, z] of [[-0.88, 1.3], [0.88, 1.3], [-0.88, -1.3], [0.88, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.32, z);
    g.add(w);
  }
  // headlights (front = +Z)
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.2 });
  for (const x of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.05), hlMat);
    hl.position.set(x, 0.7, 2.01);
    g.add(hl);
  }
  return g;
}

// Human-driven car for the baseline condition (scenario 4): drives the AV's
// exact approach and yields at the zebra the same way — but communicates
// nothing (no light band, no display, no synthetic sound). The only cue the
// pedestrian gets is the implicit one: visible deceleration and stopping.
export class HumanCar {
  constructor(scene) {
    this.group = buildCarMesh(0x52606e);
    this.group.visible = false;
    this.speed = 0;
    this.targetSpeed = 0;
    scene.add(this.group);
  }

  spawn() {
    this.group.visible = true;
    this.group.position.set(-1.9, 0, -60); // same lane + start as the AV
    this.group.rotation.y = 0;
    this.speed = 0;
    this.targetSpeed = 0;
  }

  hide() { this.group.visible = false; }

  update(dt) {
    if (!this.group.visible) return;
    const accel = this.targetSpeed > this.speed ? 2.2 : 4.5; // same dynamics as the AV
    this.speed += THREE.MathUtils.clamp(this.targetSpeed - this.speed, -accel * dt, accel * dt);
    this.group.position.z += this.speed * dt;
  }

  get frontZ() { return this.group.position.z + 2.0; }
}

// ---- Larger vehicle bodies for mixed traffic ----
function addWheels(g, positions, radius = 0.36) {
  const geo = new THREE.CylinderGeometry(radius, radius, 0.26, 14);
  geo.rotateZ(Math.PI / 2);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c });
  for (const [x, z] of positions) {
    const w = new THREE.Mesh(geo, dark);
    w.position.set(x, radius, z);
    g.add(w);
  }
}

export function buildBusMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.1, 9),
    new THREE.MeshStandardMaterial({ color: 0x2a6a9a, roughness: 0.5, metalness: 0.2 })
  );
  body.position.y = 1.5;
  body.castShadow = true;
  g.add(body);
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(2.24, 0.6, 7.6),
    new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.2, metalness: 0.4, emissive: 0x223240, emissiveIntensity: 0.5 })
  );
  windows.position.y = 1.95;
  g.add(windows);
  addWheels(g, [[-0.95, 3.2], [0.95, 3.2], [-0.95, -2.6], [0.95, -2.6], [-0.95, -3.6], [0.95, -3.6]], 0.42);
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.2 });
  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), hlMat);
    hl.position.set(x, 0.9, 4.51);
    g.add(hl);
  }
  return g;
}

export function buildTruckMesh() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.8, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x8a5a28, roughness: 0.5, metalness: 0.3 })
  );
  cab.position.set(0, 1.25, 2.6);
  cab.castShadow = true;
  g.add(cab);
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 2.4, 5.2),
    new THREE.MeshStandardMaterial({ color: 0xb8b4a8, roughness: 0.8 })
  );
  cargo.position.set(0, 1.55, -1.2);
  cargo.castShadow = true;
  g.add(cargo);
  addWheels(g, [[-0.95, 2.7], [0.95, 2.7], [-0.95, -0.6], [0.95, -0.6], [-0.95, -2.4], [0.95, -2.4]], 0.42);
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.2 });
  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), hlMat);
    hl.position.set(x, 0.85, 3.61);
    g.add(hl);
  }
  return g;
}

export function buildAmbulanceMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.9, 5.2),
    new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.4, metalness: 0.1 })
  );
  body.position.y = 1.3;
  body.castShadow = true;
  g.add(body);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(2.04, 0.28, 5.24),
    new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.5 })
  );
  stripe.position.y = 1.1;
  g.add(stripe);
  // Roof light bar — beacons blink via TrafficManager
  const beacons = [];
  for (const [x, color] of [[-0.4, 0xff2020], [0.4, 0x2040ff]]) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.18, 0.3),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 })
    );
    b.position.set(x, 2.35, 1.6);
    g.add(b);
    beacons.push(b);
  }
  g.userData.beacons = beacons;
  addWheels(g, [[-0.85, 1.7], [0.85, 1.7], [-0.85, -1.7], [0.85, -1.7]], 0.36);
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 1.4 });
  for (const x of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.05), hlMat);
    hl.position.set(x, 0.8, 2.61);
    g.add(hl);
  }
  return g;
}

export class MergingCar {
  constructor(scene) {
    this.group = buildCarMesh(0x8a3030);
    this.state = 'hidden'; // hidden | waiting | merging | gone
    this.group.visible = false;
    scene.add(this.group);
  }

  // Waits on the side street (west arm), nose at the main road, wants to turn into AV's lane
  spawnWaiting() {
    this.state = 'waiting';
    this.group.visible = true;
    this.group.position.set(-9, 0, 1.9);
    this.group.rotation.y = Math.PI / 2; // facing +X toward the main road
    this._mergeT = 0;
  }

  merge() { if (this.state === 'waiting') this.state = 'merging'; }
  hide() { this.state = 'hidden'; this.group.visible = false; }

  update(dt, obstacles = []) {
    if (this.state !== 'merging') return;
    // A real merging driver does not drive into a person standing or walking
    // in the way — pause the maneuver while a pedestrian is in the path
    // ahead, so a bystander never gets run over. Resumes once clear.
    const ry = this.group.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    if (blockingObstacle(this.group.position, fwd, obstacles, 5, 1.0)) return;
    if (this._mergeT < 1) {
      // Arc phase: advance + turn from +X heading to +Z heading
      this._mergeT = Math.min(1, this._mergeT + dt / 2.4);
      const t = this._mergeT;
      const ease = t * t * (3 - 2 * t);
      this.group.rotation.y = Math.PI / 2 - ease * (Math.PI / 2);
      this.group.position.x = -9 + ease * 7.1;     // ends at x = -1.9 (AV lane)
      this.group.position.z = 1.9 + ease * 6 + t * t * 10;
    } else {
      // Merged — drive straight off down the lane. (Previously the arc
      // formula re-set z every frame, so the car stuck in place and the AV
      // rear-ended it when it resumed.)
      this.group.rotation.y = 0;
      this.group.position.x = -1.9;
      this.group.position.z += 9 * dt;
      if (this.group.position.z > 70) this.hide();
    }
  }
}

// ---------------------------------------------------------------------------
// Ambient traffic: a few human-driven cars that follow normal traffic rules:
//  - one vehicle in the intersection at a time (the closest approaching car
//    gets priority; everyone else stops at the intersection edge)
//  - they wait while the AV, the cyclist or the merging car occupy the
//    intersection — so they visibly react to the scenario
//  - southbound cars stop at a line before the zebra while the pedestrian
//    is in the road
//  - normal car-following behind slower/stopped vehicles
// ---------------------------------------------------------------------------
const CAR_COLORS = [0x8a4030, 0x33508a, 0x6a6f78, 0x8a7a30, 0x3a6a4a, 0x555a66, 0x7a4a6a];

const ZONE = 7; // intersection half-size (covers both roads' mouths)

const ROUTES = [
  { start: [1.9, 0, 85], ry: Math.PI, gone: (p) => p.z < -85, zebra: true }, // main road southbound (opposite lane)
  { start: [-85, 0, 1.9], ry: Math.PI / 2, gone: (p) => p.x > 85 },          // side street eastbound
  { start: [85, 0, -1.9], ry: -Math.PI / 2, gone: (p) => p.x < -85 },        // side street westbound
];

// Routes for scripted actors (offset = spawn distance from the intersection)
const ROUTE_PRESETS = {
  south: (d) => ({ start: [1.9, 0, d], ry: Math.PI, gone: (p) => p.z < -85, zebra: true }),
  east: (d) => ({ start: [-d, 0, 1.9], ry: Math.PI / 2, gone: (p) => p.x > 85 }),
  west: (d) => ({ start: [d, 0, -1.9], ry: -Math.PI / 2, gone: (p) => p.x < -85 }),
  northAV: (d) => ({ start: [-1.9, 0, -d], ry: 0, gone: (p) => p.z > 85 }), // the AV's own lane
};

// Per-kind collision footprint (hw/hl = half width/length, r = obstacle radius)
export const KIND_SPECS = {
  car: { hw: 0.95, hl: 2.05, r: 1.6, build: (color) => buildCarMesh(color) },
  bus: { hw: 1.12, hl: 4.5, r: 2.8, build: () => buildBusMesh() },
  truck: { hw: 1.15, hl: 3.6, r: 2.4, build: () => buildTruckMesh() },
  ambulance: { hw: 1.0, hl: 2.6, r: 1.8, build: () => buildAmbulanceMesh() },
};

const inZone = (p) => Math.abs(p.x) < ZONE && Math.abs(p.z) < ZONE;

export class TrafficManager {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    this.enabled = true;
    this.maxCars = 3;
    this._next = 4;
    this._seed = 1234567;
  }

  _rand() { return (this._seed = (this._seed * 16807) % 2147483647) / 2147483647; }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      for (const c of this.cars) this.scene.remove(c.mesh);
      this.cars = [];
    }
  }

  _spawn() {
    const route = ROUTES[Math.floor(this._rand() * ROUTES.length)];
    const start = new THREE.Vector3(...route.start);
    // keep distance from existing cars (also avoids stacking spawns on a queue)
    for (const c of this.cars) if (c.mesh.position.distanceTo(start) < 25) return;
    const mesh = buildCarMesh(CAR_COLORS[Math.floor(this._rand() * CAR_COLORS.length)]);
    mesh.position.copy(start);
    mesh.rotation.y = route.ry;
    this.scene.add(mesh);
    this.cars.push({ mesh, route, cruise: 5 + this._rand() * 3, speed: 0, kind: 'car', ...KIND_SPECS.car });
  }

  // Scripted actor for the scenario timelines. Flags:
  //  siren              — emergency vehicle: beacons blink, everyone else pulls over
  //  ignoreZebra        — does not respect the zebra stop line (aggressive)
  //  ignoreReservation  — does not wait at the intersection (emergency / aggressive)
  //  overtakeAV         — when stuck behind the AV for a while, swings out and
  //                       overtakes it (ignoring the pedestrian — accidents possible)
  //  honkWhenBlocked    — honks repeatedly while stuck (onHonk callback)
  spawnScripted({ kind = 'car', route = 'south', offset = 70, cruise = 7, color,
                  siren = false, ignoreZebra = false, ignoreReservation = false,
                  overtakeAV = false, honkWhenBlocked = false, patience = 2.5 }) {
    const spec = KIND_SPECS[kind] ?? KIND_SPECS.car;
    const r = ROUTE_PRESETS[route](offset);
    const mesh = spec.build(color ?? CAR_COLORS[Math.floor(this._rand() * CAR_COLORS.length)]);
    mesh.position.set(...r.start);
    mesh.rotation.y = r.ry;
    this.scene.add(mesh);
    const car = { mesh, route: r, cruise, speed: cruise * 0.6, kind, scripted: true,
      siren, ignoreZebra, ignoreReservation, overtakeAV, honkWhenBlocked, patience,
      hw: spec.hw, hl: spec.hl, r: spec.r };
    this.cars.push(car);
    return car;
  }

  clearScripted() {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      if (this.cars[i].scripted) {
        this.scene.remove(this.cars[i].mesh);
        this.cars.splice(i, 1);
      }
    }
  }

  // ctx: { obstacles, pedInRoad, zoneOccupiedExternal, avPos, avVisible }
  //  obstacles            — things to never drive into (pedestrian, AV, cyclist, …)
  //  pedInRoad            — pedestrian currently on the roadway (zebra stop rule)
  //  zoneOccupiedExternal — AV / cyclist / merging car inside the intersection
  //  avPos/avVisible      — needed by the aggressive overtake maneuver
  update(dt, ctx = {}) {
    const { obstacles = [], pedInRoad = false, zoneOccupiedExternal = false, avPos = null, avVisible = false } = ctx;

    if (this.enabled) {
      this._next -= dt;
      if (this._next <= 0 && this.cars.filter((c) => !c.scripted).length < this.maxCars) {
        this._spawn();
        this._next = 6 + this._rand() * 8;
      }
    }

    // Per-car geometry: forward vector + distance until the intersection
    for (const car of this.cars) {
      const ry = car.mesh.rotation.y;
      car._fwd = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const pos = car.mesh.position;
      car._entry = -(pos.x * car._fwd.x + pos.z * car._fwd.z) - ZONE; // <0 = inside/past
      car._inZone = inZone(pos);
    }

    // Emergency rule: while a siren vehicle is near the intersection,
    // everyone else pulls over and waits.
    const emergencyNear = this.cars.some((c) => c.siren && c.mesh.position.length() < 55);

    // Intersection reservation: busy if anyone is inside; otherwise the
    // closest approaching car gets priority.
    const zoneBusy = zoneOccupiedExternal || this.cars.some((c) => c._inZone);
    let claimant = null;
    let best = Infinity;
    for (const c of this.cars) {
      if (!c._inZone && c._entry > -1 && c._entry < best) { best = c._entry; claimant = c; }
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const pos = car.mesh.position;
      const fwd = car._fwd;

      // Distance at which this car must come to a stop (Infinity = free)
      let stopDist = Infinity;
      const skipReservation = car.ignoreReservation || car._overtaking;
      if (!skipReservation && !car._inZone && car._entry > 0 && (zoneBusy || car !== claimant)) {
        stopDist = car._entry - 1.0; // hold at the intersection edge
      }
      if (car.route.zebra && pedInRoad && !car.ignoreZebra) {
        const dz = pos.z - (LAYOUT.zebraZ + 2.4); // stop line before the zebra
        if (dz > 0) stopDist = Math.min(stopDist, dz);
      }

      // Car-following / never drive into anything. Overtaking aggressors
      // ignore the AV and the pedestrian (real overlaps become accidents).
      let obsList = obstacles;
      if (car._overtaking) obsList = obstacles.filter((o) => o.name !== 'AV' && o.name !== 'pedestrian');
      const others = this.cars.filter((c) => c !== car)
        .map((c) => ({ pos: c.mesh.position, r: c.r ?? 1.6, name: 'car' }));
      const blocked = blockingObstacle(pos, fwd, [...obsList, ...others], 5 + car.speed, 1.0);

      // Brake early enough to stop within stopDist (decel ~3.5 m/s²)
      const brakeDist = (car.speed * car.speed) / 7 + 1.2;
      let target = blocked || stopDist < brakeDist ? 0 : car.cruise;
      if (emergencyNear && !car.siren) target = 0; // yield to the emergency vehicle

      // Aggressive overtake: stuck for a while -> swing out around the AV
      if (car.overtakeAV && avVisible && avPos) {
        if (!car._overtaking) {
          car._frustration = (car._frustration ?? 0) + (car.speed < 0.5 && target === 0 ? dt : 0);
          if (car._frustration > (car.patience ?? 2.5)) { car._overtaking = true; this.onOvertake?.(car); }
        }
        if (car._overtaking) {
          // Stays out until well past the zebra — it cuts right across the
          // crossing while the pedestrian may be on it.
          const relZ = pos.z - avPos.z;
          const targetX = relZ > -10 && relZ < 14 ? 0.2 : -1.9;
          pos.x += (targetX - pos.x) * Math.min(1, dt * 2);
          if (relZ > -12) target = car.cruise; // push through
        }
      }

      // Honking while stuck
      if (car.honkWhenBlocked && target === 0 && car.speed < 1) {
        car._honkT = (car._honkT ?? 0.6) - dt;
        if (car._honkT <= 0) {
          car._honkT = 2 + this._rand() * 1.5;
          this.onHonk?.(car);
        }
      } else {
        car._honkT = 0.6;
      }

      // Blinking beacons on emergency vehicles
      if (car.siren && car.mesh.userData.beacons) {
        car._beaconT = (car._beaconT ?? 0) + dt;
        car.mesh.userData.beacons.forEach((b, bi) => {
          b.material.emissiveIntensity = (Math.floor(car._beaconT / 0.28) + bi) % 2 ? 3.5 : 0.15;
        });
      }

      const rate = target < car.speed ? 6 : (car._overtaking ? 4.5 : 2); // impatient drivers floor it
      car.speed += THREE.MathUtils.clamp(target - car.speed, -rate * dt, rate * dt);
      if (stopDist !== Infinity && stopDist < 0.3 && !car._overtaking) car.speed = 0; // never creep past the line
      pos.addScaledVector(fwd, car.speed * dt);

      if (car.route.gone(pos)) {
        this.scene.remove(car.mesh);
        this.cars.splice(i, 1);
      }
    }
  }
}

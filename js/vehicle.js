// Autonomous vehicle with the three eHMI layers: light band, windshield display, (sound handled in audio.js).
import * as THREE from 'three';

export const BAND_COLORS = {
  neutral:   new THREE.Color(0xffffff), // white — neutral driving
  assessing: new THREE.Color(0xffc832), // yellow — detecting / assessing
  yielding:  new THREE.Color(0x18e0e8), // cyan — cooperative / yielding
};

export class AV {
  constructor(scene) {
    this.group = new THREE.Group();
    this.speed = 0;           // current m/s, driven by scenario
    this.targetSpeed = 0;
    this.bandState = 'neutral';
    this._bandFrom = BAND_COLORS.neutral.clone();
    this._bandTo = BAND_COLORS.neutral.clone();
    this._bandT = 1;          // transition progress 0..1
    this._sweepPhase = 0;
    this.brightness = 2;

    this._buildBody();
    this._buildLightBand();
    this._buildWindshieldDisplay();

    scene.add(this.group);
    this.reset();
  }

  reset() {
    this.group.position.set(-1.9, 0, -60); // right-hand lane, approaching from -Z
    this.group.rotation.y = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.setBandState('neutral', true);
    this.setDisplay('off');
  }

  _buildBody() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4a63, roughness: 0.45, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 0.15, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.8 });

    // Low-poly shuttle-like body: lower box + rounded cabin
    const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), bodyMat);
    lower.position.y = 0.65;
    lower.castShadow = true;
    this.group.add(lower);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 3.2), glassMat);
    cabin.position.set(0, 1.42, -0.15);
    cabin.castShadow = true;
    this.group.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.12, 3.4), bodyMat);
    roof.position.set(0, 1.9, -0.15);
    this.group.add(roof);

    // Sensor pod (signals "autonomous")
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.22, 12), darkMat);
    pod.position.set(0, 2.07, 0.2);
    this.group.add(pod);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    this.wheels = [];
    for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(x, 0.34, z);
      this.group.add(w);
      this.wheels.push(w);
    }

    // Headlights (dim, neutral)
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 0.8 });
    for (const x of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), hlMat);
      hl.position.set(x, 0.75, 2.21);
      this.group.add(hl);
    }
  }

  _buildLightBand() {
    // 360° LED band wrapping the whole vehicle body (as in the design
    // drafts), segmented so the sweep animation can travel around the car.
    this.bandSegments = [];
    const y = 0.99;            // just above the lower-body top edge
    const hw = 1.02, hl = 2.21; // ring half-width / half-length
    // Perimeter edges: front -> right -> rear -> left (param u runs 0..len)
    const edges = [
      { len: 2 * hw, at: (u) => [-hw + u, hl, 0] },              // front (faces +Z)
      { len: 2 * hl, at: (u) => [hw, hl - u, Math.PI / 2] },     // right side
      { len: 2 * hw, at: (u) => [hw - u, -hl, 0] },              // rear
      { len: 2 * hl, at: (u) => [-hw, -hl + u, Math.PI / 2] },   // left side
    ];
    const perim = edges.reduce((s, e) => s + e.len, 0);
    const segCount = 48;
    const geo = new THREE.BoxGeometry((perim / segCount) * 0.8, 0.07, 0.035);
    for (let i = 0; i < segCount; i++) {
      let d = ((i + 0.5) / segCount) * perim;
      let edge = edges[0];
      for (const e of edges) { if (d <= e.len) { edge = e; break; } d -= e.len; }
      const [x, z, ry] = edge.at(d);
      const seg = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      seg.position.set(x, y, z);
      seg.rotation.y = ry;
      this.group.add(seg);
      this.bandSegments.push(seg);
    }
    // Soft fill lights so the band tints the road around the car
    this.bandLight = new THREE.PointLight(0xffffff, 6, 10, 2);
    this.bandLight.position.set(0, 1.0, 2.6);
    this.group.add(this.bandLight);
    this.bandLightRear = new THREE.PointLight(0xffffff, 3, 8, 2);
    this.bandLightRear.position.set(0, 1.0, -2.6);
    this.group.add(this.bandLightRear);
  }

  setBandState(state, instant = false) {
    if (state === this.bandState && !instant) return;
    this.bandState = state;
    this._bandFrom = this._currentBandColor();
    this._bandTo = BAND_COLORS[state].clone();
    this._bandT = instant ? 1 : 0;
  }

  _currentBandColor() {
    return this._bandFrom.clone().lerp(this._bandTo, this._easedT());
  }
  _easedT() { const t = this._bandT; return t * t * (3 - 2 * t); } // smoothstep

  _buildWindshieldDisplay() {
    this.dispCanvas = document.createElement('canvas');
    this.dispCanvas.width = 1024;
    this.dispCanvas.height = 512;
    this.dispTexture = new THREE.CanvasTexture(this.dispCanvas);
    this.dispTexture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.dispTexture, transparent: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), mat);
    // Floats clearly in front of the cabin glass (face at z=1.45) so the
    // tilted top edge can never sink into the cabin and clip the text.
    plane.position.set(0, 1.47, 1.56);
    plane.rotation.x = -0.08;
    this.group.add(plane);
    this.displayMode = 'off';
    this._drawDisplay();
  }

  setDisplay(mode) {
    if (mode === this.displayMode) return;
    this.displayMode = mode;
    this._displayAnimT = 0;
    this._drawDisplay();
  }

  _drawDisplay() {
    const ctx = this.dispCanvas.getContext('2d');
    const W = this.dispCanvas.width, H = this.dispCanvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.displayMode === 'off') { this.dispTexture.needsUpdate = true; return; }

    // State accent color (matches the light band language)
    const ACCENT = { detecting: '#ffd24a', yielding: '#46e8f0', thanks: '#ffffff' };
    const accent = ACCENT[this.displayMode] ?? '#ffffff';

    // Panel: soft dark gradient + glowing accent border
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(13,20,32,0.94)');
    grad.addColorStop(1, 'rgba(4,8,15,0.94)');
    ctx.fillStyle = grad;
    roundRect(ctx, 14, 14, W - 28, H - 28, 48);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 9;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 38;
    roundRect(ctx, 14, 14, W - 28, H - 28, 48);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Radial glow behind the emoji so the symbol pops at distance
    const glowY = this.displayMode === 'detecting' ? 150 : 185;
    const rg = ctx.createRadialGradient(W / 2, glowY, 12, W / 2, glowY, 230);
    rg.addColorStop(0, accent + '44'); // ~27% alpha
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // High-contrast text pill in the accent color: a bright solid shape
    // reads (and blooms) much further than thin glowing text.
    const pill = (label, y, h, fontPx) => {
      ctx.font = `bold ${fontPx}px system-ui, -apple-system, sans-serif`;
      const pw = Math.min(W - 90, ctx.measureText(label).width + 96);
      ctx.save();
      ctx.fillStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 26;
      roundRect(ctx, W / 2 - pw / 2, y, pw, h, h / 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = this.displayMode === 'thanks' ? '#1a1a20' : '#04141c';
      ctx.fillText(label, W / 2, y + h / 2 + 3);
    };

    if (this.displayMode === 'detecting') {
      ctx.font = '160px system-ui';
      ctx.fillText('👁', W / 2, 145);
      ctx.font = '62px system-ui';
      ctx.fillText('🚶 🚲 🚗', W / 2, 290);
      pill('Detecting environment', 372, 96, 50);
    } else if (this.displayMode === 'yielding') {
      const bob = Math.sin((this._displayAnimT ?? 0) * 6) * 10; // waving motion
      ctx.font = '205px system-ui';
      ctx.fillText('👋', W / 2 + bob, 180);
      pill('Yielding — please cross', 366, 104, 56);
    } else if (this.displayMode === 'thanks') {
      ctx.font = '205px system-ui';
      ctx.fillText('☺️', W / 2, 180);
      pill('Thank you', 366, 104, 58);
    }
    this.dispTexture.needsUpdate = true;
  }

  update(dt) {
    // Speed easing + motion
    const accel = this.targetSpeed > this.speed ? 2.2 : 4.5; // brake harder than accelerate
    this.speed += THREE.MathUtils.clamp(this.targetSpeed - this.speed, -accel * dt, accel * dt);
    this.group.position.z += this.speed * dt;
    for (const w of this.wheels) w.rotation.x += (this.speed / 0.34) * dt;

    // Light band transition + sweep shimmer
    if (this._bandT < 1) this._bandT = Math.min(1, this._bandT + dt / 0.6); // 0.6s smooth transition
    this._sweepPhase += dt * (this.bandState === 'yielding' ? 3.0 : this.bandState === 'assessing' ? 5.0 : 1.2);
    const base = this._currentBandColor();
    const n = this.bandSegments.length;
    for (let i = 0; i < n; i++) {
      // travelling brightness wave across the strip
      const wave = 0.72 + 0.28 * Math.sin(this._sweepPhase - (i / n) * Math.PI * 2);
      this.bandSegments[i].material.color.copy(base).multiplyScalar(this.brightness * wave);
    }
    this.bandLight.color.copy(base);
    this.bandLight.intensity = 4 * this.brightness;
    this.bandLightRear.color.copy(base);
    this.bandLightRear.intensity = 2 * this.brightness;

    // Animated waving hand
    if (this.displayMode === 'yielding') {
      this._displayAnimT = (this._displayAnimT ?? 0) + dt;
      this._drawDisplay();
    }
  }

  get frontZ() { return this.group.position.z + 2.2; }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

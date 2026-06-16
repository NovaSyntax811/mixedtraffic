// Synthetic eHMI sound layer (Web Audio API):
//  - motor hum, volume scales with AV distance to listener
//  - friction/deceleration cue (filtered noise) when slowing
//  - distinct "go-ahead" tone when yielding
//  - StereoPannerNode panning from the AV's position relative to the camera
export class EHMISound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.panner = null;
    this.volume = 0.6;
    this._humOsc = null;
    this._humGain = null;
    this._frictionGain = null;
    this._started = false;
    // Audio-only study (Mara mode): cues are boosted so the scene stays
    // readable without vision.
    this.audioOnlyBoost = false;
  }

  // Must be called from a user gesture (Start button)
  init() {
    if (this._started) return;
    this._started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.panner = ctx.createStereoPanner();
    this.panner.connect(this.master);
    this.master.connect(ctx.destination);

    // --- Motor hum: two detuned saws through a lowpass ---
    this._humGain = ctx.createGain();
    this._humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 220;
    humFilter.connect(this._humGain);
    this._humGain.connect(this.panner);
    this._humFilter = humFilter;

    for (const detune of [0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      osc.detune.value = detune;
      osc.connect(humFilter);
      osc.start();
      if (!this._humOsc) this._humOsc = osc;
    }

    // --- Friction noise bed (gain raised only while decelerating) ---
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.8;
    this._frictionGain = ctx.createGain();
    this._frictionGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(this._frictionGain);
    this._frictionGain.connect(this.panner);
    noise.start();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Call every frame.
  // avPos/camPos: THREE.Vector3, camRight: camera right vector, speed/decelerating from AV state.
  update(avPos, camPos, camRight, speed, decelerating) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Distance-based hum loudness (inverse-ish falloff, clamped)
    const boost = this.audioOnlyBoost ? 1.8 : 1;
    const dist = avPos.distanceTo(camPos);
    const proximity = Math.min(1, (this.audioOnlyBoost ? 14 : 9) / Math.max(3, dist));
    const humLevel = proximity * (0.10 + Math.min(0.25, speed * 0.025)) * boost;
    this._humGain.gain.setTargetAtTime(humLevel, t, 0.1);
    // Pitch follows speed
    this._humFilter.frequency.setTargetAtTime(180 + speed * 35, t, 0.15);
    if (this._humOsc) this._humOsc.frequency.setTargetAtTime(48 + speed * 4, t, 0.15);

    // Friction cue while decelerating
    const fric = decelerating ? proximity * Math.min(0.35, speed * 0.05) * boost : 0;
    this._frictionGain.gain.setTargetAtTime(fric, t, 0.08);

    // Stereo pan: project AV offset onto the camera's right axis
    const toAV = avPos.clone().sub(camPos);
    const lateral = toAV.dot(camRight);
    const pan = Math.max(-1, Math.min(1, lateral / 12));
    this.panner.pan.setTargetAtTime(pan, t, 0.1);
  }

  // Distinct, friendly two-note "go-ahead" cue (played once when yielding starts)
  playGoAhead(gain = 0.32) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, start, dur] of [[660, 0, 0.16], [880, 0.18, 0.28]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(gain, t0 + start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      osc.connect(g);
      g.connect(this.panner);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  }

  // Audio-only mode: the go-ahead motif repeats softly for as long as the AV
  // is yielding, so a non-sighted participant gets continuous confirmation
  // (a one-shot cue is easy to miss and impossible to re-check).
  startYieldLoop() {
    if (!this.ctx || this._yieldLoop) return;
    this.playGoAhead(0.24);
    this._yieldLoop = setInterval(() => this.playGoAhead(0.22), 2400);
  }

  stopYieldLoop() {
    if (!this._yieldLoop) return;
    clearInterval(this._yieldLoop);
    this._yieldLoop = null;
  }

  // Soft footstep tick — lets the audio-only participant track their own walking
  playStep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t0);
  }

  // Curb cue: clear low tick when stepping onto / off the roadway
  playCurb() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  // Harsh noise burst + low thud for a collision
  playCrash() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;

    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.35, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 450;
    filt.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    src.connect(filt); filt.connect(g); g.connect(this.panner);
    src.start(t0);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(110, t0);
    thud.frequency.exponentialRampToValueAtTime(45, t0 + 0.25);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.45, t0);
    tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    thud.connect(tg); tg.connect(this.panner);
    thud.start(t0);
    thud.stop(t0 + 0.35);
  }

  // "Tom mode" distractor: a busy little synth loop (his music) that competes
  // with and masks the AV cues. Plays centered, NOT spatialized with the AV.
  startDistractor() {
    if (!this.ctx || this._distractor) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    g.connect(this.master);
    const tempo = 0.27; // seconds per step
    const notes = [220, 277, 330, 277, 220, 330, 415, 330];
    let step = 0;
    const timer = setInterval(() => {
      const t0 = ctx.currentTime + 0.05;
      const bass = ctx.createOscillator();
      bass.type = 'triangle';
      bass.frequency.value = step % 4 === 0 ? 110 : 82;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.5, t0);
      bg.gain.exponentialRampToValueAtTime(0.001, t0 + tempo * 0.9);
      bass.connect(bg); bg.connect(g);
      bass.start(t0); bass.stop(t0 + tempo);

      const mel = ctx.createOscillator();
      mel.type = 'square';
      mel.frequency.value = notes[step % notes.length];
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.16, t0);
      mg.gain.exponentialRampToValueAtTime(0.001, t0 + tempo * 0.8);
      mel.connect(mg); mg.connect(g);
      mel.start(t0); mel.stop(t0 + tempo);
      step++;
    }, tempo * 1000);
    this._distractor = { g, timer };
  }

  stopDistractor() {
    if (!this._distractor) return;
    clearInterval(this._distractor.timer);
    const g = this._distractor.g;
    if (this.ctx) g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* fine */ } }, 600);
    this._distractor = null;
  }

  get distractorActive() { return !!this._distractor; }

  // Aggressive car horn: two detuned saws, short blast
  playHorn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    for (const f of [400, 505]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
      g.gain.setValueAtTime(0.2, t0 + 0.28);
      g.gain.linearRampToValueAtTime(0.001, t0 + 0.38);
      osc.connect(g);
      g.connect(this.panner);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    }
  }

  // Two-tone emergency siren (runs until stopSiren)
  startSiren() {
    if (!this.ctx || this._siren) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 750;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.11, ctx.currentTime, 0.3);
    osc.connect(g);
    g.connect(this.panner);
    osc.start();
    lfo.start();
    this._siren = { osc, lfo, g };
  }

  stopSiren() {
    if (!this.ctx || !this._siren) return;
    const { osc, lfo, g } = this._siren;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    setTimeout(() => { try { osc.stop(); lfo.stop(); } catch (e) { /* already stopped */ } }, 800);
    this._siren = null;
  }

  // Soft single chime for the thank-you state
  playThanks() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 990;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    osc.connect(g);
    g.connect(this.panner);
    osc.start(t0);
    osc.stop(t0 + 0.6);
  }
}

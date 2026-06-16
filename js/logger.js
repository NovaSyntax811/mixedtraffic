// Behavioral logging + confidence-check dialog.
// Captures per run: reaction time (signal onset -> crossing start), crossed?,
// hesitations (stops mid-crossing), AV distance at crossing start, confidence answers.
export class BehaviorLogger {
  constructor() {
    this.runs = [];
    this.current = null;
  }

  startRun(scenario) {
    if (this.current) { // run was reset/restarted before finishing — keep it, marked aborted
      this.current.aborted = true;
      this.runs.push(this.current);
    }
    this.current = {
      scenario,
      timestamp: new Date().toISOString(),
      signalOnset: null,        // performance.now() when yielding signal shown
      crossingStart: null,
      reactionTimeMs: null,
      crossed: false,
      completedCrossing: false,
      hesitations: 0,
      avDistanceAtCrossingStart: null,
      // gaze proxy (first-person head direction): time spent looking at the
      // vehicle before starting to cross — "active scan" vs "passive routine"
      gazeAtVehiclePreCrossMs: 0,
      scannedBeforeCrossing: null,
      events: [],
      confidence: null,
      ...(this.nextMeta ?? {}), // e.g. protocolStep, mode, soundVolume
    };
    this.nextMeta = null;
    this._wasInRoad = false;
    this._movingInRoad = false;
    console.log(`[log] run started — scenario ${scenario}`);
  }

  event(name, data = {}) {
    if (!this.current) return;
    this.current.events.push({ t: Math.round(performance.now()), name, ...data });
    console.log(`[log] ${name}`, data);
  }

  signalOnset() {
    if (!this.current || this.current.signalOnset !== null) return;
    this.current.signalOnset = performance.now();
    this.event('signal_onset');
  }

  // Call every frame: in-road flag, moving flag, vehicle distance,
  // whether the first-person gaze is on the vehicle, and frame time in ms.
  tick(inRoad, moving, avDistance, lookingAtVehicle = false, dtMs = 16.7) {
    const c = this.current;
    if (!c) return;

    // Accumulate vehicle-directed gaze before the crossing decision
    if (c.crossingStart === null && lookingAtVehicle) {
      c.gazeAtVehiclePreCrossMs += dtMs;
    }

    // Crossing start = first time pedestrian enters the road while moving
    if (inRoad && !this._wasInRoad && c.crossingStart === null) {
      c.crossingStart = performance.now();
      c.crossed = true;
      c.avDistanceAtCrossingStart = Math.round(avDistance * 10) / 10;
      c.gazeAtVehiclePreCrossMs = Math.round(c.gazeAtVehiclePreCrossMs);
      c.scannedBeforeCrossing = c.gazeAtVehiclePreCrossMs > 400; // >0.4s on the vehicle = actively scanned
      if (c.signalOnset !== null) {
        c.reactionTimeMs = Math.round(c.crossingStart - c.signalOnset);
      }
      this.event('crossing_start', { avDistance: c.avDistanceAtCrossingStart, reactionTimeMs: c.reactionTimeMs, gazeMs: c.gazeAtVehiclePreCrossMs, scanned: c.scannedBeforeCrossing });
    }

    // Hesitation = stopping while in the road after having moved there
    if (inRoad) {
      if (this._movingInRoad && !moving) {
        c.hesitations++;
        this.event('hesitation', { count: c.hesitations });
      }
      this._movingInRoad = moving;
    }

    // Completed crossing = left the road on the far side after having entered
    if (!inRoad && this._wasInRoad && c.crossed && !c.completedCrossing) {
      c.completedCrossing = true;
      this.event('crossing_complete');
    }

    this._wasInRoad = inRoad;
  }

  // Detach the current run so a new run can start while e.g. the confidence
  // dialog is still open. Caller finalizes via completeRun().
  finishRun() {
    const run = this.current;
    this.current = null;
    return run;
  }

  // End the current run without a confidence check (e.g. after an accident)
  abortRun(reason) {
    const run = this.finishRun();
    if (!run) return;
    run.aborted = reason;
    this.runs.push(run);
    console.log('[log] run aborted:', reason, run);
  }

  completeRun(run, confidence) {
    if (!run) return;
    run.confidence = confidence;
    run.events.push({ t: Math.round(performance.now()), name: 'confidence_check', ...confidence });
    this.runs.push(run);
    console.log('[log] run complete:', run);
  }

  download() {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), runs: this.runs }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ehmi-behavior-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

// Confidence dialog, branched on the actual behavior in the run:
//  crossed     -> "Why did you cross?" (multi-select) + safety while crossing
//  not crossed -> "Why not?" (multi-select) + would-you-next-time + overall safety
//  askSound    -> additionally requires a sound pleasantness rating (sound study)
// Returns a Promise resolving to { crossed, reasons, safety, wouldCrossNextTime?, soundRating? }
export function showConfidenceCheck(crossed, askSound = false) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confidenceDialog');
    const submit = document.getElementById('confidenceSubmit');
    document.getElementById('ccCrossed').classList.toggle('hidden', !crossed);
    document.getElementById('ccNotCrossed').classList.toggle('hidden', !!crossed);
    document.getElementById('ccSound').classList.toggle('hidden', !askSound);

    const reasons = new Set();
    let safety = null;
    let wouldCross = null;
    let soundRating = null;

    const reasonBtns = dialog.querySelectorAll(
      crossed ? '#crossReasons [data-reason]' : '#noCrossReasons [data-reason]');
    const safeBtns = dialog.querySelectorAll('[data-safe]');
    const nextBtns = dialog.querySelectorAll('[data-next]');
    const annoyBtns = dialog.querySelectorAll('[data-annoy]');

    const update = () => {
      submit.disabled = !(reasons.size > 0 && safety !== null
        && (crossed || wouldCross !== null)
        && (!askSound || soundRating !== null));
    };
    const onReason = (e) => {
      const v = e.target.dataset.reason;
      if (reasons.has(v)) reasons.delete(v); else reasons.add(v);
      e.target.classList.toggle('selected', reasons.has(v));
      update();
    };
    const onSafe = (e) => {
      safety = parseInt(e.target.dataset.safe, 10);
      safeBtns.forEach((b) => b.classList.toggle('selected', b === e.target));
      update();
    };
    const onNext = (e) => {
      wouldCross = e.target.dataset.next === 'yes';
      nextBtns.forEach((b) => b.classList.toggle('selected', b === e.target));
      update();
    };
    const onAnnoy = (e) => {
      soundRating = parseInt(e.target.dataset.annoy, 10);
      annoyBtns.forEach((b) => b.classList.toggle('selected', b === e.target));
      update();
    };
    reasonBtns.forEach((b) => b.addEventListener('click', onReason));
    safeBtns.forEach((b) => b.addEventListener('click', onSafe));
    nextBtns.forEach((b) => b.addEventListener('click', onNext));
    annoyBtns.forEach((b) => b.addEventListener('click', onAnnoy));

    submit.onclick = () => {
      reasonBtns.forEach((b) => b.removeEventListener('click', onReason));
      safeBtns.forEach((b) => b.removeEventListener('click', onSafe));
      nextBtns.forEach((b) => b.removeEventListener('click', onNext));
      annoyBtns.forEach((b) => b.removeEventListener('click', onAnnoy));
      dialog.querySelectorAll('.selected').forEach((b) => b.classList.remove('selected'));
      submit.disabled = true;
      dialog.classList.add('hidden');
      const answers = { crossed: !!crossed, reasons: [...reasons], safety };
      if (!crossed) answers.wouldCrossNextTime = wouldCross;
      if (askSound) answers.soundRating = soundRating;
      resolve(answers);
    };

    submit.disabled = true;
    dialog.classList.remove('hidden');
  });
}

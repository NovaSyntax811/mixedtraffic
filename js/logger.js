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
      hesitations: 0,        // stops while already in the road (count)
      hesitationTimeMs: 0,   // total time stood still while in the road
      falseStarts: 0,        // stepped up to the kerb, then backed away before crossing
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
    this._nearKerb = false;
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
  // whether the first-person gaze is on the vehicle, frame time in ms, and the
  // distance from the pedestrian to the road edge (negative = in the road).
  tick(inRoad, moving, avDistance, lookingAtVehicle = false, dtMs = 16.7, distToRoad = null) {
    const c = this.current;
    if (!c) return;

    // Accumulate vehicle-directed gaze before the crossing decision
    if (c.crossingStart === null && lookingAtVehicle) {
      c.gazeAtVehiclePreCrossMs += dtMs;
    }

    // False start (kerb hesitation): before the crossing has begun, the
    // pedestrian comes right up to the kerb (< 0.7 m from the road edge) and
    // then retreats (> 1.2 m) without stepping in. A classic hesitation marker.
    if (distToRoad !== null && c.crossingStart === null) {
      if (distToRoad < 0.7 && distToRoad > 0) this._nearKerb = true;
      else if (this._nearKerb && distToRoad > 1.2) {
        this._nearKerb = false;
        c.falseStarts++;
        this.event('false_start', { count: c.falseStarts });
      }
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

    // Hesitation = stopping while in the road after having moved there.
    // Also accumulate how LONG they stood still out there in total.
    if (inRoad) {
      if (this._movingInRoad && !moving) {
        c.hesitations++;
        this.event('hesitation', { count: c.hesitations });
      }
      if (!moving) c.hesitationTimeMs = Math.round(c.hesitationTimeMs + dtMs);
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

// ---------------------------------------------------------------------------
// Free-walk mini surveys: one short, domain-targeted questionnaire per walk
// station, shown right after the situation resolves. The on-screen title stays
// neutral ("Quick questions") and no question names a domain; each set carries
// one shared trust item so trust is comparable across the four situations.
// ---------------------------------------------------------------------------
const TRUST_ITEM = { id: 'trust', label: 'How much did you trust the car in this moment? (1 = not at all, 7 = fully)', type: 'likert' };

const WALK_SURVEYS = {
  uncertainty: [
    { id: 'wantedToCross', label: 'Did you want to cross just now?', type: 'choice', options: [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] },
    { id: 'stopFelt', label: 'The car stopping felt like…', type: 'choice', options: [['invitation', 'An invitation'], ['pressure', 'Pressure to cross'], ['confusing', 'Confusing'], ['nothing', 'Nothing in particular']] },
    TRUST_ITEM,
  ],
  targeted: [
    { id: 'addressee', label: 'Who was the car letting cross?', type: 'choice', options: [['me', 'Me'], ['other', 'The other person'], ['both', 'Both of us'], ['unsure', 'Not sure']] },
    { id: 'addresseeConfidence', label: 'How sure are you about that? (1 = guessing, 7 = certain)', type: 'likert' },
    TRUST_ITEM,
  ],
  negotiation: [
    { id: 'safety', label: 'How safe did you feel here? (1 = not at all, 7 = very safe)', type: 'likert' },
    { id: 'reliedOn', label: 'What did you rely on most when deciding?', type: 'choice', options: [['car', 'The stopping car'], ['own', 'My own judgement'], ['both', 'Both'], ['neither', 'Neither']] },
    TRUST_ITEM,
  ],
  scalability: [
    { id: 'addressee', label: "Who was the car's signal meant for?", type: 'choice', options: [['me', 'Me'], ['others', 'The others'], ['everyone', 'Everyone waiting'], ['unsure', 'Not sure']] },
    { id: 'safety', label: 'How safe did you feel deciding here? (1 = not at all, 7 = very safe)', type: 'likert' },
    TRUST_ITEM,
  ],
};

// Render the survey for one station kind; resolves to { itemId: answer, ... }
// once every item is answered and Continue is pressed.
export function showWalkSurvey(kind) {
  const items = WALK_SURVEYS[kind];
  if (!items) return Promise.resolve(null);
  return new Promise((resolve) => {
    const dialog = document.getElementById('walkSurvey');
    const body = document.getElementById('wsBody');
    const submit = document.getElementById('wsSubmit');
    body.innerHTML = '';
    const answers = {};

    for (const item of items) {
      const q = document.createElement('p');
      q.textContent = item.label;
      body.appendChild(q);
      const row = document.createElement('div');
      row.className = 'row wrap';
      const opts = item.type === 'likert'
        ? [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)])
        : item.options;
      for (const [value, label] of opts) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => {
          answers[item.id] = value;
          [...row.children].forEach((x) => x.classList.toggle('selected', x === b));
          submit.disabled = items.some((it) => answers[it.id] === undefined);
        });
        row.appendChild(b);
      }
      body.appendChild(row);
    }

    submit.disabled = true;
    submit.onclick = () => {
      dialog.classList.add('hidden');
      resolve(answers);
    };
    dialog.classList.remove('hidden');
  });
}

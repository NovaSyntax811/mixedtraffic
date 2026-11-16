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
      // 'vr' or 'desktop': VR and screen runs must stay separable in analysis
      display: this.displayMode ? this.displayMode() : 'desktop',
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
    const c = this.current;
    c.signalOnset = performance.now();
    this.event('signal_onset');
    // Early crossing: the participant stepped off BEFORE the signal existed.
    // Backfill a NEGATIVE reaction time (crossing minus signal) and flag it,
    // so early step-offs stay analyzable (H3 early-window) instead of
    // silently producing a null RT with a temporally inverted event order.
    if (c.crossingStart !== null && c.reactionTimeMs === null) {
      c.reactionTimeMs = Math.round(c.crossingStart - c.signalOnset);
      c.crossedBeforeSignal = true;
      this.event('crossed_before_signal', { reactionTimeMs: c.reactionTimeMs });
    }
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
    if (run && run.crossingStart === null) {
      // No crossing happened: finalize the gaze proxy over the whole run, so
      // the scanning measure exists for non-crossing trials too (there it
      // means "scanned the vehicle during the trial").
      run.gazeAtVehiclePreCrossMs = Math.round(run.gazeAtVehiclePreCrossMs);
      run.scannedBeforeCrossing = run.gazeAtVehiclePreCrossMs > 400;
    }
    return run;
  }

  // End the current run CLEANLY (moderator Stop, training end): pushed with an
  // `ended` reason, never with the aborted flag. Without this, the next
  // startRun() would sweep the open run in as aborted:true, which is how the
  // pilot's training record got a spurious abort.
  closeRun(reason = 'stopped') {
    const run = this.finishRun();
    if (!run) return;
    run.ended = reason;
    this.runs.push(run);
    console.log('[log] run closed:', reason);
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
    // Aborted runs (accident fade-to-end) are already in the list; attach the
    // answers without duplicating the record.
    if (!this.runs.includes(run)) this.runs.push(run);
    console.log('[log] run complete:', run);
  }

  download() {
    // `participant` is set by the quantitative flow (URL ?p=...); null in
    // moderated qualitative sessions, where the researcher names the file.
    const payload = {
      exported: new Date().toISOString(),
      participant: this.participant ?? null,
      runs: this.runs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ehmi-study-${this.participant ?? 'log'}-${Date.now()}.json`;
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

// Generic in-app form: renders question items into the shared #walkSurvey
// modal and resolves to { itemId: answer, ... } once every required item is
// answered and Continue is pressed. Item types:
//   likert — 1 to 7 buttons (L7 / L7-sure); item.anchors = [leftText, rightText]
//   sd5    — 5-point semantic differential; item.anchors = [left, right]
//   choice — one of item.options [[value, label], ...] (also used for BIN/CAT)
//   int    — integer input (item.min / item.max)
//   text   — free text area (required unless item.optional)
//   note   — plain instruction paragraph, no input
// opts.shuffle randomizes the order of the input items (notes stay put), per
// the instrument's "randomize item order within each block" rule. Reverse-keyed
// items are shown UN-flipped; flipping happens at scoring.
// A VR presenter (js/vr.js) can take over while an immersive session runs,
// because DOM overlays are invisible there. Contract:
//   isPresenting() -> bool, present(orderedItems, title) -> Promise<answers>,
//   leaveForDom()  -> Promise (ends VR so a text form can be shown in the DOM)
let formPresenter = null;
export function setFormPresenter(p) { formPresenter = p; }

// Within-BLOCK randomization: an instruction note opens a block, and the input
// items are shuffled only among the positions of their own block. (Shuffling
// across the whole form would put, say, semantic-differential safety items
// under the Likert instruction and Likert items under the safety heading.)
export function orderItems(items, opts = {}) {
  if (!opts.shuffle) return items;
  const rand = opts.rand ?? Math.random;
  const out = [];
  let block = [];
  const flush = () => {
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    out.push(...block);
    block = [];
  };
  for (const it of items) {
    if (it.type === 'note') { flush(); out.push(it); } else block.push(it);
  }
  flush();
  return out;
}

export async function showForm(items, title = 'Quick questions', opts = {}) {
  const ordered = orderItems(items, opts);
  if (formPresenter?.isPresenting()) {
    const needsDom = ordered.some((it) => it.type === 'text' || it.type === 'int');
    if (!needsDom) return formPresenter.present(ordered, title);
    await formPresenter.leaveForDom(); // typing is done in the browser window
  }
  return showDomForm(ordered, title);
}

function showDomForm(ordered, title) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('walkSurvey');
    const body = document.getElementById('wsBody');
    const submit = document.getElementById('wsSubmit');
    const titleEl = document.getElementById('wsTitle');
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = '';
    const answers = {};
    const required = ordered.filter((it) => it.type !== 'note' && !it.optional);
    const update = () => {
      submit.disabled = required.some((it) => answers[it.id] === undefined || answers[it.id] === '');
    };

    for (const item of ordered) {
      if (item.type === 'note') {
        const n = document.createElement('p');
        n.className = 'form-note';
        n.textContent = item.label;
        body.appendChild(n);
        continue;
      }
      const q = document.createElement('p');
      q.textContent = item.label;
      body.appendChild(q);

      if (item.type === 'text') {
        const ta = document.createElement('textarea');
        ta.rows = 2;
        ta.addEventListener('input', () => {
          const v = ta.value.trim();
          if (v) answers[item.id] = v; else delete answers[item.id];
          update();
        });
        body.appendChild(ta);
        continue;
      }
      if (item.type === 'int') {
        const inp = document.createElement('input');
        inp.type = 'number';
        if (item.min !== undefined) inp.min = item.min;
        if (item.max !== undefined) inp.max = item.max;
        inp.addEventListener('input', () => {
          const v = parseInt(inp.value, 10);
          if (Number.isFinite(v) && (item.min === undefined || v >= item.min) && (item.max === undefined || v <= item.max)) {
            answers[item.id] = v;
          } else delete answers[item.id];
          update();
        });
        body.appendChild(inp);
        continue;
      }

      const scale = item.type === 'likert' ? [1, 2, 3, 4, 5, 6, 7]
        : item.type === 'sd5' ? [1, 2, 3, 4, 5] : null;
      const wrap = document.createElement('div');
      wrap.className = 'scale-wrap';
      if (scale && item.anchors) {
        const a = document.createElement('span');
        a.className = 'anchor';
        a.textContent = item.anchors[0];
        wrap.appendChild(a);
      }
      const row = document.createElement('div');
      row.className = 'row wrap';
      const optList = scale ? scale.map((n) => [n, String(n)]) : item.options;
      for (const [value, label] of optList) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => {
          answers[item.id] = value;
          [...row.children].forEach((x) => x.classList.toggle('selected', x === b));
          update();
        });
        row.appendChild(b);
      }
      wrap.appendChild(row);
      if (scale && item.anchors) {
        const a2 = document.createElement('span');
        a2.className = 'anchor';
        a2.textContent = item.anchors[1];
        wrap.appendChild(a2);
      }
      body.appendChild(wrap);
    }

    update();
    submit.onclick = () => {
      dialog.classList.add('hidden');
      resolve(answers);
    };
    dialog.classList.remove('hidden');
  });
}

// The free-walk mini survey uses the same form machinery.
export function showWalkSurvey(kind) {
  const items = WALK_SURVEYS[kind];
  return items ? showForm(items) : Promise.resolve(null);
}

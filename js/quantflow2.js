// Complexity study flow (?study2=1): mixed traffic, uncertainty, negotiation.
//
// DESIGN: within-subjects, single primary factor (Traffic Complexity), eHMI
// HELD CONSTANT. C1 solo/unambiguous, C2 mixed/parallel, C3 mixed/competing.
// Two scene instantiations per level (6 scored trials + 1 practice).
// Condition order = Latin square keyed to the participant number;
// instantiation order = seeded shuffle. See STUDY_PLAN_COMPLEXITY.md.
//
// This file implements the item-level instrument verbatim: every variable code
// below is the dataset column name, so scoring code runs untouched. Items
// marked (R) in the instrument are stored UN-flipped and reversed at scoring
// (see scoreSession at the bottom, which implements the scoring key).
//
// Deviation to note: the instrument was written for pre-rendered clips, where
// t_decide is asked. This prototype is INTERACTIVE (open item 2 resolved that
// way), so t_decide and t_latency are captured behaviourally from the actual
// crossing rather than asked, which is the stronger measure. Everything else
// is asked exactly as specified.
import { showForm } from './logger.js?v=19';

const LATIN3 = [
  ['C1', 'C2', 'C3'],
  ['C2', 'C3', 'C1'],
  ['C3', 'C1', 'C2'],
];

// Scene instantiations. Ground truth travels with the scene and is never shown.
//   gt_addressee — was the ego actually addressed (yes/no)
//   gt_intent    — yield / proceed
//   gt_catch     — misleading-signal catch trial (always no: the car never lies)
const SCENES = {
  C1: [
    { scene_id: 'C1a', playerZ: 12, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no' },
    { scene_id: 'C1b', playerZ: 16, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no', mirrored: true },
  ],
  C2: [
    { scene_id: 'C2a', playerZ: 12, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no', sameSideNpcs: 2 },
    { scene_id: 'C2b', playerZ: 16, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no', sameSideNpcs: 3, mirrored: true },
  ],
  C3: [
    // C3a: the car addresses the far-kerb pedestrian, who crosses promptly.
    { scene_id: 'C3a', playerZ: 12, gt_addressee: 'no', gt_intent: 'yield', gt_catch: 'no', sameSideNpcs: 1, oppositeNpc: true },
    // C3b: honest yield to the ego while a cyclist cuts through (over-trust
    // probe; not a catch trial, since the signal itself is truthful).
    { scene_id: 'C3b', playerZ: 15, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no', sameSideNpcs: 1, hazard: 'cyclist', mirrored: true },
  ],
};
const PRACTICE = { scene_id: 'practice', playerZ: 12, gt_addressee: 'yes', gt_intent: 'yield', gt_catch: 'no', practice: true };

// ---------------------------------------------------------------------------
// §1 response-format conventions
// ---------------------------------------------------------------------------
const L7 = ['strongly disagree', 'strongly agree'];
const L7_SURE = ['not at all sure', 'completely sure'];
const L7_NOTE = { type: 'note', label: '1 = strongly disagree, 4 = neutral, 7 = strongly agree.' };
const lik = (id, label, anchors = L7) => ({ id, label, type: 'likert', anchors });
const sd5 = (id, label, left, right) => ({ id, label, type: 'sd5', anchors: [left, right] });
const cat = (id, label, options) => ({ id, label, type: 'choice', options });
const FREQ = [['never', 'never'], ['lt_monthly', 'less than monthly'], ['monthly', 'monthly'], ['weekly', 'weekly'], ['daily', 'daily']];

// ---------------------------------------------------------------------------
// §2 screening & quality gates [once]
// ---------------------------------------------------------------------------
const SCREENING_HEAD = [
  { type: 'note', label: 'A few quick checks before we start.' },
  cat('SCR_head', 'Are you wearing headphones or earphones right now?', [['yes', 'Yes'], ['no', 'No']]),
];
const SCREENING_AUDIO = [
  { type: 'note', label: 'A short sound just played. Set your volume so it is clearly audible but comfortable, then answer below. (You can replay it with the button under the question.)' },
  cat('SCR_audio', 'Which side was the sound louder on?', [['left', 'Left'], ['right', 'Right'], ['centre', 'Centre / both equally'], ['none', 'I heard nothing']]),
  cat('SCR_vol', 'Volume is set and comfortable?', [['ok', 'Yes, ready to continue']]),
];

// §2 attention checks, embedded in block 1 and block 3 batteries
const ATT1 = { ...lik('ATT1', "For this item, please select 'strongly disagree'."), gate: (v) => v === 1 };
const ATT2 = { ...lik('ATT2', 'I have been to the moon.'), gate: (v) => v <= 2 };

// ---------------------------------------------------------------------------
// §3 demographics & covariates [once]
// ---------------------------------------------------------------------------
const DEMOGRAPHICS = [
  { id: 'age', label: 'Age (years)', type: 'int', min: 18, max: 99 },
  cat('gender', 'Gender', [['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Non-binary'], ['self', 'Prefer to self-describe'], ['na', 'Prefer not to say']]),
  cat('licence', 'Do you hold a driving licence?', [['yes', 'Yes'], ['no', 'No']]),
  cat('drive_freq', 'How often do you drive?', FREQ),
  cat('cycle_freq', 'How often do you cycle in traffic?', FREQ),
  cat('walk_freq', 'How often do you walk in urban traffic (crossing streets)?', FREQ),
  lik('av_fam', 'How familiar are you with automated / self-driving vehicles?', ['not at all', 'very familiar']),
  sd5('av_att', 'In general, my attitude toward self-driving cars is…', 'negative', 'positive'),
  cat('xr_exp', 'Have you used VR / AR headsets before?', [['never', 'Never'], ['once', 'Once or twice'], ['occasionally', 'Occasionally'], ['regularly', 'Regularly']]),
];

// §3.1 ATI short (Franke, Attig & Wessel 2019), 4 items, L7 for consistency
const ATI = [
  L7_NOTE,
  lik('ati1', 'I like to occupy myself in greater detail with technical systems.'),
  lik('ati2', 'I enjoy trying out the functions of a new technical system.'),
  lik('ati3', 'I try to understand how a technical system exactly works.'),
  lik('ati4', "It is enough for me that a technical system works; I don't care how or why."), // (R)
];

// ---------------------------------------------------------------------------
// §4 per-trial items (t_decide and t_latency are captured behaviourally)
// ---------------------------------------------------------------------------
const PER_TRIAL = [
  lik('t_intent_sure', 'How sure are you about what the car was going to do?', L7_SURE),
  cat('t_addressee', 'Was the car communicating with you?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Unsure']]),
  lik('t_conf', 'How sure are you about your own decision to cross or wait?', L7_SURE),
];

// ---------------------------------------------------------------------------
// §5 per-condition battery
// ---------------------------------------------------------------------------
const battery = (attn) => {
  const items = [
    L7_NOTE,
    // §5.1 perceived signal ambiguity
    lik('amb1', 'It was clear what the car intended to do.'),                       // (R)
    lik('amb2', "It was clear whether the car's signal was meant for me."),          // (R)
    lik('amb3', 'I was confused about what the car wanted.'),
    lik('amb4', 'In this situation, it was hard to tell who the car was reacting to.'),
    // §5.2 willingness to cross / negotiation
    lik('wtc1', 'In this situation, I would have started to cross.'),
    lik('wtc2', 'I would have felt confident stepping onto the street.'),
    lik('wtc3', 'I would have waited to see what the car and the others did first.'), // (R)
    lik('defer1', 'I would have let another road user go before me.'),
    lik('defer2', 'It was clear it was my turn to cross.'),                          // (R)
    // §5.3 felt pressure / over-compliance
    lik('prs1', "I felt pushed to cross by the car's signal."),
    lik('prs2', 'I would have crossed mainly because the car told me to, more than because I judged it safe myself.'),
    lik('prs3', 'I felt rushed to make a decision.'),
    lik('prs4', 'I felt free to take my own time deciding.'),                        // (R)
    // §5.4 over-trust / reduced scanning
    lik('ovt1', "I relied on the car's signal rather than checking the road myself."),
    lik('ovt2', "I trusted the signal enough that I didn't feel the need to look around."),
    lik('ovt3', 'I still checked the other road users before deciding.'),            // (R)
    lik('ovt4', 'If the car signalled me to go, I would go without double-checking.'),
    // §5.5 trust in the AV (Jian et al. 1998 / Körber 2019, adapted short form)
    lik('trust1', "I could trust the car's communication."),
    lik('trust2', "The car's signals were dependable."),
    lik('trust3', "I was suspicious of the car's intent."),                          // (R)
    lik('trust4', 'I could rely on the car to behave predictably.'),
  ];
  if (attn) items.push(attn);
  // §5.6 perceived safety keeps its own heading and stays at the end
  items.push({ type: 'note', label: 'In this situation I felt…' });
  items.push(sd5('psaf1', 'anxious ↔ relaxed', 'anxious', 'relaxed'));
  items.push(sd5('psaf2', 'unsafe ↔ safe', 'unsafe', 'safe'));
  items.push(sd5('psaf3', 'agitated ↔ calm', 'agitated', 'calm'));
  return items;
};

// §5.7 Van der Laan acceptance [once, optional: ?vdl=1]
const VDL = [
  { type: 'note', label: 'Overall, the car\'s way of communicating was… (−2 to +2)' },
  sd5('vdl_useful', 'useful ↔ useless', 'useful', 'useless'),
  sd5('vdl_good', 'good ↔ bad', 'good', 'bad'),
  sd5('vdl_effective', 'effective ↔ superfluous', 'effective', 'superfluous'),
  sd5('vdl_assisting', 'assisting ↔ worthless', 'assisting', 'worthless'),
  sd5('vdl_alert', 'raising alertness ↔ sleep-inducing', 'raising alertness', 'sleep-inducing'),
  sd5('vdl_pleasant', 'pleasant ↔ unpleasant', 'pleasant', 'unpleasant'),
  sd5('vdl_nice', 'nice ↔ annoying', 'nice', 'annoying'),
  sd5('vdl_likeable', 'likeable ↔ irritating', 'likeable', 'irritating'),
  sd5('vdl_desirable', 'desirable ↔ undesirable', 'desirable', 'undesirable'),
];

// ---------------------------------------------------------------------------
// §6 post-study [once]
// ---------------------------------------------------------------------------
const POST_STUDY = [
  { id: 'open_hard', label: 'What made it hardest to decide whether to cross?', type: 'text' },
  { id: 'open_signal', label: "Was there ever a moment you weren't sure the signal was for you? Describe it.", type: 'text' },
  cat('manip_check', 'How many other road users were usually in the scenes?', [['none', 'None'], ['1_2', '1 to 2'], ['3_4', '3 to 4'], ['5plus', '5 or more']]),
  { id: 'strategy', label: 'Did you have a strategy for deciding?', type: 'text' },
  cat('tech_issue', 'Any audio or video problems during the study?', [['no', 'No'], ['yes', 'Yes']]),
  { id: 'tech_issue_text', label: 'If yes, what happened? (optional)', type: 'text', optional: true },
];

export function isComplexityMode() {
  return new URLSearchParams(location.search).has('study2');
}

async function submitResults(payload) {
  try {
    const res = await fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  } catch (err) {
    console.warn('[study2] upload failed, falling back to download:', err.message);
    return false;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stereo pip for the SCR_audio headphone gate: self-contained Web Audio, so
// it does not depend on the simulation's sound engine.
function playPan(side) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    pan.pan.value = side === 'left' ? -1 : 1;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    osc.connect(gain).connect(pan).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.75);
  } catch (e) { console.warn('[study2] pip failed', e.message); }
}

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const waitClick = (id) => new Promise((res) => { $(id).addEventListener('click', res, { once: true }); });

// ---------------------------------------------------------------------------
// §8 scoring key: construct -> items, reverse-keyed items flipped here.
// ---------------------------------------------------------------------------
const rev7 = (v) => (Number.isFinite(v) ? 8 - v : undefined);
const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4) : null;
};

function scoreSession(runs) {
  const rec = (n) => runs.filter((r) => r.record === n);
  const demo = rec('demographics')[0]?.answers ?? {};
  const trials = runs.filter((r) => r.scenario === 'ctrial' && r.confidence && !r.confidence.practice);
  const batteries = rec('condition_battery');

  // Per-trial derivations (strict scoring: "unsure" counts as incorrect;
  // the unsure-excluded variant is kept alongside).
  const perTrial = trials.map((t) => {
    const c = t.confidence;
    const strict = c.t_addressee === c.gt_addressee ? 1 : 0;
    const excl = c.t_addressee === 'unsure' ? null : strict;
    return {
      participant: c.participant, complexity: c.complexity, scene_id: c.scene_id,
      order_pos: c.order_pos, gt_addressee: c.gt_addressee, t_addressee: c.t_addressee,
      misattr_correct: strict, misattr_correct_excl_unsure: excl,
      t_intent_sure: c.t_intent_sure, t_conf: c.t_conf,
      t_decide: c.t_decide, t_latency: c.t_latency,
      hesitations: t.hesitations, false_starts: t.falseStarts,
      scanned_before_crossing: t.scannedBeforeCrossing,
    };
  });

  // CALIB needs t_conf standardized within participant.
  const confs = perTrial.map((t) => t.t_conf).filter(Number.isFinite);
  const m = mean(confs);
  const sd = confs.length > 1
    ? Math.sqrt(confs.reduce((a, b) => a + (b - m) ** 2, 0) / (confs.length - 1)) : 0;
  for (const t of perTrial) {
    t.calib_gap = (sd > 0 && Number.isFinite(t.t_conf))
      ? +(((t.t_conf - m) / sd) - t.misattr_correct).toFixed(4) : null;
  }

  // Per-condition construct scores.
  const byCondition = batteries.map((b) => {
    const a = b.answers;
    const ts = perTrial.filter((t) => t.complexity === b.complexity);
    return {
      participant: b.participant, complexity: b.complexity, order_pos: b.order_pos,
      AMB: mean([rev7(a.amb1), rev7(a.amb2), a.amb3, a.amb4]),
      WTC: mean([a.wtc1, a.wtc2, rev7(a.wtc3)]),
      DEFER: mean([a.defer1, rev7(a.defer2)]),
      PRS: mean([a.prs1, a.prs2, a.prs3, rev7(a.prs4)]),
      OVT: mean([a.ovt1, a.ovt2, rev7(a.ovt3), a.ovt4]),
      TRUST: mean([a.trust1, a.trust2, rev7(a.trust3), a.trust4]),
      PSAF: mean([a.psaf1, a.psaf2, a.psaf3]),
      UNC_intent: mean(ts.map((t) => rev7(t.t_intent_sure))),
      UNC_conf: mean(ts.map((t) => t.t_conf)),
      MISATTR: mean(ts.map((t) => t.misattr_correct)),
      LAT: mean(ts.map((t) => (Number.isFinite(t.t_latency) && t.t_latency > 0 ? Math.log(t.t_latency) : null))),
      CALIB: mean(ts.map((t) => t.calib_gap)),
    };
  });

  return {
    record: 'scored',
    ATI: mean([demo.ati1, demo.ati2, demo.ati3, rev7(demo.ati4)]),
    perTrial,
    byCondition,
  };
}

// Pre-registered quality gates (§2). Reported, not enforced client-side.
function qualityGates(runs, audioSide) {
  const rec = (n) => runs.filter((r) => r.record === n);
  const scr = rec('screening')[0]?.answers ?? {};
  const atts = rec('condition_battery')
    .map((b) => b.attentionCheck).filter(Boolean);
  const failed = atts.filter((a) => !a.passed).length;
  return {
    record: 'quality_gates',
    SCR_head: scr.SCR_head, headphonesOk: scr.SCR_head === 'yes',
    SCR_audio: scr.SCR_audio, audioSidePlayed: audioSide, audioOk: scr.SCR_audio === audioSide,
    attentionFailed: failed, attentionOk: failed <= 1,
    exclude: scr.SCR_head !== 'yes' || scr.SCR_audio !== audioSide || failed > 1,
  };
}

// ctx = { logger, startComplexityTrial(cfg), waitRun(), hud(msg) }
export async function runComplexityStudy(ctx) {
  const { logger } = ctx;
  const params = new URLSearchParams(location.search);
  const pid = params.get('p') || params.get('PROLIFIC_PID')
    || ('P' + Math.random().toString(36).slice(2, 6).toUpperCase());
  logger.participant = pid;

  const num = parseInt((pid.match(/(\d+)\s*$/) || [])[1], 10);
  const row = Number.isFinite(num) ? (num - 1) % 3 : Math.floor(Math.random() * 3);
  const order = LATIN3[row];
  const seed = Number.isFinite(num) ? (num * 6151 + 29) : Math.floor(Math.random() * 1e6);
  const rand = mulberry32(seed);

  const t0 = performance.now();
  logger.runs.push({
    record: 'session_start', study: 'complexity', participant: pid,
    latinRow: row + 1, conditionOrder: order, seed,
    prolific: { pid: params.get('PROLIFIC_PID'), study: params.get('STUDY_ID'), session: params.get('SESSION_ID') },
    SCR_dev: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile'
      : /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop',
    screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
    timestamp: new Date().toISOString(),
  });

  // 1. Consent
  show('consentDialog');
  await waitClick('consentContinue');
  hide('consentDialog');

  // 2. Screening: headphones, then the panned pip gate
  const head = await showForm(SCREENING_HEAD, 'Before we start');
  const audioSide = rand() < 0.5 ? 'left' : 'right';
  playPan(audioSide);
  const audio = await showForm(SCREENING_AUDIO, 'Sound check');
  logger.runs.push({ record: 'screening', participant: pid, audioSidePlayed: audioSide, answers: { ...head, ...audio } });

  // 3. Demographics + covariates (ATI shuffled within its block)
  const demoA = await showForm(DEMOGRAPHICS, 'About you');
  const demoB = await showForm(ATI, 'About you', { shuffle: true, rand });
  logger.runs.push({ record: 'demographics', participant: pid, answers: { ...demoA, ...demoB } });

  // 4. Instructions + one unscored practice trial
  show('introDialog');
  await waitClick('introStart');
  hide('introDialog');
  ctx.hud('Practice round. Nothing is recorded here.');
  ctx.startComplexityTrial({ ...PRACTICE, level: 'C1', label: 'Practice' });
  const practiceRun = await ctx.waitRun();
  logger.completeRun(practiceRun, { participant: pid, practice: true });

  // 5. Main block: conditions in Latin order, instantiations shuffled within
  let trialNo = 0;
  for (let ci = 0; ci < order.length; ci++) {
    const complexity = order[ci];
    const scenes = [...SCENES[complexity]];
    for (let i = scenes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    }
    for (const scene of scenes) {
      trialNo++;
      ctx.hud(`Situation ${trialNo} of 6.`);
      ctx.startComplexityTrial({
        ...scene, level: complexity, groundTruth: scene.gt_addressee === 'yes' ? 'you' : 'other',
        label: `Situation ${trialNo} of 6`,
      });
      const run = await ctx.waitRun();
      const answers = await showForm(PER_TRIAL, 'Quick questions');
      // t_decide / t_latency come from behaviour (interactive prototype)
      const t_decide = run?.crossed ? 'cross' : 'wait';
      const t_latency = Number.isFinite(run?.reactionTimeMs) ? run.reactionTimeMs : null;
      logger.completeRun(run, {
        participant: pid, complexity, scene_id: scene.scene_id, order_pos: ci + 1, trialNo,
        gt_addressee: scene.gt_addressee, gt_intent: scene.gt_intent, gt_catch: scene.gt_catch,
        t_decide, t_latency, ...answers,
      });
    }
    // Per-condition battery; ATT1 in block 1, ATT2 in block 3 (§7)
    const attn = ci === 0 ? ATT1 : ci === 2 ? ATT2 : null;
    const answers = await showForm(battery(attn), 'About those situations', { shuffle: true, rand });
    logger.runs.push({
      record: 'condition_battery', participant: pid, complexity, order_pos: ci + 1,
      attentionCheck: attn ? { id: attn.id, given: answers[attn.id], passed: !!attn.gate(answers[attn.id]) } : null,
      answers,
    });
  }

  // 5.7 optional Van der Laan acceptance (?vdl=1)
  if (params.has('vdl')) {
    const vdl = await showForm(VDL, 'Overall impression', { shuffle: true, rand });
    logger.runs.push({ record: 'vdl', participant: pid, answers: vdl });
  }

  // 6. Post-study, then scoring + gates, then debrief
  const post = await showForm(POST_STUDY, 'Last questions');
  logger.runs.push({ record: 'post_study', participant: pid, answers: post, totalMs: Math.round(performance.now() - t0) });
  logger.runs.push(qualityGates(logger.runs, audioSide));
  logger.runs.push(scoreSession(logger.runs));

  const submitted = await submitResults({ participant: pid, study: 'complexity', runs: logger.runs });
  $(submitted ? 'endMsgUploaded' : 'endMsgDownload').classList.remove('hidden');
  show('debriefBlock');
  show('studyEndDialog');
  if (!submitted) logger.download();
  ctx.hud('The study is complete. Thank you!');
}

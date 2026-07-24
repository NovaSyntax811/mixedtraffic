// Complexity study flow (?study2=1): the second quantitative design.
//
// DESIGN: within-subjects, single primary factor, eHMI HELD CONSTANT.
//   Traffic Complexity, 3 ordered levels:
//     C1 solo/unambiguous  — participant alone, car approaches and signals
//     C2 mixed/parallel    — companions crossing with non-conflicting claims
//     C3 mixed/competing   — a conflicting claim; addressee genuinely ambiguous
//   Two scene instantiations per level (6 scored trials + 1 practice), so
//   effects are not bound to a single scene. Condition ORDER is a Latin
//   square keyed to the participant number; instantiation order shuffles
//   within a condition (seeded, logged).
//
// This measures the phase BEFORE resolution (uncertainty and negotiation),
// not the downstream acknowledgment phase: no felt-acknowledgment or
// social-perception items here by design.
//
// C3 is deliberately operationalized BOTH ways (open item 1), one per
// instantiation, so the pilot answers which conflict works better:
//   C3a addressee-elsewhere: the car stops for the far-kerb pedestrian, who
//       crosses promptly. Ground truth for the misattribution item: 'other'.
//   C3b competing cyclist: the car yields honestly to the participant, but a
//       cyclist cuts through the crossing. Ground truth: 'you'; following the
//       signal without scanning is unsafe. The car never lies, so this
//       over-trust probe carries NO deception (see open item 3: a truly
//       misleading eHMI stays unimplemented pending ethics sign-off).
import { showForm } from './logger.js?v=18';

const LEVELS = ['C1', 'C2', 'C3'];

// Latin square over the three conditions (rows keyed by participant number).
const LATIN3 = [
  ['C1', 'C2', 'C3'],
  ['C2', 'C3', 'C1'],
  ['C3', 'C1', 'C2'],
];

// Scene instantiations. playerZ varies the approach distance a little; the
// stop distance to the addressee is constant (1.5 m) in every trial.
const SCENES = {
  C1: [
    { inst: 1, playerZ: 12, groundTruth: 'you' },
    { inst: 2, playerZ: 16, groundTruth: 'you', mirrored: true },
  ],
  C2: [
    { inst: 1, playerZ: 12, groundTruth: 'you', sameSideNpcs: 2 },
    { inst: 2, playerZ: 16, groundTruth: 'you', sameSideNpcs: 3, mirrored: true },
  ],
  C3: [
    { inst: 1, playerZ: 12, groundTruth: 'other', sameSideNpcs: 1, oppositeNpc: true },       // C3a
    { inst: 2, playerZ: 15, groundTruth: 'you', sameSideNpcs: 1, hazard: 'cyclist', mirrored: true }, // C3b
  ],
};

const PRACTICE = { level: 'C1', inst: 0, playerZ: 12, groundTruth: 'you', practice: true };

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------
const AGREE = { type: 'note', label: 'How much do you agree? 1 = strongly disagree, 7 = strongly agree.' };

// Per trial (RQ1 uncertainty + RQ3a misattribution + RQ4 calibration input).
// Intent certainty is reverse-scored into uncertainty at analysis time.
const PER_TRIAL = [
  { id: 'intentCertainty', label: 'How sure were you about what the car was going to do? (1 = not at all sure, 7 = completely sure)', type: 'likert' },
  { id: 'decisionConfidence', label: 'How confident are you that your own decision (to cross or to wait) was the right one? (1 = not at all, 7 = completely)', type: 'likert' },
  { id: 'addressee', label: 'Was the car communicating with you?', type: 'choice', options: [['you', 'Yes, with me'], ['other', 'No, with someone else'], ['unsure', 'Not sure']] },
];

// Per condition. Custom multi-item scales are marked with the construct they
// score; reliability (alpha/omega) is reported per the analysis plan.
const perCondition = (attentionCheck) => {
  const items = [
    AGREE,
    // Perceived signal ambiguity (reverse-scored -> ambiguity), RQ1
    { id: 'amb_clearWhat', label: 'It was clear what the car wanted to do.', type: 'likert' },
    { id: 'amb_clearWho', label: 'It was clear that the car meant me.', type: 'likert' },
    { id: 'amb_hardRead', label: 'It was hard to read the situation.', type: 'likert' },
    // Negotiation, RQ2
    { id: 'willingness', label: 'I would have started crossing in these situations.', type: 'likert' },
    { id: 'deference', label: 'I waited for someone else (another person or the car) to go first.', type: 'likert' },
    // Felt pressure / over-compliance, RQ3b
    { id: 'press_pushed', label: 'I felt pushed to cross.', type: 'likert' },
    { id: 'press_ratherThanJudged', label: 'I crossed because the car told me to, more than because I judged it safe.', type: 'likert' },
    // Over-trust / reduced scanning, RQ3c
    { id: 'trust_reliedOnSignal', label: "I relied on the car's signal rather than checking the road myself.", type: 'likert' },
    { id: 'trust_lessChecking', label: 'I checked the rest of the street less than I normally would.', type: 'likert' },
    // Trust in the AV (short form), secondary
    { id: 'trust_dependable', label: 'The car was dependable.', type: 'likert' },
    { id: 'trust_predictable', label: "I could predict the car's behaviour.", type: 'likert' },
    { id: 'trust_confidence', label: 'I have confidence in the car.', type: 'likert' },
    // Perceived safety (semantic differential), secondary
    { type: 'note', label: 'How did the situations feel overall?' },
    { id: 'ps_anxiousRelaxed', label: 'Anxious (1) … Relaxed (7)', type: 'likert' },
    { id: 'ps_agitatedCalm', label: 'Agitated (1) … Calm (7)', type: 'likert' },
    { id: 'ps_unsafeSafe', label: 'Unsafe (1) … Safe (7)', type: 'likert' },
  ];
  if (attentionCheck) {
    items.push({ type: 'note', label: 'Attention check.' });
    items.push({ id: attentionCheck.id, label: attentionCheck.label, type: 'likert', attention: attentionCheck.answer });
  }
  return items;
};

// Two attention checks, one each in the second and third condition block.
const ATTENTION = [
  { id: 'attn1', label: 'Please select 2 for this item.', answer: 2 },
  { id: 'attn2', label: 'Please select 6 for this item.', answer: 6 },
];

const SCREENING = [
  { type: 'note', label: 'A few quick checks before we start.' },
  { id: 'device', label: 'What are you using right now?', type: 'choice', options: [['desktop', 'Desktop / laptop'], ['tablet', 'Tablet'], ['phone', 'Phone']] },
  { id: 'headphones', label: 'Are you wearing headphones? The study uses sound, and the direction it comes from matters.', type: 'choice', options: [['yes', 'Yes, headphones'], ['no', 'No, speakers or muted']] },
  { type: 'note', label: 'A short sound is playing now. Please set your volume so you can hear it comfortably.' },
  { id: 'audioHeard', label: 'Did you hear the sound?', type: 'choice', options: [['yes', 'Yes'], ['faint', 'Only faintly'], ['no', 'No']] },
];

const DEMOGRAPHICS = [
  { id: 'age', label: 'Your age group', type: 'choice', options: [['18_24', '18 to 24'], ['25_34', '25 to 34'], ['35_49', '35 to 49'], ['50plus', '50 or older']] },
  { id: 'gender', label: 'Gender', type: 'choice', options: [['f', 'Female'], ['m', 'Male'], ['d', 'Diverse'], ['na', 'Prefer not to say']] },
  { id: 'drivingExp', label: 'How often do you drive a car?', type: 'choice', options: [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often / daily']] },
  { id: 'cyclingExp', label: 'How often do you cycle in traffic?', type: 'choice', options: [['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often / daily']] },
  { id: 'avFamiliar', label: 'How familiar are you with automated (self-driving) vehicles? (1 = not at all, 7 = very)', type: 'likert' },
  { id: 'avAttitude', label: 'How positive is your attitude towards automated vehicles? (1 = very negative, 7 = very positive)', type: 'likert' },
  { id: 'vrExposure', label: 'Have you used VR or AR before?', type: 'choice', options: [['never', 'Never'], ['once', 'Once or twice'], ['regular', 'Regularly']] },
  // ATI short (affinity for technology interaction), 4 items
  AGREE,
  { id: 'ati1', label: 'I like to occupy myself in greater detail with technical systems.', type: 'likert' },
  { id: 'ati2', label: 'I like testing the functions of new technical systems.', type: 'likert' },
  { id: 'ati3', label: 'I enjoy spending time becoming acquainted with a new technical system.', type: 'likert' },
  { id: 'ati4', label: 'It is enough for me that a technical system works, I do not care how or why. (reverse)', type: 'likert' },
];

const POST_STUDY = [
  { id: 'hardest', label: 'What made it hard to decide, when it was hard? (a sentence or two)', type: 'text' },
  { id: 'comment', label: 'Anything else you want to tell us? (optional)', type: 'text', optional: true },
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

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const waitClick = (id) => new Promise((res) => { $(id).addEventListener('click', res, { once: true }); });

// ctx = { logger, startComplexityTrial(cfg), stopRun(), waitRun(), hud(msg),
//         playerX(), beep() }
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
    screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
    timestamp: new Date().toISOString(),
  });

  // 1. Consent
  show('consentDialog');
  await waitClick('consentContinue');
  hide('consentDialog');

  // 2. Screening (device, headphones, audio calibration tone)
  ctx.beep();
  const screening = await showForm(SCREENING, 'Before we start');
  logger.runs.push({ record: 'screening', participant: pid, answers: screening });

  // 3. Demographics + covariates
  const demo = await showForm(DEMOGRAPHICS, 'About you');
  logger.runs.push({ record: 'demographics', participant: pid, answers: demo });

  // 4. Instructions + one unscored practice trial
  show('introDialog');
  await waitClick('introStart');
  hide('introDialog');
  ctx.hud('Practice round. Nothing is recorded here.');
  ctx.startComplexityTrial({ ...PRACTICE, label: 'Practice' });
  const practiceRun = await ctx.waitRun();
  logger.completeRun(practiceRun, { participant: pid, practice: true });

  // 5. Main block: conditions in the Latin-square order, instantiations
  //    shuffled within each condition.
  let trialNo = 0;
  for (let ci = 0; ci < order.length; ci++) {
    const level = order[ci];
    const scenes = [...SCENES[level]];
    for (let i = scenes.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    }
    for (const scene of scenes) {
      trialNo++;
      const cfg = { ...scene, level, label: `Situation ${trialNo} of 6`, conditionPos: ci + 1, trialNo };
      ctx.hud(`Situation ${trialNo} of 6.`);
      ctx.startComplexityTrial(cfg);
      const run = await ctx.waitRun();
      const answers = await showForm(PER_TRIAL, 'Quick questions');
      // Objective scoring for the misattribution measure (RQ3a) and the
      // calibration test (RQ4): confidence paired with correctness.
      const correct = answers.addressee === scene.groundTruth;
      logger.completeRun(run, {
        participant: pid, level, inst: scene.inst, trialNo, conditionPos: ci + 1,
        groundTruth: scene.groundTruth, addresseeCorrect: correct,
        ...answers,
      });
    }
    // Per-condition battery (with an attention check in blocks 2 and 3)
    const attn = ci > 0 ? ATTENTION[ci - 1] : null;
    const battery = await showForm(perCondition(attn), 'About those situations');
    const attnPassed = attn ? Number(battery[attn.id]) === attn.answer : null;
    logger.runs.push({
      record: 'condition_battery', participant: pid, level, conditionPos: ci + 1,
      attentionCheck: attn ? { id: attn.id, expected: attn.answer, given: battery[attn.id], passed: attnPassed } : null,
      answers: battery,
    });
  }

  // 6. Post-study, debrief with the ground-truth reveal
  const post = await showForm(POST_STUDY, 'Last questions');
  logger.runs.push({ record: 'post_study', participant: pid, answers: post, totalMs: Math.round(performance.now() - t0) });

  const submitted = await submitResults({ participant: pid, study: 'complexity', runs: logger.runs });
  $(submitted ? 'endMsgUploaded' : 'endMsgDownload').classList.remove('hidden');
  show('debriefBlock');
  show('studyEndDialog');
  if (!submitted) logger.download();
  ctx.hud('The study is complete. Thank you!');
}

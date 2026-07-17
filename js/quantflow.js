// Quantitative study flow: a self-running session without a moderator.
// Activated by opening the page with ?study=1 (participant id via &p=P07 or a
// Prolific PROLIFIC_PID parameter).
//
// DESIGN: 2x2 within-subjects factorial.
//   Factor A, eHMI: present (full communicative package: light band,
//     windshield display, yield chime) vs absent (identical vehicle, package
//     dark and silent; engine hum and braking sounds constant across levels).
//   Factor B, proximity: the car stops nearer to the participant vs nearer to
//     a co-present NPC pedestrian 7 m along the same kerb. Stop distance to
//     the target is constant; only whose position it is varies.
// Four critical trials (the 2x2 cells, NPC crosses after a fixed delay), two
// exploratory NPC-stays trials (out of the confirmatory set), and four
// fillers including non-stopping cars. Order is a seeded shuffle (seed
// logged). Mirroring (who stands nearer the approaching car) is
// counterbalanced across participants via the participant number.
//
// Result upload is INTENTIONALLY absent for now (team decision: add later).
// submitResults() below is the single place to wire an endpoint into.
import { showForm } from './logger.js?v=17';

const NPC_DELAY_MS = 3500; // fixed early/late window boundary (3 to 4 s)

function buildTrials(mirrored, rand) {
  const criticals = [
    { type: 'critical', ehmi: true, proximity: 'player' },
    { type: 'critical', ehmi: true, proximity: 'npc' },
    { type: 'critical', ehmi: false, proximity: 'player' },
    { type: 'critical', ehmi: false, proximity: 'npc' },
  ].map((c) => ({ ...c, npcCrosses: true, npcDelayMs: NPC_DELAY_MS, mirrored }));
  const exploratory = [
    { type: 'exploratory', ehmi: true, proximity: 'npc', npcCrosses: false, npcDelayMs: NPC_DELAY_MS, mirrored },
    { type: 'exploratory', ehmi: false, proximity: 'player', npcCrosses: false, npcDelayMs: NPC_DELAY_MS, mirrored },
  ];
  const fillers = [
    { type: 'filler', ehmi: true, stops: false, npc: false, mirrored },
    { type: 'filler', ehmi: false, stops: false, npc: false, mirrored },
    { type: 'filler', ehmi: true, proximity: 'player', npc: false, mirrored },
    { type: 'filler', ehmi: false, proximity: 'player', npc: false, mirrored },
  ];
  const all = [...criticals, ...exploratory, ...fillers];
  for (let i = all.length - 1; i > 0; i--) { // seeded Fisher-Yates
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

// Deterministic PRNG so the trial order is reproducible from the logged seed.
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

// Post-trial screen, after CRITICAL trials only. Participant language.
const POST_TRIAL = [
  { id: 'safety', label: 'How safe did you feel just now? (1 = not at all, 7 = very safe)', type: 'likert' },
  { id: 'addressee', label: 'The car stopped. Who was that meant for?', type: 'choice', options: [['me', 'Me'], ['other', 'The other person'], ['both', 'Both of us'], ['unsure', 'Not sure']] },
  { id: 'addresseeConfidence', label: 'How sure are you about that? (1 = guessing, 7 = certain)', type: 'likert' },
  { type: 'note', label: 'How much do you agree? 1 = strongly disagree, 7 = strongly agree.' },
  { id: 'obliged', label: 'I felt obliged to cross once the car had stopped.', type: 'likert' },
  { id: 'rude', label: 'It would have felt rude to keep the car waiting.', type: 'likert' },
  { id: 'noticedMe', label: 'The car had noticed me.', type: 'likert' },
  { id: 'freeToWait', label: 'I felt free to stay on the pavement.', type: 'likert' },
];

const DEMOGRAPHICS = [
  { id: 'age', label: 'Your age group', type: 'choice', options: [['18_24', '18 to 24'], ['25_34', '25 to 34'], ['35_49', '35 to 49'], ['50plus', '50 or older']] },
  { id: 'mobility', label: 'How do you usually get around town?', type: 'choice', options: [['foot', 'Walking / public transport'], ['bike', 'Bike'], ['car', 'Car'], ['mixed', 'Mixed']] },
  { id: 'gaming', label: 'How often do you play 3D computer games?', type: 'choice', options: [['never', 'Never'], ['sometimes', 'Sometimes'], ['regularly', 'Regularly']] },
];

// Final questionnaire. The pro-sociality block is a clearly marked
// PLACEHOLDER (replace with the validated scale from the paper Akib shared;
// ids prosocial_p1..p4 stay stable). manipCheck verifies that the proximity
// manipulation registered (pilot criterion).
const FINAL_FORM = [
  { type: 'note', label: 'Almost done. A few last questions about the whole session.' },
  { id: 'manipCheck', label: 'Thinking back over the situations with the other person: where did the car usually stop?', type: 'choice', options: [['nearMe', 'Closer to me'], ['nearOther', 'Closer to the other person'], ['varied', 'It varied'], ['unsure', 'Not sure']] },
  { type: 'note', label: 'How much do you agree? 1 = strongly disagree, 7 = strongly agree.' },
  { id: 'prosocial_p1', label: 'The car behaved considerately towards me.', type: 'likert' },
  { id: 'prosocial_p2', label: 'The car put my needs above its own progress.', type: 'likert' },
  { id: 'prosocial_p3', label: "The car's behaviour felt genuinely helpful.", type: 'likert' },
  { id: 'prosocial_p4', label: 'I felt pressured by the car stopping for me.', type: 'likert' },
  { id: 'comment', label: 'Anything else you noticed or want to say? (optional)', type: 'text', optional: true },
];

export function isQuantMode() {
  return new URLSearchParams(location.search).has('study');
}

// Single integration point for a future results endpoint. For now: no-op,
// the participant downloads the JSON at the end instead.
async function submitResults(payload) {
  // TODO (team decision: add later): POST `payload` to a collection endpoint.
  return false; // false = not submitted, fall back to download
}

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const waitClick = (id) => new Promise((res) => { $(id).addEventListener('click', res, { once: true }); });

// ctx = { logger, startScenario(id), startTrial(cfg), stopRun(), waitRun(),
//         hud(msg), playerX() }
export async function runQuantStudy(ctx) {
  const { logger } = ctx;
  const params = new URLSearchParams(location.search);
  const pid = params.get('p') || params.get('PROLIFIC_PID')
    || ('P' + Math.random().toString(36).slice(2, 6).toUpperCase());
  logger.participant = pid;

  // Counterbalancing from the participant number: mirroring by parity, the
  // shuffle seed derived deterministically (logged either way).
  const num = parseInt((pid.match(/(\d+)\s*$/) || [])[1], 10);
  const mirrored = Number.isFinite(num) ? num % 2 === 1 : Math.random() < 0.5;
  const seed = Number.isFinite(num) ? (num * 7919 + 13) : Math.floor(Math.random() * 1e6);
  const trials = buildTrials(mirrored, mulberry32(seed));

  const t0 = performance.now();
  logger.runs.push({
    record: 'session_start', participant: pid, mirrored, seed,
    order: trials.map((t) => `${t.type}:${t.ehmi ? 'ehmi' : 'plain'}${t.stops === false ? ':nonstop' : ''}${t.proximity ? ':' + t.proximity : ''}`),
    prolific: { pid: params.get('PROLIFIC_PID'), study: params.get('STUDY_ID'), session: params.get('SESSION_ID') },
    timestamp: new Date().toISOString(),
  });

  // 1. Consent
  show('consentDialog');
  await waitClick('consentContinue');
  hide('consentDialog');

  // 2. Demographics
  const demo = await showForm(DEMOGRAPHICS, 'About you');
  logger.runs.push({ record: 'demographics', participant: pid, answers: demo });

  // 3. Intro
  show('introDialog');
  await waitClick('introStart');
  hide('introDialog');

  // 4. Training with a GATE: one successful crossing required before the
  // study can start, so every participant has demonstrably learned the
  // controls (novelty and skill floor).
  const tTrain = performance.now();
  ctx.startScenario('training');
  const ready = $('readyBtn');
  ready.disabled = true;
  ready.textContent = 'Training: cross the street once to continue';
  show('readyBtn');
  let crossedOnce = false;
  const gate = setInterval(() => {
    if (!crossedOnce && ctx.playerX() > 4.6) {
      crossedOnce = true;
      ready.disabled = false;
      ready.textContent = '✅ I feel ready, start the study';
      clearInterval(gate);
    }
  }, 200);
  await waitClick('readyBtn');
  clearInterval(gate);
  hide('readyBtn');
  ctx.stopRun();
  logger.runs.push({ record: 'training_done', participant: pid, trainingMs: Math.round(performance.now() - tTrain) });

  // 5. The trials
  for (let k = 0; k < trials.length; k++) {
    const cfg = { ...trials[k], label: `Situation ${k + 1} of ${trials.length}`, index: k + 1 };
    ctx.hud(`Situation ${k + 1} of ${trials.length}.`);
    ctx.startTrial(cfg);
    const run = await ctx.waitRun();
    let answers = null;
    if (cfg.type === 'critical') {
      answers = await showForm(POST_TRIAL, 'Quick questions');
    }
    logger.completeRun(run, { participant: pid, orderPos: k + 1, trialType: cfg.type, ...(answers ?? {}) });
  }

  // 6. Final questionnaire
  const fin = await showForm(FINAL_FORM, 'Final questions');
  logger.runs.push({ record: 'final_questionnaire', participant: pid, answers: fin, totalMs: Math.round(performance.now() - t0) });

  // 7. Wrap up: try the (future) endpoint, otherwise download
  const submitted = await submitResults({ participant: pid, runs: logger.runs });
  show('studyEndDialog');
  if (!submitted) logger.download();
  ctx.hud('The study is complete. Thank you!');
}

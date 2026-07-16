// Quantitative study flow: a self-running session without a moderator.
// Activated by opening the page with ?study=1 (optionally &p=P07 for the
// participant id). Sequence: consent, demographics, intro, free-roam training
// (ends via the "I feel ready" button), then the four study scenarios in a
// BALANCED LATIN SQUARE order with an in-app form after each one (RQ items
// plus the STS-AD situational trust scale), a final questionnaire, and a
// results download at the end.
//
// Result submission to a server is INTENTIONALLY absent for now (team
// decision: add later). See submitResults() below for the single place to
// wire an endpoint into.
import { showForm } from './logger.js?v=17';

// The study set in canonical display order (internal ids; display names are
// "Scenario 1..4"). Do not reorder: the Latin square indexes into this.
const SEQ = [1, 2, 6, 9];

// Balanced Latin square for 4 conditions: every condition appears once per
// position, and every condition is preceded by every other exactly once.
const LATIN = [
  [0, 1, 3, 2],
  [1, 2, 0, 3],
  [2, 3, 1, 0],
  [3, 0, 2, 1],
];

// STS-AD, Situational Trust Scale for Automated Driving (Holthausen,
// Wintersberger, Walker & Riener, AutomotiveUI 2020). Six items, one per
// subdimension, asked after EVERY scenario so trust is comparable across
// situations. Adapted minimally: "the car" instead of "the AV" (so the same
// items work for the human-driven baseline) and past tense.
const STS_NOTE = { type: 'note', label: 'For the following statements: 1 = strongly disagree, 7 = strongly agree.' };
const STS_AD = [
  STS_NOTE,
  { id: 'sts_trust', label: 'I trusted the car in this situation.', type: 'likert' },
  { id: 'sts_performance', label: 'I would have performed better than the car in this situation.', type: 'likert' },
  { id: 'sts_ndrt', label: 'In this situation, the car performed well enough for me to focus on other things.', type: 'likert' },
  { id: 'sts_risk', label: 'The situation was risky.', type: 'likert' },
  { id: 'sts_judgement', label: 'The car made an unsafe judgement in this situation.', type: 'likert' },
  { id: 'sts_reaction', label: 'The car reacted appropriately to the environment.', type: 'likert' },
];

// RQ-specific items per scenario (internal id), asked BEFORE the STS-AD block.
// Wording mirrors the qualitative probes, in closed or short-text form.
const RQ_ITEMS = {
  1: [ // RQ1 baseline (human car, no signals)
    { id: 'safety', label: 'How safe did you feel? (1 = not at all, 7 = very safe)', type: 'likert' },
    { id: 'reliedOn', label: 'What did you rely on when deciding?', type: 'choice', options: [['motion', "The car's movement"], ['traffic', 'The traffic situation'], ['gut', 'I just went'], ['other', 'Something else']] },
    { id: 'noticed', label: 'What did you notice about the car? (one or two sentences)', type: 'text' },
  ],
  2: [ // RQ1 full eHMI
    { id: 'safety', label: 'How safe did you feel? (1 = not at all, 7 = very safe)', type: 'likert' },
    { id: 'reliedOn', label: 'What did you rely on when deciding?', type: 'choice', options: [['motion', "The car's movement"], ['signals', "The car's signals (light, display, sound)"], ['traffic', 'The traffic situation'], ['gut', 'I just went']] },
    { id: 'noticed', label: 'What did you notice about the car? (one or two sentences)', type: 'text' },
  ],
  6: [ // RQ3/4 negotiation (two cars)
    { id: 'safety', label: 'How safe did you feel? (1 = not at all, 7 = very safe)', type: 'likert' },
    { id: 'reliedOn', label: 'What did you rely on most when deciding?', type: 'choice', options: [['car', 'The stopping car'], ['own', 'My own judgement'], ['both', 'Both'], ['neither', 'Neither']] },
    { id: 'noticed', label: 'What did you notice about the other cars? (one or two sentences)', type: 'text' },
  ],
  9: [ // RQ2 addressing (waiting people)
    { id: 'addressee', label: 'Who was the car letting cross?', type: 'choice', options: [['me', 'Me'], ['other', 'The other person'], ['both', 'Both of us'], ['unsure', 'Not sure']] },
    { id: 'addresseeConfidence', label: 'How sure are you about that? (1 = guessing, 7 = certain)', type: 'likert' },
    { id: 'safety', label: 'How safe did you feel? (1 = not at all, 7 = very safe)', type: 'likert' },
  ],
};

// Demographics, asked once at the start.
const DEMOGRAPHICS = [
  { id: 'age', label: 'Your age group', type: 'choice', options: [['18_24', '18 to 24'], ['25_34', '25 to 34'], ['35_49', '35 to 49'], ['50plus', '50 or older']] },
  { id: 'mobility', label: 'How do you usually get around town?', type: 'choice', options: [['foot', 'Walking / public transport'], ['bike', 'Bike'], ['car', 'Car'], ['mixed', 'Mixed']] },
  { id: 'gaming', label: 'How often do you play 3D computer games?', type: 'choice', options: [['never', 'Never'], ['sometimes', 'Sometimes'], ['regularly', 'Regularly']] },
];

// Final questionnaire. The pro-sociality block below is a clearly marked
// PLACEHOLDER: replace these four items with the validated scale from the
// paper Akib shared (ids prosocial_p1..p4 stay stable for the analysis).
const FINAL_FORM = [
  { type: 'note', label: 'Almost done. A few last statements about the automated car overall: 1 = strongly disagree, 7 = strongly agree.' },
  { id: 'prosocial_p1', label: 'The car behaved considerately towards me.', type: 'likert' },
  { id: 'prosocial_p2', label: 'The car put my needs above its own progress.', type: 'likert' },
  { id: 'prosocial_p3', label: "The car's behaviour felt genuinely helpful.", type: 'likert' },
  { id: 'prosocial_p4', label: 'I felt pressured by the car stopping for me.', type: 'likert' },
  { id: 'comment', label: 'Anything else you noticed or want to say? (optional)', type: 'text', optional: true },
];

// Is the page opened in quantitative study mode?
export function isQuantMode() {
  return new URLSearchParams(location.search).has('study');
}

// Single integration point for a future results endpoint. For now: no-op,
// the participant downloads the JSON at the end instead.
async function submitResults(payload) {
  // TODO (team decision: add later): POST `payload` to a collection endpoint,
  // e.g. a Google Apps Script web app appending to a Sheet:
  //   await fetch(ENDPOINT_URL, { method: 'POST', body: JSON.stringify(payload) });
  return false; // false = not submitted, fall back to download
}

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const waitClick = (id) => new Promise((res) => { $(id).addEventListener('click', res, { once: true }); });

// ctx = { logger, startScenario(id), stopRun(), waitRun() -> Promise<run>, hud(msg), labels }
export async function runQuantStudy(ctx) {
  const { logger } = ctx;
  const params = new URLSearchParams(location.search);
  const pid = params.get('p') || ('P' + Math.random().toString(36).slice(2, 6).toUpperCase());
  logger.participant = pid;

  // Latin square row: from a trailing number in the id (P07 -> row 3), so the
  // team controls balance simply by numbering participants; random otherwise.
  const num = parseInt((pid.match(/(\d+)\s*$/) || [])[1], 10);
  const row = Number.isFinite(num) ? (num - 1) % 4 : Math.floor(Math.random() * 4);
  const order = LATIN[row].map((i) => SEQ[i]);

  const t0 = performance.now();
  logger.runs.push({ record: 'session_start', participant: pid, latinRow: row + 1, order, timestamp: new Date().toISOString() });

  // 1. Consent (text lives in index.html; checkbox enables the button there)
  show('consentDialog');
  await waitClick('consentContinue');
  hide('consentDialog');

  // 2. Demographics
  const demo = await showForm(DEMOGRAPHICS, 'About you');
  logger.runs.push({ record: 'demographics', participant: pid, answers: demo });

  // 3. Intro (the existing 3-step dialog; hidden until now in study mode)
  show('introDialog');
  await waitClick('introStart');
  hide('introDialog');

  // 4. Training: free roam until the participant feels ready
  const tTrain = performance.now();
  ctx.startScenario('training');
  show('readyBtn');
  await waitClick('readyBtn');
  hide('readyBtn');
  ctx.stopRun();
  logger.runs.push({ record: 'training_done', participant: pid, trainingMs: Math.round(performance.now() - tTrain) });

  // 5. The four scenarios in the participant's Latin square order
  for (let k = 0; k < order.length; k++) {
    const id = order[k];
    ctx.hud(`Situation ${k + 1} of ${order.length}. Read the short description, then press Start.`);
    ctx.startScenario(id);
    const run = await ctx.waitRun();
    const answers = await showForm([...RQ_ITEMS[id], ...STS_AD]);
    logger.completeRun(run, { participant: pid, orderPos: k + 1, ...answers });
  }

  // 6. Final questionnaire
  const fin = await showForm(FINAL_FORM, 'Final questions');
  logger.runs.push({ record: 'final_questionnaire', participant: pid, answers: fin, totalMs: Math.round(performance.now() - t0) });

  // 7. Wrap up: try the (future) endpoint, otherwise download
  const submitted = await submitResults({ participant: pid, runs: logger.runs });
  show('studyEndDialog');
  if (!submitted) logger.download(); // auto-download once; button allows retry
  ctx.hud('The study is complete. Thank you!');
}

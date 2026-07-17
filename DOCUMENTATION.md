# eHMI Simulation, Documentation

Browser based Three.js environment for studying prosocial communication
between an automated vehicle (AV) and people on foot. Used hands-on in focus
groups and as a prototype for browser based behavioural measurement.

The study procedure itself is described in [STUDY_PLAN.md](STUDY_PLAN.md).
The older `README.md` keeps historical background; where they differ, this
file is current.

---

## Running locally

No build step. The ES modules need to be served over http, so do not open
`index.html` directly:

```bash
python3 -m http.server 8741 --directory ehmi-sim
# then open http://localhost:8741
```

Three.js loads from a CDN (jsdelivr), so the first load needs an internet
connection.

> Cache busting: every module import carries a `?v=NN` query. When you edit a
> JS file, increase its version number in the importing file (and
> `main.js?v=NN` in `index.html`), otherwise the browser serves the cached old
> copy.

## Participant view vs researcher view

The participant screen is deliberately minimal: the scenario label ("Scenario
3"), a Restart button, the phase indicator, the message line, and a small gear
button. Everything else lives in the **admin menu**, opened with the gear
button or the **O** key, closed with Close, O, or Escape:

- **Start scenario**: number-only buttons. Study set, one per topic: 1, 3, 6,
  9, then **Free roam** as the finale. Extras (demo only): 2, 4, 5.
  A public **☰ Scenarios** menu also exists for self-guided use; its cards are
  debiased (neutral titles, one shared description), so neither path reveals
  what is coming.
- **Stop current scenario**: ends the running scenario back to idle without
  starting a new one (moderator control between rounds).
- **Camera** views: Pedestrian (first person), Cyclist, Observer, Cinematic.
- **AV speed**, **Volume**, **Light band brightness** sliders.
- Toggles: ambient traffic, cyclist actor, merging car actor, and
  **Confidence check after each run** (switch off when the probes happen
  verbally in a group session).
- **Start recording** (hides all UI, Escape exits) and **Download log (JSON)**.

Flow: the researcher presses a scenario number, the participant reads a short
neutral briefing and presses Start. Between situations the participant can
walk around freely (this doubles as controls practice). Restart re-runs the
current scenario without the briefing.

## Scenario key (researcher only, qualitative study build)

Participants see sequential numbers (Scenario 1 to 4). The JSON log records
the INTERNAL id per run plus the display label (`label` field), so match logs
against the internal id column below.

| Display | Internal id (in logs) | Content | RQ |
|---|---|---|---|
| Training | training | Free roam with a few ordinary ambient cars (nothing scripted); controls and world familiarity, not analysed; the session leader ends it with Stop | Training |
| Scenario 1 | 1 | Human car, no signals at all; only the implicit motion cue | RQ1 |
| Scenario 2 | 2 | Automated car, full eHMI yield (light band, display, sound) | RQ1 |
| Scenario 3 | 6 | The AV yields; the honking driver behind it, hidden from the player by the AV, overtakes | RQ3/4 |
| Scenario 4 | 9 | Several people wait; the yield signal addresses the person opposite | RQ2 |

Extras with no UI entry in this build, start via `__sim.beginRun(id)`:
internal 3 (unnoticed cyclist), 4 (merge signal), 5 (busy street),
10 (unprompted stop while only walking past, pulled from the study set) and
'walk' (the town walk with glowing fields and staged encounters, the former
training).

The free roam is meant to be run last: the participant takes a walk through a
larger town (three junctions, distinct districts: cool south, warm brick
middle with a leafy corner, light modern north with a bus stop). Between
encounters a pulsing **glowing field** appears on BOTH pavements at the next
spot (trigger logic adapted from Julius's branch); stepping into either one
starts the next situation, so after crossing the participant can carry on up
whichever side they like. The four encounters: a stop although they were only
passing, a person waiting opposite, an overtaking driver behind a yielding
car, people on both sides. Waiting pedestrians are already in place when the
player enters the field, and the car only sets off a couple of seconds later
from further down the road, so there is time to read the scene first. Texts
and the phase label are debiased like everything else, reactive stops never
rest inside a junction, and the overtaking driver there brakes for people in
the road, so a collision cannot abort the walk.

After each free-walk situation a short **mini survey** appears ("Quick
questions", 3 items): one or two questions targeted at that situation's
domain (wanted to cross? who was the signal for? what did you rely on?) plus
a shared trust item (1 to 7) that makes trust comparable across all four
situations. Answers are appended to the walk run's event log as
`walk_survey` events. The admin menu's confidence-check toggle also switches
these mini surveys off for sessions where the probing happens verbally.

## Quantitative mode (?study=1): the 2x2 factorial

Opening the page with `?study=1` (participant id via `&p=P07` or Prolific's
`PROLIFIC_PID`) starts a self-running session without a moderator.

**Design: 2x2 within subjects.**
- **Factor A, eHMI**: present (full communicative package: light band,
  windshield display, yield chime) vs absent. Both levels use the IDENTICAL
  vehicle body; absent only darkens and silences the package. Engine hum and
  braking sounds are constant across levels, so Factor A is the communicative
  package and nothing else.
- **Factor B, proximity**: the car stops nearer to the participant or nearer
  to a co-present NPC pedestrian 7 m along the same kerb. The stop distance to
  the target (nose 1.5 m short) is constant; only whose position it is varies.

**Trials (10 per participant, seeded shuffle, seed logged).**
- 4 critical (the 2x2 cells): the NPC steps off a fixed 3.5 s after the
  stop/signal, preserving the early/late step-off window logic.
- 2 exploratory NPC-stays trials (out of the confirmatory set).
- 4 fillers, including two NON-stopping cars, so "the car always stops" can
  never be learned; two stopping trials without an NPC.
- Mirroring (who stands nearer the approaching car) is counterbalanced across
  participants by the participant number's parity.

**Flow**: consent, demographics, intro, free-roam training with a GATE (one
successful crossing required before "I feel ready" unlocks), the 10 trials
(post-trial screen after critical trials only: felt safety, addressee
attribution plus confidence, and four obligation/acknowledgment items), final
questionnaire (proximity manipulation check, pro-sociality PLACEHOLDER items
to be replaced with the scale from the paper Akib shared, open comment), and
an automatic results download named after the participant id.

**Logging**: signal onset (explicit cue when present, full stop otherwise),
first step-off, hesitations, false starts, a ~10 Hz trace of head yaw and
position per trial (scanning analysis), `npc_move_start` and
`npc_cross_complete` events, trial config and order position on every run,
Prolific PID/STUDY_ID/SESSION_ID passthrough, session seed and mirroring.

- Result upload is deliberately not wired yet (team decision);
  `submitResults()` in `js/quantflow.js` is the single integration point.
- Accidents fade to trial end: the run is flagged `aborted: "accident"` (the
  incident log) and the session continues; no retry loop.
- Without `?study=1` the build behaves exactly like the qualitative one.

## Debiasing rules (implemented)

So that neither the player nor a watching group is primed:

- Labels are number-only; the descriptive titles ("The car missed a cyclist")
  are gone from every visible surface.
- Briefings introduce only who is present, never what will happen. Scenarios
  2, 3 and 6 share a word-for-word identical briefing on purpose: any
  difference would itself signal "something is special this time".
- During a run there is exactly one neutral instruction ("A car is
  approaching. There is no marked crossing here, so decide for yourself if
  and when to cross"). No in-run narration annotates the eHMI states,
  announces the cyclist, names the impatient driver, or asks the study
  question out loud.
- The intro no longer lists the tricky situations.

## eHMI states

| Layer | Neutral | Assessing | Yielding | Thanks |
|---|---|---|---|---|
| Light band | white | yellow (fast sweep) | cyan (slow sweep) | white |
| Windshield | off | eye icon | animated wave | smile |
| Sound | hum (distance and speed scaled) | none | friction cue while braking, then a two-note chime | soft chime |

Band transitions are smoothstep eased (0.6 s). Each interaction follows the
arc Detection, Decision, Action (signal), Acknowledgment, Outcome.

## Reactive stopping

The AV stops with respect to where the player is, not at a fixed painted
line. If the player stands still beside the road near the crossing for about
3 seconds, the car reads that as intent and stops roughly 1 m before them;
otherwise it stops at a clean line before the crossing. Every stop is clamped
so the car's body rests north of the junction and never blocks the cross
streets.

## Accidents

Any real collision between two actors triggers a crash: sound, stopped or
knocked-over actors, a frozen scenario, an `accident` log event, and a dialog
whose OK button resets the scenario. The run is kept in the log, flagged
`aborted: "accident"`. Walking into a stopped vehicle is not an accident, the
pedestrian is just blocked. In scenario 6 the overtaking driver genuinely can
hit a badly timed crossing; that hazard is the point of the scenario.

## Logged data (JSON)

Per run: `reactionTimeMs` (signal onset to crossing start), `crossed`,
`completedCrossing`, `avDistanceAtCrossingStart`,
`gazeAtVehiclePreCrossMs` and `scannedBeforeCrossing` (first person gaze
proxy; more than 0.4 s on the vehicle counts as an active scan), a
timestamped `events` list, and the confidence check answers (null when the
check is toggled off). Aborted runs are kept and flagged. Export via the
admin menu.

Hesitation is measured three ways:

- `hesitations`: how often the pedestrian stopped while already in the road.
- `hesitationTimeMs`: how long in total they stood still while in the road.
- `falseStarts`: how often they stepped right up to the kerb (closer than
  0.7 m to the road edge) and then backed away (beyond 1.2 m) without
  crossing; each occurrence also logs a `false_start` event.

## Confidence check

After each run, branched on behaviour: crossed (why, felt safety 1 to 7) or
did not cross (why not, would you next time, overall safety 1 to 7). Can be
switched off in the admin menu.

## Architecture and files

- `index.html`: UI overlay and all modals (intro, briefing, admin menu,
  confidence check, accident), loads `js/main.js?v=NN`.
- `style.css`: styling for panels and modals.
- `js/main.js`: entry point. Wires everything: admin menu, briefings,
  per-scenario lighting, cameras, input, mouse look, accident system,
  collision checks, main loop. `window.__sim` is a debug handle.
- `js/scene.js`: renderer, bloom, time-of-day presets, the urban environment,
  and the `LAYOUT` constants (including `zebraZ`, the crossing position).
- `js/vehicle.js`: the AV body, 360 degree light band, canvas windshield
  display and its modes.
- `js/actors.js`: player pedestrian, NPC pedestrians, cyclist, merging car,
  baseline human car, and the ambient `TrafficManager` (intersection rules,
  ambulance pull-over, aggressive and safe overtaking, honking).
- `js/scenarios.js`: `ScenarioRunner`, the state machines for every scenario,
  the reactive stop logic, and the (currently unlisted) continuous walk.
- `js/audio.js`: Web Audio (hum, friction, chime, horn, siren, crash) with
  stereo panning.
- `js/logger.js`: behavioural logging and the confidence dialog.

## Deployment (Netlify)

Static site, no build step. `netlify.toml` publishes the repository root.
Netlify redeploys automatically on every push to the connected branch.
Previous versions stay available in git history; notable branches:
`scenario-selector` (backup of the menu-driven version) and `feature/Julius`
(the chained single-flow experiment).
